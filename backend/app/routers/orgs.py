"""Organisations: settings, members, invites, provider keys, audit log."""
from __future__ import annotations

from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit
from ..config import get_settings
from ..db import get_db
from ..models import AuditLog, Invite, Membership, Organization, ProviderKey, Role, ROLE_RANK, User, utcnow
from ..ratelimit import rate_limit
from ..schemas import (
    AuditOut,
    InviteAcceptIn,
    InviteCreateIn,
    InviteOut,
    MemberOut,
    MemberUpdateIn,
    OrgBrief,
    OrgCreateIn,
    OrgSettingsOut,
    OrgUpdateIn,
    ProviderKeyIn,
)
from ..security import OrgContext, current_user, encrypt_secret, hash_token, new_opaque_token, org_access
from ..services import create_org, orgs_for

router = APIRouter(prefix="/api", tags=["organizations"])
PROVIDERS = ("groq", "openai", "openrouter")


def _platform_key(provider: str) -> Optional[str]:
    s = get_settings()
    if not s.allow_platform_keys:
        return None
    return getattr(s, f"{provider}_api_key", None)


def _settings_out(db: Session, ctx: OrgContext) -> OrgSettingsOut:
    org = ctx.org
    keys = {k.provider: k for k in db.scalars(select(ProviderKey).where(ProviderKey.org_id == org.id))}
    configured: dict[str, dict] = {}
    for p in PROVIDERS:
        if p in keys:
            configured[p] = {"source": "org", "last4": keys[p].last4}
        elif _platform_key(p):
            configured[p] = {"source": "platform", "last4": ""}
    return OrgSettingsOut(
        id=org.id,
        name=org.name,
        slug=org.slug,
        is_personal=org.is_personal,
        role=ctx.role,
        sso_domain=org.sso_domain,
        sso_default_role=org.sso_default_role,
        redact_pii=org.redact_pii,
        allowed_providers=list(org.allowed_providers or PROVIDERS),
        llm_provider=org.llm_provider,
        llm_model=org.llm_model,
        temperature=(org.temperature or 0) / 100,
        retrieval_k=org.retrieval_k,
        configured_providers=configured,
        created_at=org.created_at,
    )


# ------------------------------------------------------------------- orgs
@router.get("/orgs", response_model=list[OrgBrief])
def list_orgs(user: User = Depends(current_user), db: Session = Depends(get_db, scope="function")):
    return orgs_for(db, user)


@router.post("/orgs", response_model=OrgBrief, status_code=201)
def create_organization(
    body: OrgCreateIn,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db, scope="function"),
    _=Depends(rate_limit("orgcreate", lambda: 10, by="user", window=3600)),
):
    org = create_org(db, body.name, user)
    audit.record(db, "org.create", request=request, org_id=org.id, user_id=user.id, target=org.name)
    return OrgBrief(id=org.id, name=org.name, slug=org.slug, role=Role.owner, is_personal=False)


@router.get("/orgs/{org_id}", response_model=OrgSettingsOut)
def get_org(ctx: OrgContext = Depends(org_access(Role.viewer)), db: Session = Depends(get_db, scope="function")):
    return _settings_out(db, ctx)


