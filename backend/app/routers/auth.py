"""Email/password authentication, session refresh and account endpoints."""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..config import get_settings
from ..db import get_db
from ..models import Membership, RefreshToken, User, utcnow
from ..ratelimit import rate_limit
from ..schemas import ChangePasswordIn, DeleteAccountIn, LoginIn, MeOut, RegisterIn, TokenOut
from ..security import (
    current_user,
    hash_password,
    hash_token,
    needs_rehash,
    validate_password_strength,
    verify_password,
)
from ..services import (
    CSRF_HEADER,
    CSRF_VALUE,
    REFRESH_COOKIE,
    build_token_response,
    clear_refresh_cookie,
    create_org,
    issue_refresh_token,
    orgs_for,
    revoke_all_sessions,
    set_refresh_cookie,
    start_session,
    user_out,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

_auth_limit = rate_limit("auth", lambda: get_settings().auth_rate_limit_per_minute, by="ip")
INVALID_LOGIN = "Invalid email or password."
REFRESH_GRACE_SECONDS = 10  # tolerate parallel refreshes (e.g. two tabs) without tripping reuse detection


def _require_csrf_header(request: Request) -> None:
    """Cookie-authenticated endpoints need a custom header so a cross-site form post cannot call them."""
    if request.headers.get(CSRF_HEADER, "").lower() != CSRF_VALUE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing CSRF header")


@router.post("/register", response_model=TokenOut, status_code=201, dependencies=[Depends(_auth_limit)])
def register(body: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db, scope="function")):
    s = get_settings()
    if not s.allow_registration:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Registration is disabled. Ask an administrator for an invite.")
    email = body.email.lower()
    problem = validate_password_strength(body.password, email)
    if problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, problem)
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists.")
    user = User(email=email, name=body.name or email.split("@")[0], password_hash=hash_password(body.password))
    db.add(user)
    db.flush()
    org = create_org(db, body.org_name or f"{user.name}'s workspace", user, personal=not body.org_name)
    audit.record(db, "user.register", request=request, org_id=org.id, user_id=user.id, target=email)
    return start_session(db, user, request, response)


@router.post("/login", response_model=TokenOut, dependencies=[Depends(_auth_limit)])
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db, scope="function")):
    s = get_settings()
    email = body.email.lower()
    user = db.scalar(select(User).where(User.email == email))
    now = utcnow()
    if user and user.locked_until and user.locked_until > now:
        # Still verify (constant work) but never reveal whether the password was right.
        verify_password(body.password, user.password_hash)
        audit.record(db, "user.login_locked", request=request, user_id=user.id, target=email)
        db.commit()
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many failed attempts. Try again later.")
    ok = verify_password(body.password, user.password_hash if user else None)
    if not user or not ok or not user.is_active:
        if user:
            user.failed_logins += 1
            if user.failed_logins >= s.max_failed_logins:
                user.locked_until = now + timedelta(minutes=s.lockout_minutes)
                user.failed_logins = 0
                audit.record(db, "user.locked", request=request, user_id=user.id, target=email)
            audit.record(db, "user.login_failed", request=request, user_id=user.id, target=email)
        db.commit()  # persist the counter even though we raise
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, INVALID_LOGIN)
    if user.password_hash and needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    audit.record(db, "user.login", request=request, user_id=user.id, target=email)
    return start_session(db, user, request, response)


@router.post("/refresh", response_model=TokenOut, dependencies=[Depends(_auth_limit)])
def refresh(request: Request, response: Response, db: Session = Depends(get_db, scope="function")):
    _require_csrf_header(request)
    raw = request.cookies.get(REFRESH_COOKIE)
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No session")
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw)))
    now = utcnow()
    if row is None:
        clear_refresh_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid session")
    user = db.get(User, row.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid session")
    if row.revoked_at is not None:
        if row.replaced_by and (now - row.revoked_at).total_seconds() <= REFRESH_GRACE_SECONDS:
            # Benign race: the browser already holds the rotated cookie. Give an access token only.
            return build_token_response(db, user)
        # Reuse of an old token => likely theft. Kill the whole family.
        for t in db.scalars(select(RefreshToken).where(RefreshToken.family_id == row.family_id, RefreshToken.revoked_at.is_(None))):
            t.revoked_at = now
        audit.record(db, "user.refresh_reuse", request=request, user_id=user.id, detail={"family": row.family_id})
        db.commit()
        clear_refresh_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired. Please sign in again.")
    if row.expires_at <= now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired. Please sign in again.")
    new_raw, new_row = issue_refresh_token(db, user, request, family_id=row.family_id)
    row.revoked_at = now
    row.replaced_by = new_row.id
    set_refresh_cookie(response, new_raw)
    return build_token_response(db, user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db, scope="function")):
    _require_csrf_header(request)
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw:
        row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw)))
        if row:
            now = utcnow()
            for t in db.scalars(select(RefreshToken).where(RefreshToken.family_id == row.family_id, RefreshToken.revoked_at.is_(None))):
                t.revoked_at = now
            audit.record(db, "user.logout", request=request, user_id=row.user_id)
    clear_refresh_cookie(response)
    response.status_code = 204
    return response


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(current_user), db: Session = Depends(get_db, scope="function")):
    return MeOut(user=user_out(user), orgs=orgs_for(db, user))


@router.post("/change-password", response_model=TokenOut)
def change_password(
    body: ChangePasswordIn,
    request: Request,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db, scope="function"),
    _=Depends(rate_limit("chpw", lambda: get_settings().auth_rate_limit_per_minute, by="user")),
):
    if user.password_hash and not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Current password is incorrect.")
    problem = validate_password_strength(body.new_password, user.email)
    if problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, problem)
    user.password_hash = hash_password(body.new_password)
    revoke_all_sessions(db, user)  # signs out every other device
    audit.record(db, "user.password_changed", request=request, user_id=user.id)
    return start_session(db, user, request, response)


@router.delete("/me", status_code=204)
def delete_account(
    request: Request,
    body: DeleteAccountIn = Body(default_factory=DeleteAccountIn),
    user: User = Depends(current_user),
    db: Session = Depends(get_db, scope="function"),
    _=Depends(rate_limit("delacct", lambda: get_settings().auth_rate_limit_per_minute, by="user")),
):
    """Delete the account. Password users must re-enter their password; refused while the user is the sole
    owner of an organisation that still has other members."""
    from ..models import Role

    if user.password_hash and not (body.password and verify_password(body.password, user.password_hash)):
        raise HTTPException(403, "Password is incorrect.")

    owned = db.scalars(select(Membership).where(Membership.user_id == user.id, Membership.role == Role.owner)).all()
    for m in owned:
        other_owners = db.scalar(
            select(Membership.id).where(Membership.org_id == m.org_id, Membership.role == Role.owner, Membership.user_id != user.id)
        )
        members = db.scalar(select(Membership.id).where(Membership.org_id == m.org_id, Membership.user_id != user.id))
        if not other_owners and members:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Transfer ownership or remove other members from your organisations first."
            )
    from ..models import Organization

    for m in owned:  # sole-member orgs go away with the user
        if not db.scalar(select(Membership.id).where(Membership.org_id == m.org_id, Membership.user_id != user.id)):
            org = db.get(Organization, m.org_id)
            if org:
                db.delete(org)
    audit.record(db, "user.deleted", request=request, user_id=user.id, target=user.email)
    db.delete(user)
    return Response(status_code=204)
