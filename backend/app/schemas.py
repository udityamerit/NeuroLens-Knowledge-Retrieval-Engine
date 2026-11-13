"""Pydantic request/response models."""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from .models import Role

Provider = Literal["groq", "openai", "openrouter"]


class _Base(BaseModel):
    model_config = ConfigDict(from_attributes=True, str_strip_whitespace=True)


# ------------------------------------------------------------------- auth
class RegisterIn(_Base):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)
    name: str = Field("", max_length=120)
    org_name: Optional[str] = Field(None, max_length=120)


class LoginIn(_Base):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class ChangePasswordIn(_Base):
    current_password: str = Field(max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class DeleteAccountIn(_Base):
    password: Optional[str] = Field(None, max_length=256)


class OrgBrief(_Base):
    id: str
    name: str
    slug: str
    role: Role
    is_personal: bool


class UserOut(_Base):
    id: str
    email: str
    name: str
    email_verified: bool
    has_password: bool
    is_superadmin: bool = False
    providers: list[str] = []


class TokenOut(_Base):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut
    orgs: list[OrgBrief]


class MeOut(_Base):
    user: UserOut
    orgs: list[OrgBrief]


class SSOProviderOut(_Base):
    id: str
    name: str


# --------------------------------------------------------------------- orgs
class OrgCreateIn(_Base):
    name: str = Field(min_length=2, max_length=120)


class OrgSettingsOut(_Base):
    id: str
    name: str
    slug: str
    is_personal: bool
    role: Role
    sso_domain: Optional[str]
    sso_default_role: Role
    redact_pii: bool
    allowed_providers: list[str]
    llm_provider: str
    llm_model: str
    temperature: float
    retrieval_k: int
    configured_providers: dict[str, dict]  # provider -> {"source": "org"|"platform", "last4": str}
    created_at: datetime


class OrgUpdateIn(_Base):
    name: Optional[str] = Field(None, min_length=2, max_length=120)
    sso_domain: Optional[str] = Field(None, max_length=255)
    sso_default_role: Optional[Role] = None
    redact_pii: Optional[bool] = None
    allowed_providers: Optional[list[Provider]] = None
    llm_provider: Optional[Provider] = None
    llm_model: Optional[str] = Field(None, max_length=120)
    temperature: Optional[float] = Field(None, ge=0, le=1)
    retrieval_k: Optional[int] = Field(None, ge=1, le=15)

    @field_validator("sso_domain")
    @classmethod
    def _domain(cls, v):
        if v is None or v == "":
            return None
        v = v.lower().lstrip("@")
        import re

        if not re.fullmatch(r"[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?)+", v):
            raise ValueError("Invalid domain")
        return v

    @field_validator("llm_model")
    @classmethod
    def _model(cls, v):
        if v is None or v == "":
            return v
        import re

        if not re.fullmatch(r"[A-Za-z0-9._:/\-]{1,120}", v):
            raise ValueError("Invalid model id")
        return v


class MemberOut(_Base):
    user_id: str
    email: str
    name: str
    role: Role
    joined_at: datetime


class MemberUpdateIn(_Base):
    role: Role


class InviteCreateIn(_Base):
    email: EmailStr
    role: Role = Role.member


class InviteOut(_Base):
    id: str
    email: str
    role: Role
    expires_at: datetime
    accepted_at: Optional[datetime]
    created_at: datetime
    token: Optional[str] = None  # only present immediately after creation
    accept_url: Optional[str] = None


class InviteAcceptIn(_Base):
    token: str = Field(min_length=10, max_length=200)


class ProviderKeyIn(_Base):
    api_key: str = Field(min_length=8, max_length=400)


class AuditOut(_Base):
    id: int
    action: str
    user_id: Optional[str]
    target: str
    detail: dict
    ip: str
    created_at: datetime


# ---------------------------------------------------------------- documents
class DocumentOut(_Base):
    id: str
    name: str
    kind: str
    size_bytes: int
    pages: int
    chunk_count: int
    suspicious_chunks: int
    source_url: Optional[str]
    created_at: datetime


class UploadErrorOut(_Base):
    file: Optional[str]
    error: str


class UploadOut(_Base):
    documents: list[DocumentOut]
    errors: list[UploadErrorOut] = []


class UrlIngestIn(_Base):
    url: str = Field(min_length=8, max_length=2000)


class ChunkOut(_Base):
    ordinal: int
    page: Optional[int]
    content: str
    suspicious: bool


class DocStatsOut(_Base):
    documents: int
    chunks: int
    storage_bytes: int
    storage_limit_bytes: int
    queries_today: int
    query_quota: int


# --------------------------------------------------------------------- chat
class ChatMessage(_Base):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=20000)


class ChatIn(_Base):
    query: str = Field(min_length=1, max_length=20000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=50)
    document_ids: Optional[list[str]] = Field(None, max_length=100)  # restrict retrieval to these docs
    image_data_url: Optional[str] = Field(None, max_length=8_000_000)  # optional attached image (vision)


class SourceOut(_Base):
    id: int
    document: str
    page: Optional[int]
    snippet: str
    score: float


class ChatOut(_Base):
    answer: str
    sources: list[SourceOut]
    flags: list[str]
    model: str
    provider: str


class TTSIn(_Base):
    text: str = Field(min_length=1, max_length=2500)
    voice_id: str = Field("21m00Tcm4TlvDq8ikWAM", pattern=r"^[A-Za-z0-9]{10,40}$")