@router.patch("/orgs/{org_id}", response_model=OrgSettingsOut)
def update_org(
    body: OrgUpdateIn,
    request: Request,
    ctx: OrgContext = Depends(org_access(Role.admin)),
    db: Session = Depends(get_db, scope="function"),
):
    org = ctx.org
    data = body.model_dump(exclude_unset=True)
    if "sso_domain" in data or "sso_default_role" in data:
        if ctx.role != Role.owner:
            raise HTTPException(403, "Only owners can change SSO auto-join settings.")
    if "sso_default_role" in data and data["sso_default_role"] == Role.owner:
        raise HTTPException(422, "Auto-join cannot grant the owner role.")
    if data.get("sso_domain"):
        taken = db.scalar(select(Organization.id).where(Organization.sso_domain == data["sso_domain"], Organization.id != org.id))
        if taken:
            raise HTTPException(409, "That domain is already claimed by another organisation.")
    if "temperature" in data and data["temperature"] is not None:
        data["temperature"] = int(round(data["temperature"] * 100))
    if "allowed_providers" in data and data["allowed_providers"] is not None:
        if not data["allowed_providers"]:
            raise HTTPException(422, "At least one provider must be allowed.")
        data["allowed_providers"] = list(dict.fromkeys(data["allowed_providers"]))
    provider = data.get("llm_provider", org.llm_provider)
    allowed = data.get("allowed_providers", org.allowed_providers) or list(PROVIDERS)
    if provider not in allowed:
        raise HTTPException(422, "The selected provider is not in the allowed providers list.")
    for k, v in data.items():
        if v is None and k not in ("sso_domain",):
            continue
        setattr(org, k, v)
    audit.record(db, "org.update", request=request, org_id=org.id, user_id=ctx.user.id, detail={k: ("…" if k == "name" else v) for k, v in data.items()})
    db.flush()
    return _settings_out(db, ctx)


@router.delete("/orgs/{org_id}", status_code=204)
def delete_org(request: Request, ctx: OrgContext = Depends(org_access(Role.owner)), db: Session = Depends(get_db, scope="function")):
    if ctx.org.is_personal:
        raise HTTPException(409, "Personal workspaces cannot be deleted; delete your account instead.")
    audit.record(db, "org.delete", request=request, org_id=None, user_id=ctx.user.id, target=ctx.org.name)
    org_id = ctx.org.id
    db.delete(ctx.org)
    db.flush()
    from ..rag.store import invalidate

    invalidate(org_id)
    return Response(status_code=204)


# ---------------------------------------------------------------- members
@router.get("/orgs/{org_id}/members", response_model=list[MemberOut])
def list_members(ctx: OrgContext = Depends(org_access(Role.viewer)), db: Session = Depends(get_db, scope="function")):
    rows = db.execute(
        select(Membership, User).join(User, User.id == Membership.user_id).where(Membership.org_id == ctx.org.id).order_by(Membership.created_at)
    ).all()
    return [MemberOut(user_id=u.id, email=u.email, name=u.name, role=m.role, joined_at=m.created_at) for m, u in rows]


def _owner_count(db: Session, org_id: str) -> int:
    return db.scalar(select(func.count()).select_from(Membership).where(Membership.org_id == org_id, Membership.role == Role.owner)) or 0


def _get_member(db: Session, org_id: str, user_id: str) -> Membership:
    m = db.scalar(select(Membership).where(Membership.org_id == org_id, Membership.user_id == user_id))
    if not m:
        raise HTTPException(404, "Member not found")
    return m


@router.patch("/orgs/{org_id}/members/{user_id}", response_model=MemberOut)
def change_role(
    user_id: str,
    body: MemberUpdateIn,
    request: Request,
    ctx: OrgContext = Depends(org_access(Role.admin)),
    db: Session = Depends(get_db, scope="function"),
):
    target = _get_member(db, ctx.org.id, user_id)
    # Only owners may grant/revoke owner or touch another owner; admins manage member/viewer/admin below owner.
    if ctx.role != Role.owner and (target.role == Role.owner or body.role == Role.owner):
        raise HTTPException(403, "Only owners can change owner roles.")
    if target.role == Role.owner and body.role != Role.owner and _owner_count(db, ctx.org.id) <= 1:
        raise HTTPException(409, "An organisation must keep at least one owner.")
    old = target.role
    target.role = body.role
    audit.record(db, "member.role_change", request=request, org_id=ctx.org.id, user_id=ctx.user.id, target=user_id, detail={"from": old.value, "to": body.role.value})
    u = db.get(User, user_id)
    return MemberOut(user_id=user_id, email=u.email, name=u.name, role=target.role, joined_at=target.created_at)


