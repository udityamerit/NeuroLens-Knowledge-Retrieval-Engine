"""Embedding backends. `sentence-transformers` is the default; `hash` is a dependency-free
deterministic fallback (lexical feature hashing) used in tests and when the model cannot load."""
from __future__ import annotations

import logging
import re
import threading
import time
import zlib
from abc import ABC, abstractmethod

import numpy as np

from ..config import get_settings

log = logging.getLogger("neurolens.embeddings")
_TOKEN = re.compile(r"\w+", re.UNICODE)


class Embedder(ABC):
    name: str
    dim: int

    @abstractmethod
    def embed(self, texts: list[str]) -> np.ndarray:
        """Return float32 array (n, dim), L2-normalised."""


class HashEmbedder(Embedder):
    def __init__(self, dim: int = 384) -> None:
        self.dim = dim
        self.name = f"hash-{dim}"

    def embed(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for row, text in enumerate(texts):
            toks = _TOKEN.findall(text.lower())
            feats = toks + [f"{a}_{b}" for a, b in zip(toks, toks[1:])]
            for f in feats:
                h = zlib.crc32(f.encode("utf-8"))
                out[row, h % self.dim] += 1.0 if (h >> 16) & 1 else -1.0
        norms = np.linalg.norm(out, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return out / norms


GEMINI_OPENAI_URL = "https://generativelanguage.googleapis.com/v1beta/openai"
GEMINI_DEFAULT_MODEL = "gemini-embedding-001"
GEMINI_DEFAULT_DIM = 768  # 3072 by default; 768 keeps the database small with negligible quality loss


class EmbeddingError(RuntimeError):
    pass


class RemoteEmbedder(Embedder):
    """Embeddings from an OpenAI-compatible `/embeddings` endpoint (Gemini, Jina, Mistral, OpenAI ...)."""

    BATCH = 64
    RETRY_STATUS = {429, 500, 502, 503, 504}

    def __init__(self, url: str, api_key: str, model: str, dimensions: int | None = None, transport=None, sleep=None) -> None:
        import httpx

        self._endpoint = url.rstrip("/") + "/embeddings"
        self._key = api_key
        self._model = model
        self._dimensions = dimensions
        self._sleep = sleep or time.sleep
        self._client = httpx.Client(timeout=30.0, transport=transport)
        self.name = f"remote:{model}" + (f"@{dimensions}" if dimensions else "")
        self.dim = dimensions or 0
        if not self.dim:
            self.dim = int(self.embed(["dimension probe"]).shape[1])

    def _post(self, batch: list[str]) -> list[list[float]]:
        body: dict = {"model": self._model, "input": [t if t.strip() else " " for t in batch]}
        if self._dimensions:
            body["dimensions"] = self._dimensions
        last = ""
        for attempt in range(4):
            try:
                r = self._client.post(self._endpoint, json=body, headers={"Authorization": f"Bearer {self._key}"})
            except Exception as e:  # network error / timeout
                last = type(e).__name__
            else:
                if r.status_code == 200:
                    data = sorted(r.json()["data"], key=lambda d: d.get("index", 0))
                    if len(data) != len(batch):
                        raise EmbeddingError("Embedding service returned an unexpected number of vectors")
                    return [d["embedding"] for d in data]
                last = f"HTTP {r.status_code}"
                if r.status_code not in self.RETRY_STATUS:
                    raise EmbeddingError(f"Embedding service rejected the request ({last})")
            self._sleep(min(2 ** attempt, 8))
        raise EmbeddingError(f"Embedding service unavailable ({last})")

    def embed(self, texts: list[str]) -> np.ndarray:
        rows: list[list[float]] = []
        for i in range(0, len(texts), self.BATCH):
            rows += self._post(texts[i : i + self.BATCH])
        out = np.asarray(rows, dtype=np.float32).reshape(len(texts), -1)
        norms = np.linalg.norm(out, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return out / norms


def _build_remote(s) -> "Embedder | None":
    if not s.embedding_api_key:
        return None
    url = s.embedding_api_url or GEMINI_OPENAI_URL
    gemini = url == GEMINI_OPENAI_URL
    model = s.embedding_model
    if model.startswith("sentence-transformers/"):  # the local default is meaningless for a remote service
        model = GEMINI_DEFAULT_MODEL
    dims = s.embedding_dimensions or (GEMINI_DEFAULT_DIM if gemini else None)
    return RemoteEmbedder(url, s.embedding_api_key, model, dims)


class SentenceTransformerEmbedder(Embedder):
    def __init__(self, model_name: str) -> None:
        from sentence_transformers import SentenceTransformer

        self._model = SentenceTransformer(model_name)
        self.name = model_name
        self.dim = int(self._model.get_sentence_embedding_dimension())

    def embed(self, texts: list[str]) -> np.ndarray:
        vecs = self._model.encode(texts, batch_size=32, normalize_embeddings=True, show_progress_bar=False)
        return np.asarray(vecs, dtype=np.float32)


_lock = threading.Lock()
_embedder: Embedder | None = None


def get_embedder() -> Embedder:
    global _embedder
    if _embedder is not None:
        return _embedder
    with _lock:
        if _embedder is None:
            s = get_settings()
            if s.embedding_backend == "hash":
                _embedder = HashEmbedder()
            elif s.embedding_backend == "remote":
                _embedder = _build_remote(s)
                if _embedder is None:
                    log.warning("EMBEDDING_BACKEND=remote but EMBEDDING_API_KEY is not set; using hash embeddings.")
                    _embedder = HashEmbedder()
            else:
                try:
                    _embedder = SentenceTransformerEmbedder(s.embedding_model)
                except Exception as e:  # missing package / offline model download
                    if s.is_production:
                        raise
                    log.warning("Could not load %s (%s); falling back to hash embeddings (lower quality).", s.embedding_model, e)
                    _embedder = HashEmbedder()
    return _embedder


_warm_state = "idle"  # idle | loading | ready | failed


def embedder_status() -> str:
    if _embedder is not None:
        return "ready"
    return _warm_state if _warm_state in ("loading", "failed") else "idle"


def warm_up_async() -> None:
    """Load the embedding model in a background thread at startup.

    Without this the first upload (or first question) pays the whole cost of importing torch and loading
    or downloading the model, which can be tens of seconds. Server startup is not blocked.
    """
    global _warm_state
    if _embedder is not None or _warm_state == "loading" or get_settings().embedding_backend in ("hash", "remote"):
        return
    _warm_state = "loading"

    def _run() -> None:
        global _warm_state
        try:
            e = get_embedder()
            e.embed(["warm up"])  # first forward pass also initialises kernels / thread pools
            _warm_state = "ready"
            log.info("embedding model ready: %s", e.name)
        except Exception:
            _warm_state = "failed"
            log.exception("embedding warm-up failed")

    threading.Thread(target=_run, name="embedder-warmup", daemon=True).start()


def set_embedder(e: Embedder | None) -> None:
    """Test hook."""
    global _embedder
    _embedder = e
