"""Single sign-on via Google, GitHub and Microsoft (OpenID Connect / OAuth2 authorization-code flow).

Flow: /login redirects to the provider -> provider redirects to /callback -> we create/link the user,
set the HttpOnly refresh cookie and redirect to the frontend, which immediately calls /api/auth/refresh
to obtain an in-memory access token. No token ever appears in a URL.
"""
from __future__ import annotations

import logging
from typing import Optional
from urllib.parse import urlencode

from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..config import get_settings
from ..db import get_db
from ..models import Membership, OAuthIdentity, Organization, Role, User
from ..ratelimit import rate_limit
from ..schemas import SSOProviderOut
from ..services import create_org, issue_refresh_token, revoke_all_sessions, set_refresh_cookie
from ..models import utcnow

log = logging.getLogger("neurolens.sso")
router = APIRouter(prefix="/api/auth/sso", tags=["sso"])
_limit = rate_limit("sso", lambda: get_settings().auth_rate_limit_per_minute, by="ip")

_oauth: Optional[OAuth] = None
_oauth_sig: Optional[tuple] = None

LABELS = {"google": "Google", "github": "GitHub", "microsoft": "Microsoft"}


def _configured() -> dict[str, tuple[str, str]]:
    s = get_settings()
    out = {}
    if s.google_client_id and s.google_client_secret:
        out["google"] = (s.google_client_id, s.google_client_secret)
    if s.github_client_id and s.github_client_secret:
        out["github"] = (s.github_client_id, s.github_client_secret)
    if s.microsoft_client_id and s.microsoft_client_secret:
        out["microsoft"] = (s.microsoft_client_id, s.microsoft_client_secret)
    return out


def get_oauth() -> OAuth:
    """(Re)build the registry if configuration changed (keeps tests simple)."""
    global _oauth, _oauth_sig
    s = get_settings()
    cfg = _configured()
    sig = (tuple(sorted(cfg.items())), s.microsoft_tenant)
    if _oauth is not None and sig == _oauth_sig:
        return _oauth
    oauth = OAuth()
    if "google" in cfg:
        oauth.register(
            "google",
            client_id=cfg["google"][0],
            client_secret=cfg["google"][1],
            server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
            client_kwargs={"scope": "openid email profile"},
        )
    if "github" in cfg:
        oauth.register(
            "github",
            client_id=cfg["github"][0],
            client_secret=cfg["github"][1],
            access_token_url="https://github.com/login/oauth/access_token",
            authorize_url="https://github.com/login/oauth/authorize",
            api_base_url="https://api.github.com/",
            client_kwargs={"scope": "read:user user:email"},
        )
    if "microsoft" in cfg:
        oauth.register(
            "microsoft",
            client_id=cfg["microsoft"][0],
            client_secret=cfg["microsoft"][1],
            access_token_url=f"https://login.microsoftonline.com/{s.microsoft_tenant}/oauth2/v2.0/token",
            authorize_url=f"https://login.microsoftonline.com/{s.microsoft_tenant}/oauth2/v2.0/authorize",
            userinfo_endpoint="https://graph.microsoft.com/oidc/userinfo",
            client_kwargs={"scope": "openid email profile", "code_challenge_method": "S256"},
        )
    _oauth, _oauth_sig = oauth, sig
    return oauth


@router.get("/providers", response_model=list[SSOProviderOut])
def providers():
    return [SSOProviderOut(id=k, name=LABELS[k]) for k in _configured()]


def _frontend_redirect(error: Optional[str] = None) -> RedirectResponse:
    base = get_settings().frontend_url.rstrip("/")
    qs = urlencode({"sso_error": error}) if error else urlencode({"sso": "ok"})
    return RedirectResponse(f"{base}/?{qs}", status_code=303)


@router.get("/{provider}/login", dependencies=[Depends(_limit)])
async def sso_login(provider: str, request: Request):
    if provider not in _configured():
        raise HTTPException(404, "SSO provider not configured")
    client = getattr(get_oauth(), provider)
    redirect_uri = f"{get_settings().public_base_url.rstrip('/')}/api/auth/sso/{provider}/callback"
    return await client.authorize_redirect(request, redirect_uri)