@router.delete("/orgs/{org_id}/members/{user_id}", status_code=204)
def remove_member(
    user_id: str,
    request: Request,
    ctx: OrgContext = Depends(org_access(Role.viewer)),
    db: Session = Depends(get_db, scope="function"),
):
    leaving = user_id == ctx.user.id
    if not leaving and ROLE_RANK[ctx.role] < ROLE_RANK[Role.admin]:
        raise HTTPException(403, "Requires admin role or higher")
    target = _get_member(db, ctx.org.id, user_id)
    if not leaving and target.role == Role.owner and ctx.role != Role.owner:
        raise HTTPException(403, "Only owners can remove owners.")
    if target.role == Role.owner and _owner_count(db, ctx.org.id) <= 1:
        raise HTTPException(409, "An organisation must keep at least one owner.")
    if ctx.org.is_personal and leaving:
        raise HTTPException(409, "You cannot leave your personal workspace.")
    db.delete(target)
    audit.record(db, "member.leave" if leaving else "member.remove", request=request, org_id=ctx.org.id, user_id=ctx.user.id, target=user_id)
    return Response(status_code=204)


# ---------------------------------------------------------------- invites
def _invite_out(inv: Invite, token: Optional[str] = None) -> InviteOut:
    url = None
    if token:
        url = f"{get_settings().frontend_url.rstrip('/')}/?invite={token}"
    return InviteOut(
        id=inv.id, email=inv.email, role=inv.role, expires_at=inv.expires_at, accepted_at=inv.accepted_at,
        created_at=inv.created_at, token=token, accept_url=url,
    )


@router.post("/orgs/{org_id}/invites", response_model=InviteOut, status_code=201)
def create_invite(
    body: InviteCreateIn,
    request: Request,
    ctx: OrgContext = Depends(org_access(Role.admin)),
    db: Session = Depends(get_db, scope="function"),
):
    if ctx.org.is_personal:
        raise HTTPException(409, "Create a team organisation to invite people.")
    if body.role == Role.owner and ctx.role != Role.owner:
        raise HTTPException(403, "Only owners can invite owners.")
    email = body.email.lower()
    existing = db.scalar(
        select(Membership.id).join(User, User.id == Membership.user_id).where(Membership.org_id == ctx.org.id, User.email == email)
    )
    if existing:
        raise HTTPException(409, "That person is already a member.")
    pending = db.scalars(select(Invite).where(Invite.org_id == ctx.org.id, Invite.email == email, Invite.accepted_at.is_(None))).all()
    for p in pending:  # newest invite wins
        db.delete(p)
    token = new_opaque_token()
    inv = Invite(
        org_id=ctx.org.id, email=email, role=body.role, token_hash=hash_token(token), invited_by=ctx.user.id,
        expires_at=utcnow() + timedelta(days=7),
    )
    db.add(inv)
    db.flush()
    audit.record(db, "invite.create", request=request, org_id=ctx.org.id, user_id=ctx.user.id, target=email, detail={"role": body.role.value})
    return _invite_out(inv, token)


@router.get("/orgs/{org_id}/invites", response_model=list[InviteOut])
def list_invites(ctx: OrgContext = Depends(org_access(Role.admin)), db: Session = Depends(get_db, scope="function")):
    rows = db.scalars(select(Invite).where(Invite.org_id == ctx.org.id, Invite.accepted_at.is_(None)).order_by(Invite.created_at.desc())).all()
    return [_invite_out(i) for i in rows]


@router.delete("/orgs/{org_id}/invites/{invite_id}", status_code=204)
def revoke_invite(invite_id: str, request: Request, ctx: OrgContext = Depends(org_access(Role.admin)), db: Session = Depends(get_db, scope="function")):
    inv = db.scalar(select(Invite).where(Invite.id == invite_id, Invite.org_id == ctx.org.id))
    if not inv:
        raise HTTPException(404, "Invite not found")
    db.delete(inv)
    audit.record(db, "invite.revoke", request=request, org_id=ctx.org.id, user_id=ctx.user.id, target=inv.email)
    return Response(status_code=204)


