"""Append-only audit trail. Never raises into the request path."""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import Request
from sqlalchemy.orm import Session

from .models import AuditLog
from .security import client_ip

log = logging.getLogger("neurolens.audit")


def record(
    db: Session,
    action: str,
    *,
    request: Optional[Request] = None,
    org_id: Optional[str] = None,
    user_id: Optional[str] = None,
    target: str = "",
    detail: Optional[dict] = None,
) -> None:
    try:
        ip = client_ip(request) if request is not None else ""
        db.add(
            AuditLog(
                org_id=org_id,
                user_id=user_id,
                action=action,
                target=(target or "")[:300],
                detail=detail or {},
                ip=ip,
            )
        )
        db.flush()
    except Exception:  # pragma: no cover - audit must never break a request
        log.exception("failed to write audit record %s", action)