async def _fetch_profile(provider: str, request: Request) -> dict:
    """Return {subject, email, email_verified, name}."""
    s = get_settings()
    client = getattr(get_oauth(), provider)
    token = await client.authorize_access_token(request)
    if provider == "google":
        info = token.get("userinfo") or await client.userinfo(token=token)
        return {
            "subject": str(info["sub"]),
            "email": (info.get("email") or "").lower(),
            "email_verified": bool(info.get("email_verified")),
            "name": info.get("name") or "",
        }
    if provider == "github":
        me = (await client.get("user", token=token)).json()
        emails = (await client.get("user/emails", token=token)).json()
        primary = next((e for e in emails if isinstance(e, dict) and e.get("primary") and e.get("verified")), None)
        return {
            "subject": str(me["id"]),
            "email": (primary["email"] if primary else "").lower(),
            "email_verified": bool(primary),
            "name": me.get("name") or me.get("login") or "",
        }
    # microsoft: use Graph userinfo (id_token issuer differs per tenant when using the "common" endpoint)
    resp = await client.get("https://graph.microsoft.com/oidc/userinfo", token=token)
    info = resp.json()
    email = (info.get("email") or "").lower()
    # Microsoft email claims are not guaranteed verified in multi-tenant mode (the "nOAuth" issue), so we only
    # trust them when this app is locked to one specific tenant.
    single_tenant = s.microsoft_tenant.lower() not in ("common", "organizations", "consumers")
    return {
        "subject": str(info["sub"]),
        "email": email,
        "email_verified": bool(email) and single_tenant,
        "name": info.get("name") or "",
    }


def _resolve_user(db: Session, provider: str, profile: dict, request: Request) -> User:
    ident = db.scalar(
        select(OAuthIdentity).where(OAuthIdentity.provider == provider, OAuthIdentity.subject == profile["subject"])
    )
    if ident:
        user = db.get(User, ident.user_id)
        if user is None or not user.is_active:
            raise HTTPException(403, "Account disabled")
        return user
    email, verified = profile["email"], profile["email_verified"]
    if not email:
        raise HTTPException(400, "Your account has no usable email address.")
    user = db.scalar(select(User).where(User.email == email))
    if user is not None:
        if not verified:
            raise HTTPException(409, "An account with this email exists; sign in with your password first.")
        if not user.is_active:
            raise HTTPException(403, "Account disabled")
        if not user.email_verified:
            # Possible pre-registration hijack: whoever created the password account never proved ownership.
            user.password_hash = None
            user.email_verified = True
            revoke_all_sessions(db, user)
            audit.record(db, "user.sso_takeover_guard", request=request, user_id=user.id, target=email)
    else:
        user = User(email=email, name=profile["name"] or email.split("@")[0], password_hash=None, email_verified=verified)
        db.add(user)
        db.flush()
        create_org(db, f"{user.name}'s workspace", user, personal=True)
    db.add(OAuthIdentity(user_id=user.id, provider=provider, subject=profile["subject"], email=email))
    db.flush()
    if verified:
        _auto_join_orgs(db, user, email)
    return user


def _auto_join_orgs(db: Session, user: User, email: str) -> None:
    domain = email.rsplit("@", 1)[-1]
    for org in db.scalars(select(Organization).where(Organization.sso_domain == domain)):
        if not db.scalar(select(Membership.id).where(Membership.org_id == org.id, Membership.user_id == user.id)):
            role = org.sso_default_role if org.sso_default_role != Role.owner else Role.member
            db.add(Membership(user_id=user.id, org_id=org.id, role=role))
            audit.record(db, "org.sso_auto_join", org_id=org.id, user_id=user.id, target=email)


@router.get("/{provider}/callback", dependencies=[Depends(_limit)])
async def sso_callback(provider: str, request: Request, db: Session = Depends(get_db, scope="function")):
    if provider not in _configured():
        raise HTTPException(404, "SSO provider not configured")
    try:
        profile = await _fetch_profile(provider, request)
    except OAuthError as e:
        log.info("SSO %s failed: %s", provider, e.error)
        return _frontend_redirect("sso_failed")
    except Exception:
        log.exception("SSO %s profile fetch failed", provider)
        return _frontend_redirect("sso_failed")
    try:
        user = _resolve_user(db, provider, profile, request)
    except HTTPException as e:
        db.rollback()
        return _frontend_redirect(str(e.detail)[:120])
    raw, _ = issue_refresh_token(db, user, request)
    user.last_login_at = utcnow()
    audit.record(db, "user.sso_login", request=request, user_id=user.id, target=provider)
    db.commit()  # the frontend calls /refresh right after this redirect, so the token must already be persisted
    resp = _frontend_redirect()
    set_refresh_cookie(resp, raw)
    return resp
