"""SQLAlchemy engine/session management (SQLite by default, Postgres via DATABASE_URL)."""
from __future__ import annotations

import threading
from typing import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


_engine: Engine | None = None
_SessionLocal: sessionmaker | None = None


def _make_engine(url: str) -> Engine:
    kwargs: dict = {"pool_pre_ping": True, "future": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
        if ":memory:" in url or url.endswith("sqlite://"):
            from sqlalchemy.pool import StaticPool

            kwargs["poolclass"] = StaticPool
    else:
        # Hosted Postgres (Neon, Supabase...) sits behind a connection pooler in transaction mode, which cannot
        # keep server-side prepared statements, and drops idle connections; keep the local pool small and fresh.
        kwargs["connect_args"] = {"prepare_threshold": None}
        kwargs.update(pool_size=3, max_overflow=2, pool_recycle=240)
    eng = create_engine(url, **kwargs)
    if url.startswith("sqlite"):

        @event.listens_for(eng, "connect")
        def _sqlite_pragmas(dbapi_conn, _):  # pragma: no cover - trivial
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA busy_timeout=5000")
            cur.close()

    return eng


def init_engine(url: str | None = None) -> Engine:
    global _engine, _SessionLocal, _schema_ready
    _schema_ready = False
    if _engine is not None:
        _engine.dispose()
    _engine = _make_engine(url or get_settings().effective_database_url)
    _SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False, future=True)
    return _engine


def get_engine() -> Engine:
    if _engine is None:
        init_engine()
    assert _engine is not None
    return _engine


def create_all() -> None:
    from . import models  # noqa: F401  (register tables)

    Base.metadata.create_all(get_engine())


_schema_lock = threading.Lock()
_schema_ready = False


def ensure_schema() -> None:
    """Create tables once per process. Safe to call on every request (a flag check after the first time).

    Serverless hosts may not run the ASGI lifespan, so the first request makes sure the schema exists.
    """
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if not _schema_ready:
            create_all()
            _schema_ready = True




def get_db() -> Iterator[Session]:
    if _SessionLocal is None:
        init_engine()
    assert _SessionLocal is not None
    db = _SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def session_scope() -> Session:
    """A plain session for use outside request handling (caller must close)."""
    if _SessionLocal is None:
        init_engine()
    assert _SessionLocal is not None
    return _SessionLocal()
