"""Test harness: isolated SQLite DB per test, hash embeddings (no model download), mocked LLM."""
import os
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="neurolens-tests-"))
os.environ.update(
    NEUROLENS_ENV="test",
    EMBEDDING_BACKEND="hash",
    DATA_DIR=str(_TMP),
    SECRET_KEY="test-secret-key-" + "x" * 40,
    GROQ_API_KEY="gsk_" + "t" * 40,
    OPENAI_API_KEY="",
    OPENROUTER_API_KEY="",
    ELEVENLABS_API_KEY="",
    AUTH_RATE_LIMIT_PER_MINUTE="1000",
    RATE_LIMIT_PER_MINUTE="1000",
    CHAT_RATE_LIMIT_PER_MINUTE="1000",
)
os.environ.pop("DATABASE_URL", None)
for var in ("GOOGLE_CLIENT_ID", "GITHUB_CLIENT_ID", "MICROSOFT_CLIENT_ID"):
    os.environ.pop(var, None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import ratelimit  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import create_all, init_engine  # noqa: E402
from app.main import app  # noqa: E402
from app.rag import embeddings, llm, store  # noqa: E402

STRONG_PW = "Correct-Horse-9-Battery"


@pytest.fixture(autouse=True)
def fresh_state(tmp_path):
    init_engine(f"sqlite:///{(tmp_path / 'test.db').as_posix()}")
    create_all()
    ratelimit.store.reset()
    store.clear_cache()
    embeddings.set_embedder(None)
    yield


@pytest.fixture
def settings():
    return get_settings()


@pytest.fixture
def client():
    return TestClient(app, base_url="http://testserver")


@pytest.fixture
def llm_calls(monkeypatch):
    """Replace the network LLM call; records every message list that would have been sent."""
    calls = []

    def fake_chat(r, messages, **kw):
        calls.append({"resolved": r, "messages": messages, "kw": kw})
        return "Mocked answer [doc.txt]"

    monkeypatch.setattr(llm, "chat", fake_chat)
    return calls


def register(client, email="alice@example.com", password=STRONG_PW, **extra):
    r = client.post("/api/auth/register", json={"email": email, "password": password, "name": email.split("@")[0], **extra})
    assert r.status_code == 201, r.text
    return r.json()


def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def make_user():
    """Factory returning a dict with its own cookie jar, auth headers and personal org id."""

    def _make(email, team=True, **extra):
        c = TestClient(app, base_url="http://testserver")
        data = register(c, email, **extra)
        headers = auth(data["access_token"])
        org_id = data["orgs"][0]["id"]
        personal_id = org_id
        if team:  # personal orgs cannot have members, so default to a team org
            r = c.post("/api/orgs", headers=headers, json={"name": f"{email.split('@')[0]} team"})
            assert r.status_code == 201, r.text
            org_id = r.json()["id"]
        return {"client": c, "headers": headers, "org_id": org_id, "personal_id": personal_id, "data": data}

    return _make
