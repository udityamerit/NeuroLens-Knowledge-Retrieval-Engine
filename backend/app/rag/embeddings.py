"""Embedding backends. `sentence-transformers` is the default; `hash` is a dependency-free
deterministic fallback (lexical feature hashing) used in tests and when the model cannot load."""
from __future__ import annotations

import logging
import re
import threading
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
    if _embedder is not None or _warm_state == "loading" or get_settings().embedding_backend == "hash":
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