@router.post("/invites/accept", response_model=OrgBrief)
def accept_invite(
    body: InviteAcceptIn,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db, scope="function"),
    _=Depends(rate_limit("invite", lambda: 10, by="user")),
):
    inv = db.scalar(select(Invite).where(Invite.token_hash == hash_token(body.token)))
    now = utcnow()
    if not inv or inv.accepted_at or inv.expires_at <= now or inv.email != user.email.lower():
        # One message for every failure mode so tokens cannot be probed.
        raise HTTPException(400, "This invite is invalid, expired, or was issued to a different email address.")
    org = db.get(Organization, inv.org_id)
    if org is None:
        raise HTTPException(400, "This invite is invalid or expired.")
    if not db.scalar(select(Membership.id).where(Membership.org_id == org.id, Membership.user_id == user.id)):
        db.add(Membership(user_id=user.id, org_id=org.id, role=inv.role))
    inv.accepted_at = now
    audit.record(db, "invite.accept", request=request, org_id=org.id, user_id=user.id, target=inv.email)
    m = db.scalar(select(Membership).where(Membership.org_id == org.id, Membership.user_id == user.id))
    return OrgBrief(id=org.id, name=org.name, slug=org.slug, role=m.role if m else inv.role, is_personal=org.is_personal)


# ----------------------------------------------------------- provider keys
@router.put("/orgs/{org_id}/provider-keys/{provider}", status_code=204)
def set_provider_key(
    provider: str,
    body: ProviderKeyIn,
    request: Request,
    ctx: OrgContext = Depends(org_access(Role.admin)),
    db: Session = Depends(get_db, scope="function"),
):
    if provider not in PROVIDERS:
        raise HTTPException(404, "Unknown provider")
    key = body.api_key.strip()
    if any(c.isspace() for c in key):
        raise HTTPException(422, "API key must not contain whitespace.")
    row = db.scalar(select(ProviderKey).where(ProviderKey.org_id == ctx.org.id, ProviderKey.provider == provider))
    if row is None:
        row = ProviderKey(org_id=ctx.org.id, provider=provider, encrypted_key=b"", last4="")
        db.add(row)
    row.encrypted_key = encrypt_secret(key)
    row.last4 = key[-4:]
    audit.record(db, "provider_key.set", request=request, org_id=ctx.org.id, user_id=ctx.user.id, target=provider)
    return Response(status_code=204)


@router.delete("/orgs/{org_id}/provider-keys/{provider}", status_code=204)
def delete_provider_key(provider: str, request: Request, ctx: OrgContext = Depends(org_access(Role.admin)), db: Session = Depends(get_db, scope="function")):
    row = db.scalar(select(ProviderKey).where(ProviderKey.org_id == ctx.org.id, ProviderKey.provider == provider))
    if row:
        db.delete(row)
        audit.record(db, "provider_key.delete", request=request, org_id=ctx.org.id, user_id=ctx.user.id, target=provider)
    return Response(status_code=204)


# --------------------------------------------------------------- audit log
@router.get("/orgs/{org_id}/audit", response_model=list[AuditOut])
def get_audit(
    limit: int = 100,
    before_id: Optional[int] = None,
    action: Optional[str] = None,
    ctx: OrgContext = Depends(org_access(Role.admin)),
    db: Session = Depends(get_db, scope="function"),
):
    limit = max(1, min(limit, 500))
    q = select(AuditLog).where(AuditLog.org_id == ctx.org.id)
    if before_id:
        q = q.where(AuditLog.id < before_id)
    if action:
        q = q.where(AuditLog.action == action[:64])
    rows = db.scalars(q.order_by(AuditLog.id.desc()).limit(limit)).all()
    return [AuditOut.model_validate(r) for r in rows]
