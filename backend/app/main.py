"""FastAPI application factory."""
from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import get_settings
from .db import create_all, get_engine, init_engine
from .rag.embeddings import embedder_status, warm_up_async
from .routers import auth, chat, documents, orgs, sso

log = logging.getLogger("neurolens")

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}


def create_app() -> FastAPI:
    s = get_settings()
    logging.basicConfig(level=getattr(logging, s.log_level.upper(), logging.INFO), format="%(asctime)s %(levelname)s %(name)s %(message)s")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        init_engine()
        create_all()
        warm_up_async()  # no-op for the hash backend (tests)
        yield

    app = FastAPI(
        title="NeuroLens API",
        version="2.0.0",
        lifespan=lifespan,
        docs_url=None if s.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if s.is_production else "/openapi.json",
    )

    # Order matters: the last added runs first. Request-id/headers wrap everything.
    max_body = (s.max_upload_mb * s.max_files_per_upload + 1) * 1024 * 1024

    @app.middleware("http")
    async def guard(request: Request, call_next):
        rid = request.headers.get("x-request-id", "")[:64] or uuid.uuid4().hex[:16]
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > max_body:
            resp = JSONResponse({"detail": "Request body too large"}, status_code=413)
        else:
            try:
                resp = await call_next(request)
            except Exception:
                log.exception("unhandled error rid=%s %s %s", rid, request.method, request.url.path)
                resp = JSONResponse({"detail": "Internal server error", "request_id": rid}, status_code=500)
        for k, v in SECURITY_HEADERS.items():
            resp.headers.setdefault(k, v)
        if s.effective_cookie_secure:
            resp.headers.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
        if request.url.path.startswith("/api/"):
            resp.headers.setdefault("Cache-Control", "no-store")
        resp.headers["X-Request-ID"] = rid
        return resp

    app.add_middleware(
        SessionMiddleware,  # only used for the short-lived OAuth state/PKCE data during SSO
        secret_key=s.secret_key,
        session_cookie="nl_sso",
        max_age=600,
        same_site="lax",
        https_only=s.effective_cookie_secure,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Requested-With", "X-Request-ID"],
        expose_headers=["X-Request-ID", "Retry-After"],
        max_age=600,
    )
    if s.trusted_hosts and s.trusted_hosts != ["*"]:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=s.trusted_hosts)

    @app.exception_handler(StarletteHTTPException)
    async def http_exc(_: Request, exc: StarletteHTTPException):
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def validation_exc(_: Request, exc: RequestValidationError):
        # Report which fields failed without echoing submitted values (they may contain passwords).
        fields = [{"field": ".".join(str(p) for p in e["loc"] if p != "body"), "message": e["msg"]} for e in exc.errors()]
        msg = "; ".join(f"{f['field']}: {f['message']}" if f["field"] else f["message"] for f in fields)
        return JSONResponse({"detail": msg or "Invalid request", "errors": fields}, status_code=422)

    @app.get("/health", tags=["meta"])
    def health():
        return {"status": "ok"}

    @app.get("/ready", tags=["meta"])
    def ready():
        try:
            with get_engine().connect() as c:
                c.execute(text("SELECT 1"))
        except Exception:
            return JSONResponse({"status": "unavailable"}, status_code=503)
        return {"status": "ready", "embedder": embedder_status()}

    for r in (auth.router, sso.router, orgs.router, documents.router, chat.router):
        app.include_router(r)
    return app


app = create_app()
