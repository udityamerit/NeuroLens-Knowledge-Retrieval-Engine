"""Document library per organisation: upload, URL ingestion, list, preview, delete."""
from __future__ import annotations

import base64
import hashlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..config import get_settings
from ..db import get_db
from ..models import Chunk, Document, Role, UsageCounter
from ..ratelimit import rate_limit
from ..rag import llm, store
from ..rag.loaders import DocumentError, Segment, image_mime, load_document, render_pdf_pages, safe_filename
from ..schemas import ChunkOut, DocStatsOut, DocumentOut, UploadErrorOut, UploadOut, UrlIngestIn
from ..security import OrgContext, org_access
from ..ssrf import FetchError, UnsafeURLError, extract_text, safe_fetch

router = APIRouter(prefix="/api/orgs/{org_id}/documents", tags=["documents"])
_limit = rate_limit("docs", lambda: get_settings().rate_limit_per_minute, by="user")
_ingest_limit = rate_limit("ingest", lambda: 20, by="user")

MB = 1024 * 1024


def _storage_used(db: Session, org_id: str, exclude_name: Optional[str] = None) -> int:
    q = select(Document.size_bytes).where(Document.org_id == org_id)
    if exclude_name:
        q = q.where(Document.name != exclude_name)
    return sum(db.scalars(q))


def _check_quota(db: Session, org_id: str, name: str, size: int) -> None:
    limit = get_settings().org_storage_mb * MB
    if _storage_used(db, org_id, exclude_name=name) + size > limit:
        raise HTTPException(413, f"Storage quota exceeded ({get_settings().org_storage_mb} MB per organisation).")


async def _read_capped(file: UploadFile, cap: int) -> bytes:
    buf = bytearray()
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        buf += chunk
        if len(buf) > cap:
            raise HTTPException(413, f"File exceeds the {cap // MB} MB limit.")
    return bytes(buf)


def _doc_out(d: Document) -> DocumentOut:
    return DocumentOut.model_validate(d)


@router.get("", response_model=list[DocumentOut])
def list_documents(ctx: OrgContext = Depends(org_access(Role.viewer)), db: Session = Depends(get_db, scope="function"), _=Depends(_limit)):
    return [_doc_out(d) for d in db.scalars(select(Document).where(Document.org_id == ctx.org.id).order_by(Document.created_at.desc()))]


@router.get("/stats", response_model=DocStatsOut)
def stats(ctx: OrgContext = Depends(org_access(Role.viewer)), db: Session = Depends(get_db, scope="function"), _=Depends(_limit)):
    s = get_settings()
    docs, chunks, size = store.usage_stats(db, ctx.org.id)
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    used = db.scalar(select(UsageCounter.value).where(UsageCounter.org_id == ctx.org.id, UsageCounter.day == day, UsageCounter.metric == "queries")) or 0
    return DocStatsOut(
        documents=docs, chunks=chunks, storage_bytes=size, storage_limit_bytes=s.org_storage_mb * MB,
        queries_today=used, query_quota=s.org_daily_query_quota,
    )


@router.post("", response_model=UploadOut, status_code=201)
async def upload(
    request: Request,
    files: list[UploadFile] = File(...),
    ctx: OrgContext = Depends(org_access(Role.member)),
    db: Session = Depends(get_db, scope="function"),
    _=Depends(_ingest_limit),
):
    s = get_settings()
    if len(files) > s.max_files_per_upload:
        raise HTTPException(413, f"At most {s.max_files_per_upload} files per upload.")
    errors: list[dict] = []
    payloads: list[tuple[str, bytes]] = []
    for f in files:  # read phase (async, streaming, size-capped)
        name = safe_filename(f.filename or "")
        if not name:
            errors.append({"file": f.filename, "error": "Invalid file name."})
            continue
        try:
            payloads.append((name, await _read_capped(f, s.max_upload_mb * MB)))
        except HTTPException as e:
            errors.append({"file": name, "error": str(e.detail)})
    created, proc_errors = await run_in_threadpool(_process_uploads, db, ctx, request, payloads)
    errors += proc_errors
    if not created:
        status = 413 if any("quota" in e["error"].lower() or "limit" in e["error"].lower() for e in errors) else 422
        raise HTTPException(status, errors[0]["error"] if len(errors) == 1 else "; ".join(f"{e['file']}: {e['error']}" for e in errors)[:500])
    return UploadOut(documents=created, errors=[UploadErrorOut(**e) for e in errors])


def _ocr_pdf_pages(db: Session, ctx: OrgContext, data: bytes, blank: list[int]) -> list[Segment]:
    """Read pages that have no text layer (scans, photographed pages) with the vision model, a few at a time."""
    todo = blank[: get_settings().max_ocr_pages]
    resolved = llm.resolve(db, ctx.org, vision=True)  # picks the provider's vision model automatically
    rendered = render_pdf_pages(data, todo)

    def read(item: tuple[int, bytes]):
        n, jpg = item
        url = "data:image/jpeg;base64," + base64.b64encode(jpg).decode()
        try:
            return n, llm.describe_image(resolved, url).strip(), None
        except llm.LLMError as e:
            return n, "", e

    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(read, rendered))
    segs = [Segment(n, text) for n, text, err in results if text]
    if not segs:
        err = next((e for _n, _t, e in results if e), None)
        if err:
            raise err
    return segs


