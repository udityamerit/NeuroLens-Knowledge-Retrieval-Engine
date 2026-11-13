"""Question answering and text-to-speech endpoints (authenticated, rate-limited, quota-enforced)."""
from __future__ import annotations

from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import audit
from ..config import get_settings
from ..db import get_db
from ..models import Role, UsageCounter
from ..ratelimit import rate_limit
from ..rag import llm, pipeline
from ..schemas import ChatIn, ChatOut, TTSIn
from ..security import OrgContext, org_access

router = APIRouter(prefix="/api/orgs/{org_id}", tags=["chat"])
_chat_limit = rate_limit("chat", lambda: get_settings().chat_rate_limit_per_minute, by="user")
_tts_limit = rate_limit("tts", lambda: 10, by="user")

SERIOUS_FLAGS = {"system_prompt_leak", "secret_in_output", "input_blocked", "suspicious_document_content", "secret_in_input"}


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _usage(db: Session, org_id: str, metric: str) -> int:
    return db.scalar(select(UsageCounter.value).where(UsageCounter.org_id == org_id, UsageCounter.day == _today(), UsageCounter.metric == metric)) or 0


def _bump(db: Session, org_id: str, metric: str) -> None:
    day = _today()
    res = db.execute(
        update(UsageCounter).where(UsageCounter.org_id == org_id, UsageCounter.day == day, UsageCounter.metric == metric).values(value=UsageCounter.value + 1)
    )
    if res.rowcount:
        return
    try:
        with db.begin_nested():
            db.add(UsageCounter(org_id=org_id, day=day, metric=metric, value=1))
    except IntegrityError:  # lost a race with a concurrent first request of the day
        db.execute(
            update(UsageCounter).where(UsageCounter.org_id == org_id, UsageCounter.day == day, UsageCounter.metric == metric).values(value=UsageCounter.value + 1)
        )


@router.post("/chat", response_model=ChatOut)
def chat(
    body: ChatIn,
    request: Request,
    ctx: OrgContext = Depends(org_access(Role.viewer)),
    db: Session = Depends(get_db, scope="function"),
    _=Depends(_chat_limit),
):
    s = get_settings()
    if _usage(db, ctx.org.id, "queries") >= s.org_daily_query_quota:
        raise HTTPException(429, "Your organisation reached its daily question limit. It resets at midnight UTC.")
    try:
        resolved = llm.resolve(db, ctx.org)
        result = pipeline.answer(db, ctx.org, body, resolved)
    except llm.LLMError as e:
        audit.record(db, "chat.error", request=request, org_id=ctx.org.id, user_id=ctx.user.id, detail={"status": e.status_code})
        db.commit()
        raise HTTPException(e.status_code if e.status_code in (400, 403, 429, 500, 502, 504) else 502, e.message)
    if result.blocked:
        audit.record(db, "chat.blocked", request=request, org_id=ctx.org.id, user_id=ctx.user.id, detail={"flags": result.flags})
        db.commit()
        raise HTTPException(400, result.answer)
    _bump(db, ctx.org.id, "queries")
    serious = sorted(set(result.flags) & SERIOUS_FLAGS)
    if serious:
        audit.record(db, "chat.flagged", request=request, org_id=ctx.org.id, user_id=ctx.user.id, detail={"flags": serious})
    return ChatOut(
        answer=result.answer, sources=result.sources, flags=result.flags, model=result.model, provider=result.provider
    )


@router.post("/tts")
def tts(
    body: TTSIn,
    request: Request,
    ctx: OrgContext = Depends(org_access(Role.member)),
    db: Session = Depends(get_db, scope="function"),
    _=Depends(_tts_limit),
):
    s = get_settings()
    if not (s.elevenlabs_api_key and s.allow_platform_keys):
        raise HTTPException(503, "Text-to-speech is not configured on this server.")
    try:
        with httpx.Client(timeout=30.0) as c:
            r = c.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{body.voice_id}",
                headers={"xi-api-key": s.elevenlabs_api_key, "Accept": "audio/mpeg"},
                json={"text": body.text, "model_id": "eleven_multilingual_v2"},
            )
    except httpx.HTTPError:
        raise HTTPException(502, "Could not reach the speech service.")
    if r.status_code != 200:
        raise HTTPException(502, "The speech service rejected the request.")
    return Response(content=r.content, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})
