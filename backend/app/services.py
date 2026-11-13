"""Shared domain helpers used by several routers."""
from __future__ import annotations

import re
import secrets
from datetime import timedelta
from typing import Optional

from fastapi import Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .models import Membership, Organization, RefreshToken, Role, User, utcnow
from .schemas import OrgBrief, TokenOut, UserOut
from .security import client_ip, create_access_token, hash_token, new_opaque_token

REFRESH_COOKIE = "nl_refresh"
CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "neurolens"


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s[:50] or "org"


def unique_slug(db: Session, base: str) -> str:
    base = slugify(base)
    slug = base
    while db.scalar(select(Organization.id).where(Organization.slug == slug)):
        slug = f"{base}-{secrets.token_hex(2)}"
    return slug


def create_org(db: Session, name: str, owner: User, *, personal: bool = False) -> Organization:
    org = Organization(name=name.strip()[:120] or "Workspace", slug=unique_slug(db, name), is_personal=personal)
    db.add(org)
    db.flush()
    db.add(Membership(user_id=owner.id, org_id=org.id, role=Role.owner))
    db.flush()
    return org


def user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        email_verified=user.email_verified,
        has_password=bool(user.password_hash),
        is_superadmin=user.is_superadmin,
        providers=sorted({i.provider for i in user.identities}),
    )


def orgs_for(db: Session, user: User) -> list[OrgBrief]:
    rows = db.execute(
        select(Organization, Membership.role)
        .join(Membership, Membership.org_id == Organization.id)
        .where(Membership.user_id == user.id)
        .order_by(Organization.is_personal.desc(), Organization.created_at)
    ).all()
    return [OrgBrief(id=o.id, name=o.name, slug=o.slug, role=r, is_personal=o.is_personal) for o, r in rows]


def set_refresh_cookie(response: Response, token: str) -> None:
    s = get_settings()
    response.set_cookie(
        REFRESH_COOKIE,
        token,
        max_age=s.refresh_token_days * 86400,
        httponly=True,
        secure=s.effective_cookie_secure,
        samesite=s.cookie_samesite,  # type: ignore[arg-type]
        path="/api/auth",
    )


def clear_refresh_cookie(response: Response) -> None:
    s = get_settings()
    response.delete_cookie(
        REFRESH_COOKIE, path="/api/auth", secure=s.effective_cookie_secure, httponly=True, samesite=s.cookie_samesite  # type: ignore[arg-type]
    )


def issue_refresh_token(db: Session, user: User, request: Request, family_id: Optional[str] = None) -> tuple[str, RefreshToken]:
    s = get_settings()
    raw = new_opaque_token()
    row = RefreshToken(
        user_id=user.id,
        family_id=family_id or secrets.token_hex(16),
        token_hash=hash_token(raw),
        expires_at=utcnow() + timedelta(days=s.refresh_token_days),
        user_agent=(request.headers.get("user-agent") or "")[:300],
        ip=client_ip(request),
    )
    db.add(row)
    db.flush()
    return raw, row


def build_token_response(db: Session, user: User) -> TokenOut:
    access, ttl = create_access_token(user)
    return TokenOut(access_token=access, expires_in=ttl, user=user_out(user), orgs=orgs_for(db, user))


def start_session(db: Session, user: User, request: Request, response: Response) -> TokenOut:
    raw, _ = issue_refresh_token(db, user, request)
    set_refresh_cookie(response, raw)
    user.last_login_at = utcnow()
    user.failed_logins = 0
    user.locked_until = None
    return build_token_response(db, user)


def revoke_all_sessions(db: Session, user: User) -> None:
    now = utcnow()
    for t in db.scalars(select(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))):
        t.revoked_at = now
    user.token_version += 1
