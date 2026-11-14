"""RemoteEmbedder: OpenAI-compatible /embeddings client (mocked transport; no network, no real key)."""
import json

import httpx
import numpy as np
import pytest

from app.config import Settings
from app.rag import embeddings
from app.rag.embeddings import EmbeddingError, RemoteEmbedder, _build_remote


def _handler(calls, fail_first=0, status=429, dim=4):
    def handle(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        calls.append({"url": str(request.url), "auth": request.headers.get("authorization"), "body": body})
        if len(calls) <= fail_first:
            return httpx.Response(status)
        # reversed order on purpose: the client must sort by "index"
        data = [{"index": i, "embedding": [float(i + 1)] + [0.0] * (dim - 1)} for i in range(len(body["input"]))]
        return httpx.Response(200, json={"data": list(reversed(data))})

    return handle


def test_embeds_in_batches_sorted_and_normalised():
    calls: list = []
    e = RemoteEmbedder("https://x.test/v1/", "k", "m", dimensions=4, transport=httpx.MockTransport(_handler(calls)), sleep=lambda s: None)
    out = e.embed([f"t{i}" for i in range(70)])  # 64 + 6 -> two requests
    assert out.shape == (70, 4) and len(calls) == 2
    assert calls[0]["url"] == "https://x.test/v1/embeddings" and calls[0]["auth"] == "Bearer k"
    assert calls[0]["body"]["dimensions"] == 4 and e.name == "remote:m@4"
    assert np.allclose(np.linalg.norm(out, axis=1), 1.0)
    assert np.allclose(out[0], [1, 0, 0, 0])  # order preserved even though the server answered reversed


def test_dimension_is_probed_when_not_configured():
    e = RemoteEmbedder("https://x.test/v1", "k", "m", transport=httpx.MockTransport(_handler([], dim=7)), sleep=lambda s: None)
    assert e.dim == 7 and e.name == "remote:m"


def test_retries_rate_limits_then_succeeds():
    calls: list = []
    e = RemoteEmbedder("https://x.test", "k", "m", dimensions=4, transport=httpx.MockTransport(_handler(calls, fail_first=2)), sleep=lambda s: None)
    assert e.embed(["hello"]).shape == (1, 4) and len(calls) == 3


def test_gives_up_with_a_safe_message():
    e = RemoteEmbedder("https://x.test", "secret-key", "m", dimensions=4, transport=httpx.MockTransport(_handler([], fail_first=99, status=503)), sleep=lambda s: None)
    with pytest.raises(EmbeddingError) as ei:
        e.embed(["hello"])
    assert "secret-key" not in str(ei.value) and "503" in str(ei.value)


def test_client_errors_are_not_retried():
    calls: list = []
    e = RemoteEmbedder("https://x.test", "k", "m", dimensions=4, transport=httpx.MockTransport(_handler(calls, fail_first=99, status=401)), sleep=lambda s: None)
    with pytest.raises(EmbeddingError):
        e.embed(["hello"])
    assert len(calls) == 1


def test_gemini_defaults_when_only_a_key_is_given():
    s = Settings(EMBEDDING_BACKEND="remote", EMBEDDING_API_KEY="k", _env_file=None)
    captured = {}

    class Fake(RemoteEmbedder):
        def __init__(self, url, key, model, dimensions=None, **kw):
            captured.update(url=url, model=model, dimensions=dimensions)
            self.name, self.dim = "fake", dimensions or 0

    orig = embeddings.RemoteEmbedder
    embeddings.RemoteEmbedder = Fake
    try:
        _build_remote(s)
    finally:
        embeddings.RemoteEmbedder = orig
    assert captured == {"url": embeddings.GEMINI_OPENAI_URL, "model": "gemini-embedding-001", "dimensions": 768}


def test_missing_key_falls_back_to_hash(monkeypatch):
    monkeypatch.setattr(embeddings, "_embedder", None)
    monkeypatch.setattr(embeddings, "get_settings", lambda: Settings(EMBEDDING_BACKEND="remote", _env_file=None))
    try:
        assert embeddings.get_embedder().name.startswith("hash")
    finally:
        embeddings.set_embedder(None)
