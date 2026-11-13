"""Password hashing, JWTs, refresh tokens, secret encryption and FastAPI auth dependencies."""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import ROLE_RANK, Membership, Organization, Role, User, utcnow

_hasher = PasswordHasher()  # argon2id with library defaults
JWT_ALG = "HS256"
ISSUER = "neurolens"

_COMMON_PASSWORDS = {
    "password", "password1", "password123", "123456789", "1234567890", "qwertyuiop", "letmein123",
    "iloveyou123", "admin12345", "welcome123", "changeme123", "passw0rd123", "abcdefghij",
}


# ----------------------------------------------------------------- passwords
def validate_password_strength(password: str, email: str = "") -> Optional[str]:
    """Return an error message, or None if acceptable."""
    s = get_settings()
    if len(password) < s.password_min_length:
        return f"Password must be at least {s.password_min_length} characters."
    if len(password) > 256:
        return "Password is too long."
    if password.lower() in _COMMON_PASSWORDS or len(set(password)) < 5:
        return "Password is too common or too repetitive."
    local = email.split("@")[0].lower() if email else ""
    if local and len(local) >= 4 and local in password.lower():
        return "Password must not contain your email name."
    classes = sum(bool(re.search(p, password)) for p in (r"[a-z]", r"[A-Z]", r"\d", r"[^A-Za-z0-9]"))
    if classes < 3:
        return "Use at least three of: lowercase, uppercase, digits, symbols."
    return None


def hash_password(password: str) -> str:
    return _hasher.hash(password)


# A real hash used to equalise timing when the user does not exist.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def verify_password(password: str, password_hash: Optional[str]) -> bool:
    try:
        _hasher.verify(password_hash or _DUMMY_HASH, password)
        return password_hash is not None
    except (VerifyMismatchError, InvalidHashError):
        return False
    except Exception:
        return False


def needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except Exception:
        return False


# ----------------------------------------------------------------------- JWT
def create_access_token(user: User) -> tuple[str, int]:
    s = get_settings()
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=s.access_token_minutes)
    payload = {
        "iss": ISSUER,
        "sub": user.id,
        "ver": user.token_version,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "jti": uuid.uuid4().hex,
        "typ": "access",
    }
    return jwt.encode(payload, s.secret_key, algorithm=JWT_ALG), s.access_token_minutes * 60


def decode_access_token(token: str) -> dict:
    s = get_settings()
    return jwt.decode(
        token,
        s.secret_key,
        algorithms=[JWT_ALG],  # pinned: never trust the header's alg
        issuer=ISSUER,
        options={"require": ["exp", "iat", "sub", "iss"]},
    )


# ------------------------------------------------------------ opaque tokens
def new_opaque_token() -> str:
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ------------------------------------------------------------- encryption
def _fernet() -> Fernet:
    s = get_settings()
    if s.encryption_key:
        return Fernet(s.encryption_key.encode())
    derived = hashlib.sha256(b"neurolens-enc-v1|" + (s.secret_key or "").encode()).digest()
    return Fernet(base64.urlsafe_b64encode(derived))


def encrypt_secret(plain: str) -> bytes:
    return _fernet().encrypt(plain.encode("utf-8"))


def decrypt_secret(blob: bytes) -> Optional[str]:
    try:
        return _fernet().decrypt(blob).decode("utf-8")
    except (InvalidToken, ValueError):
        return None


def constant_time_eq(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


# ------------------------------------------------------------ dependencies
def client_ip(request: Request) -> str:
    s = get_settings()
    if s.trust_proxy_headers:
        xff = request.headers.get("x-forwarded-for")
        if xff:
            return xff.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "unknown")[:64]


def _unauthorized(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail, headers={"WWW-Authenticate": "Bearer"})


def current_user(request: Request, db: Session = Depends(get_db, scope="function")) -> User:
    auth = request.headers.get("authorization", "")
    scheme, _, token = auth.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized()
    try:
        claims = decode_access_token(token.strip())
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Token expired")
    except jwt.PyJWTError:
        raise _unauthorized("Invalid token")
    if claims.get("typ") != "access":
        raise _unauthorized("Invalid token")
    user = db.get(User, claims["sub"])
    if user is None or not user.is_active or claims.get("ver") != user.token_version:
        raise _unauthorized("Session is no longer valid")
    request.state.user_id = user.id
    return user


@dataclass
class OrgContext:
    user: User
    org: Organization
    membership: Membership

    @property
    def role(self) -> Role:
        return self.membership.role


def org_access(min_role: Role = Role.viewer) -> Callable[..., OrgContext]:
    """Dependency factory: authenticate, resolve {org_id} and enforce a minimum role.

    Non-members receive 404 (not 403) so organisation ids cannot be enumerated.
    """

    def dep(org_id: str, user: User = Depends(current_user), db: Session = Depends(get_db, scope="function")) -> OrgContext:
        m = db.scalar(select(Membership).where(Membership.user_id == user.id, Membership.org_id == org_id))
        if m is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
        if ROLE_RANK[m.role] < ROLE_RANK[min_role]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires {min_role.value} role or higher")
        org = db.get(Organization, org_id)
        if org is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
        return OrgContext(user=user, org=org, membership=m)

    return dep