def _process_uploads(db: Session, ctx: OrgContext, request: Request, payloads: list[tuple[str, bytes]]):
    """CPU-heavy parsing + embedding, run in a worker thread so the event loop stays responsive."""
    created: list[DocumentOut] = []
    errors: list[dict] = []
    for name, data in payloads:
        try:
            if not data:
                raise DocumentError("The file is empty.")
            kind, segments, pages = load_document(name, data)
            if kind == "image":
                resolved = llm.resolve(db, ctx.org, vision=True)
                data_url = f"data:{image_mime(data)};base64,{base64.b64encode(data).decode()}"
                text = llm.describe_image(resolved, data_url)
                if not text.strip():
                    raise DocumentError("Could not read any text from this image.")
                segments, pages = [Segment(None, text)], 1
            elif kind == "pdf":
                # Pages with no text layer are scans: switch to the vision model for those pages only.
                have = {sg.page for sg in segments}
                blank = [n for n in range(1, pages + 1) if n not in have]
                if blank and (not segments or len(blank) * 2 >= pages):
                    segments = sorted(segments + _ocr_pdf_pages(db, ctx, data, blank), key=lambda sg: sg.page or 0)
                if not segments:
                    raise DocumentError("No readable text was found in this PDF, even after scanning its pages.")
            _check_quota(db, ctx.org.id, name, len(data))
            doc = store.ingest_document(
                db, org_id=ctx.org.id, name=name, kind=kind, segments=segments, size_bytes=len(data),
                sha256=hashlib.sha256(data).hexdigest(), pages=pages, uploaded_by=ctx.user.id,
            )
            audit.record(db, "document.upload", request=request, org_id=ctx.org.id, user_id=ctx.user.id, target=name,
                         detail={"kind": kind, "bytes": len(data), "chunks": doc.chunk_count, "suspicious": doc.suspicious_chunks})
            created.append(_doc_out(doc))
        except DocumentError as e:
            errors.append({"file": name, "error": str(e)})
        except llm.LLMError as e:
            errors.append({"file": name, "error": e.message})
        except HTTPException as e:
            errors.append({"file": name, "error": str(e.detail)})
        except ValueError as e:
            errors.append({"file": name, "error": str(e)})
    return created, errors


@router.post("/url", response_model=DocumentOut, status_code=201)
def ingest_url(
    body: UrlIngestIn,
    request: Request,
    ctx: OrgContext = Depends(org_access(Role.member)),
    db: Session = Depends(get_db, scope="function"),
    _=Depends(_ingest_limit),
):
    s = get_settings()
    try:
        final_url, _ctype, text = safe_fetch(body.url, max_bytes=s.url_fetch_max_mb * MB, timeout=15.0, user_agent="NeuroLensBot/1.0")
    except UnsafeURLError as e:
        audit.record(db, "document.url_blocked", request=request, org_id=ctx.org.id, user_id=ctx.user.id, target=body.url[:300])
        db.commit()
        raise HTTPException(400, f"That URL is not allowed: {e}")
    except FetchError as e:
        raise HTTPException(422, str(e))
    title, content = extract_text(text, final_url)
    if len(content.strip()) < 30:
        raise HTTPException(422, "No readable text found at that URL.")
    name = safe_filename(title or final_url)[:200] or final_url[:200]
    data = content.encode("utf-8")
    _check_quota(db, ctx.org.id, name, len(data))
    try:
        doc = store.ingest_document(
            db, org_id=ctx.org.id, name=name, kind="url", segments=[Segment(None, content)], size_bytes=len(data),
            sha256=hashlib.sha256(data).hexdigest(), pages=0, uploaded_by=ctx.user.id, source_url=final_url[:2000],
        )
    except ValueError as e:
        raise HTTPException(422, str(e))
    audit.record(db, "document.url_ingest", request=request, org_id=ctx.org.id, user_id=ctx.user.id, target=final_url[:300])
    return _doc_out(doc)


@router.get("/{doc_id}/chunks", response_model=list[ChunkOut])
def preview_chunks(doc_id: str, limit: int = 200, ctx: OrgContext = Depends(org_access(Role.viewer)), db: Session = Depends(get_db, scope="function"), _=Depends(_limit)):
    doc = db.scalar(select(Document).where(Document.id == doc_id, Document.org_id == ctx.org.id))
    if not doc:
        raise HTTPException(404, "Document not found")
    rows = db.scalars(select(Chunk).where(Chunk.document_id == doc.id).order_by(Chunk.ordinal).limit(max(1, min(limit, 1000)))).all()
    return [ChunkOut(ordinal=c.ordinal, page=c.page, content=c.content, suspicious=c.suspicious) for c in rows]


@router.delete("/{doc_id}", status_code=204)
def delete_document(doc_id: str, request: Request, ctx: OrgContext = Depends(org_access(Role.member)), db: Session = Depends(get_db, scope="function")):
    doc = db.scalar(select(Document).where(Document.id == doc_id, Document.org_id == ctx.org.id))
    if not doc:
        raise HTTPException(404, "Document not found")
    name = doc.name
    store.delete_document(db, ctx.org.id, doc_id)
    audit.record(db, "document.delete", request=request, org_id=ctx.org.id, user_id=ctx.user.id, target=name)
    return Response(status_code=204)


@router.delete("", status_code=204)
def clear_library(request: Request, ctx: OrgContext = Depends(org_access(Role.admin)), db: Session = Depends(get_db, scope="function")):
    n = store.clear_org(db, ctx.org.id)
    audit.record(db, "document.clear", request=request, org_id=ctx.org.id, user_id=ctx.user.id, detail={"documents": n})
    return Response(status_code=204)
