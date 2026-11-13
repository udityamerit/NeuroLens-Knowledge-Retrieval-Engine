"""Ingestion speed-ups: duplicate chunks are embedded once; model warm-up is non-blocking and observable."""
import numpy as np

from app.rag import embeddings, store


class CountingEmbedder(embeddings.HashEmbedder):
    def __init__(self):
        super().__init__()
        self.seen = 0

    def embed(self, texts):
        self.seen += len(texts)
        return super().embed(texts)


def test_duplicate_chunks_embedded_once(monkeypatch):
    emb = CountingEmbedder()
    monkeypatch.setattr(store, "get_embedder", lambda: emb)
    texts = ["alpha beta", "gamma delta", "alpha beta", "alpha beta", "gamma delta"]
    out = store._embed_batched(texts)
    assert emb.seen == 2
    assert out.shape == (5, emb.dim)
    assert np.allclose(out[0], out[2]) and np.allclose(out[1], out[4])
    assert not np.allclose(out[0], out[1])


def test_no_duplicates_path_unchanged(monkeypatch):
    emb = CountingEmbedder()
    monkeypatch.setattr(store, "get_embedder", lambda: emb)
    out = store._embed_batched(["one two", "three four"])
    assert emb.seen == 2 and out.shape == (2, emb.dim)


def test_warm_up_is_noop_for_hash_backend():
    embeddings.warm_up_async()  # tests run with EMBEDDING_BACKEND=hash
    assert embeddings.embedder_status() in ("idle", "ready")


def test_ready_reports_embedder(client):
    r = client.get("/ready")
    assert r.status_code == 200
    assert r.json()["embedder"] in ("idle", "loading", "ready", "failed")
