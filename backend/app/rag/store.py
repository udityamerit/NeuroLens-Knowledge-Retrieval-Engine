"""Per-organisation vector + keyword index.

Source of truth is the database (chunks + float32 embeddings). A FAISS inner-product index and a BM25
posting list are built lazily per organisation and cached in memory. A cheap (count, max id) stamp is
checked on every search, so several worker processes stay consistent without any pickled index files.
Retrieval is hybrid (dense + BM25, reciprocal-rank fusion) followed by a fair-share pass across documents.
"""
from __future__ import annotations

import logging
import math
import re
import threading
from collections import OrderedDict, defaultdict
from dataclasses import dataclass
from typing import Optional

import faiss
import numpy as np
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..guardrails import looks_like_prompt_injection
from ..models import Chunk, Document, utcnow
from .embeddings import get_embedder
from .loaders import Segment, chunk_segments

log = logging.getLogger("neurolens.store")
_TOKEN = re.compile(r"\w+", re.UNICODE)
_STOP = frozenset("a an and are as at be by for from has have in is it its of on or that the this to was were will with".split())
# Words that carry no topic in a *question* (pronouns, question words, filler verbs). They are dropped from the
# query only, so "who builds you" is left with almost nothing to match and cannot latch onto unrelated chunks.
_QUERY_STOP = _STOP | frozenset(
    "i me my mine we us our you your yours he she they them their who whom whose what which when where why how "
    "do does did done can could would should shall may might must am been being get got give tell show say said "
    "please about any some there here also just very so if then than but not no yes me use used using uses".split()
)
MAX_CACHED_ORGS = 32


def _stem(t: str) -> str:
    """Very light suffix stripping so "features"/"feature" and "deploying"/"deploy" match lexically."""
    n = len(t)
    if n > 4 and t.endswith("ies"):
        return t[:-3] + "y"
    if n > 4 and t.endswith("es") and t[-3] in "sxz":
        return t[:-2]
    if n > 3 and t.endswith("s") and not t.endswith("ss"):
        return t[:-1]
    if n > 6 and t.endswith("ing"):
        return t[:-3]
    if n > 5 and t.endswith("ed"):
        return t[:-2]
    return t


def tokenize(text: str) -> list[str]:
    return [_stem(t) for t in _TOKEN.findall(text.lower()) if t not in _STOP and len(t) > 1]


def query_terms(text: str) -> list[str]:
    return [_stem(t) for t in _TOKEN.findall(text.lower()) if t not in _QUERY_STOP and len(t) > 1]


@dataclass
class Hit:
    chunk_id: int
    document_id: str
    document: str
    page: Optional[int]
    content: str
    suspicious: bool
    score: float


class OrgIndex:
    def __init__(self, stamp, rows, vecs: np.ndarray, dim: int) -> None:
        self.stamp = stamp
        self.rows = rows  # list of (chunk_id, doc_id, doc_name, page, content, suspicious)
        self.dim = dim
        self.index = faiss.IndexFlatIP(dim)
        if len(rows):
            self.index.add(np.ascontiguousarray(vecs, dtype=np.float32))
        self.doc_len: list[int] = []
        self.postings: dict[str, list[tuple[int, int]]] = defaultdict(list)
        for i, r in enumerate(rows):
            toks = tokenize(r[4])
            self.doc_len.append(len(toks))
            counts: dict[str, int] = defaultdict(int)
            for t in toks:
                counts[t] += 1
            for t, c in counts.items():
                self.postings[t].append((i, c))
        self.avg_len = (sum(self.doc_len) / len(self.doc_len)) if self.doc_len else 0.0

    def __len__(self) -> int:
        return len(self.rows)

    def bm25(self, query: str, allowed: Optional[np.ndarray], limit: int) -> list[tuple[int, float]]:
        n = len(self.rows)
        if not n:
            return []
        scores: dict[int, float] = defaultdict(float)
        k1, b = 1.5, 0.75
        for term in set(query_terms(query)):
            plist = self.postings.get(term)
            if not plist:
                continue
            idf = math.log(1 + (n - len(plist) + 0.5) / (len(plist) + 0.5))
            for i, tf in plist:
                if allowed is not None and not allowed[i]:
                    continue
                denom = tf + k1 * (1 - b + b * self.doc_len[i] / (self.avg_len or 1))
                scores[i] += idf * tf * (k1 + 1) / denom
        return sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:limit]

    def coverage(self, query: str) -> dict[int, float]:
        """Fraction of the query's content words that literally occur in each chunk (only chunks with >=1 hit)."""
        terms = set(query_terms(query))
        if not terms:
            return {}
        hits: dict[int, int] = defaultdict(int)
        for term in terms:
            for i, _tf in self.postings.get(term, ()):
                hits[i] += 1
        return {i: c / len(terms) for i, c in hits.items()}

    def similarity(self, qvec: np.ndarray, i: int) -> float:
        return float(np.dot(self.index.reconstruct(int(i)), qvec))

    def dense(self, qvec: np.ndarray, allowed: Optional[np.ndarray], limit: int) -> list[tuple[int, float]]:
        n = len(self.rows)
        if not n:
            return []
        kk = n if allowed is not None else min(n, limit)
        sims, idxs = self.index.search(np.ascontiguousarray(qvec.reshape(1, -1), dtype=np.float32), kk)
        out = []
        for s, i in zip(sims[0], idxs[0]):
            if i < 0 or (allowed is not None and not allowed[i]):
                continue
            out.append((int(i), float(s)))
            if len(out) >= limit:
                break
        return out


_cache: "OrderedDict[str, OrgIndex]" = OrderedDict()
_lock = threading.RLock()


def invalidate(org_id: str) -> None:
    with _lock:
        _cache.pop(org_id, None)


def clear_cache() -> None:
    with _lock:
        _cache.clear()


def _stamp(db: Session, org_id: str):
    cnt, mx = db.execute(select(func.count(Chunk.id), func.max(Chunk.id)).where(Chunk.org_id == org_id)).one()
    return (int(cnt or 0), int(mx or 0), get_embedder().name)


def _reembed_stale(db: Session, org_id: str) -> None:
    """Documents embedded with a different model than the active one are re-embedded in place."""
    emb = get_embedder()
    stale = db.scalars(select(Document).where(Document.org_id == org_id, Document.embed_model != emb.name)).all()
    for doc in stale:
        chunks = db.scalars(select(Chunk).where(Chunk.document_id == doc.id).order_by(Chunk.ordinal)).all()
        if chunks:
            vecs = _embed_batched([c.content for c in chunks])
            for c, v in zip(chunks, vecs):
                c.embedding = v.astype(np.float32).tobytes()
        doc.embed_model = emb.name
        log.info("re-embedded document %s with %s", doc.id, emb.name)
    if stale:
        db.flush()


def get_index(db: Session, org_id: str) -> OrgIndex:
    emb = get_embedder()
    with _lock:
        cached = _cache.get(org_id)
    stamp = _stamp(db, org_id)
    if cached is not None and cached.stamp == stamp:
        with _lock:
            _cache.move_to_end(org_id)
        return cached
    _reembed_stale(db, org_id)
    q = (
        select(Chunk.id, Chunk.document_id, Document.name, Chunk.page, Chunk.content, Chunk.suspicious, Chunk.embedding)
        .join(Document, Document.id == Chunk.document_id)
        .where(Chunk.org_id == org_id)
        .order_by(Chunk.id)
    )
    rows, vecs = [], []
    for cid, did, dname, page, content, susp, blob in db.execute(q):
        v = np.frombuffer(blob, dtype=np.float32)
        if v.shape[0] != emb.dim:
            continue
        rows.append((cid, did, dname, page, content, bool(susp)))
        vecs.append(v)
    arr = np.vstack(vecs) if vecs else np.zeros((0, emb.dim), dtype=np.float32)
    idx = OrgIndex(stamp, rows, arr, emb.dim)
    with _lock:
        _cache[org_id] = idx
        _cache.move_to_end(org_id)
        while len(_cache) > MAX_CACHED_ORGS:
            _cache.popitem(last=False)
    return idx


def _embed_batched(texts: list[str], batch: int = 64) -> np.ndarray:
    emb = get_embedder()
    if not texts:
        return np.zeros((0, emb.dim), dtype=np.float32)
    # Repeated chunks (headers, footers, boilerplate) are embedded once; the vector is reused.
    unique = list(dict.fromkeys(texts))
    parts = [emb.embed(unique[i : i + batch]) for i in range(0, len(unique), batch)]
    vecs = np.vstack(parts).astype(np.float32)
    if len(unique) == len(texts):
        return vecs
    pos = {t: i for i, t in enumerate(unique)}
    return vecs[[pos[t] for t in texts]]


# ------------------------------------------------------------- ingestion
def ingest_document(
    db: Session,
    *,
    org_id: str,
    name: str,
    kind: str,
    segments: list[Segment],
    size_bytes: int,
    sha256: str,
    pages: int,
    uploaded_by: Optional[str],
    source_url: Optional[str] = None,
) -> Document:
    """Create (or atomically replace) a document and its embedded chunks."""
    pieces = chunk_segments(segments)
    if not pieces:
        raise ValueError("Document produced no indexable text.")
    vecs = _embed_batched([t for _, t in pieces])  # embed before touching the DB
    old = db.scalar(select(Document).where(Document.org_id == org_id, Document.name == name))
    if old is not None:
        db.delete(old)
        db.flush()
    suspicious = [looks_like_prompt_injection(t) for _, t in pieces]
    doc = Document(
        org_id=org_id, name=name, kind=kind, size_bytes=size_bytes, sha256=sha256, source_url=source_url,
        pages=pages, chunk_count=len(pieces), suspicious_chunks=sum(suspicious), uploaded_by=uploaded_by,
        embed_model=get_embedder().name,
    )
    db.add(doc)
    db.flush()
    db.add_all(
        Chunk(
            org_id=org_id, document_id=doc.id, ordinal=i, page=page, content=text,
            embedding=vecs[i].tobytes(), suspicious=suspicious[i],
        )
        for i, (page, text) in enumerate(pieces)
    )
    db.flush()
    invalidate(org_id)
    return doc


def delete_document(db: Session, org_id: str, doc_id: str) -> bool:
    doc = db.scalar(select(Document).where(Document.id == doc_id, Document.org_id == org_id))
    if not doc:
        return False
    db.execute(delete(Chunk).where(Chunk.document_id == doc.id))
    db.delete(doc)
    db.flush()
    invalidate(org_id)
    return True


def clear_org(db: Session, org_id: str) -> int:
    n = db.scalar(select(func.count(Document.id)).where(Document.org_id == org_id)) or 0
    db.execute(delete(Chunk).where(Chunk.org_id == org_id))
    db.execute(delete(Document).where(Document.org_id == org_id))
    db.flush()
    invalidate(org_id)
    return int(n)


# --------------------------------------------------------------- retrieval
RRF_K = 60
LEXICAL_RESCUE = 0.5  # share of the question's content words a chunk must contain to count as relevant without vector support
HASH_MIN_SCORE = 0.30  # hash cosine scores are small and noisy; only a clearly strong one counts, otherwise word overlap decides
HASH_LEXICAL_RESCUE = 0.34


def search(
    db: Session,
    org_id: str,
    query: str,
    *,
    k: int = 5,
    document_ids: Optional[list[str]] = None,
    min_score: Optional[float] = None,
) -> list[Hit]:
    idx = get_index(db, org_id)
    if not len(idx) or not query.strip():
        return []
    allowed = None
    if document_ids is not None:
        wanted = set(document_ids)
        allowed = np.array([r[1] in wanted for r in idx.rows], dtype=bool)
        if not allowed.any():
            return []
    pool = max(30, k * 6)
    qvec = get_embedder().embed([query])[0]
    dense = idx.dense(qvec, allowed, pool)
    lexical = idx.bm25(query, allowed, pool)
    dense_score = dict(dense)
    fused: dict[int, float] = defaultdict(float)
    for rank, (i, _) in enumerate(dense):
        fused[i] += 1.0 / (RRF_K + rank + 1)
    for rank, (i, _) in enumerate(lexical):
        fused[i] += 1.0 / (RRF_K + rank + 1)
    ranked = [i for i, _ in sorted(fused.items(), key=lambda kv: kv[1], reverse=True)]

    # Relevance gate: ranking alone always yields *something*; keep only passages that are actually about the
    # question - semantically close enough, or sharing most of its content words. Nothing relevant -> no hits.
    # Hash embeddings are purely lexical, so their cosine scores are low even for on-topic chunks; the MiniLM-tuned
    # thresholds would discard nearly everything. Use lexical thresholds for them instead.
    lexical_only = get_embedder().name.startswith("hash")
    if min_score is None:
        min_score = HASH_MIN_SCORE if lexical_only else get_settings().retrieval_min_score
    rescue = HASH_LEXICAL_RESCUE if lexical_only else LEXICAL_RESCUE
    cover = idx.coverage(query)
    kept: list[int] = []
    for i in ranked:
        sim = dense_score.get(i)
        if sim is None:
            sim = idx.similarity(qvec, i)
            dense_score[i] = sim
        if sim >= min_score or cover.get(i, 0.0) >= rescue:
            kept.append(i)
    ranked = kept
    if not ranked:
        return []

    # Fair share: round-robin across the documents represented near the top so one big file cannot crowd out the rest.
    top = ranked[: max(k * 2, k)]
    by_doc: "OrderedDict[str, list[int]]" = OrderedDict()
    for i in top:
        by_doc.setdefault(idx.rows[i][1], []).append(i)
    picked: list[int] = []
    while len(picked) < k and any(by_doc.values()):
        for lst in by_doc.values():
            if lst and len(picked) < k:
                picked.append(lst.pop(0))
    if len(picked) < k:  # top-up from the remaining ranked list
        for i in ranked:
            if i not in picked:
                picked.append(i)
            if len(picked) >= k:
                break
    hits = []
    for i in picked:
        cid, did, dname, page, content, susp = idx.rows[i]
        hits.append(Hit(cid, did, dname, page, content, susp, float(dense_score.get(i, 0.0))))
    return hits


def overview(db: Session, org_id: str, *, k: int = 5, document_ids: Optional[list[str]] = None) -> list[Hit]:
    """The opening passages of each document (round-robin), for broad requests like "summarize" or "tell me"."""
    idx = get_index(db, org_id)
    wanted = set(document_ids) if document_ids is not None else None
    by_doc: "OrderedDict[str, list[int]]" = OrderedDict()
    for i, r in enumerate(idx.rows):  # rows are ordered by chunk id, i.e. document order within each document
        if wanted is None or r[1] in wanted:
            by_doc.setdefault(r[1], []).append(i)
    picked: list[int] = []
    while len(picked) < k and any(by_doc.values()):
        for lst in by_doc.values():
            if lst and len(picked) < k:
                picked.append(lst.pop(0))
    return [Hit(idx.rows[i][0], idx.rows[i][1], idx.rows[i][2], idx.rows[i][3], idx.rows[i][4], idx.rows[i][5], 0.0) for i in picked]


def usage_stats(db: Session, org_id: str) -> tuple[int, int, int]:
    docs, size = db.execute(
        select(func.count(Document.id), func.coalesce(func.sum(Document.size_bytes), 0)).where(Document.org_id == org_id)
    ).one()
    chunks = db.scalar(select(func.count(Chunk.id)).where(Chunk.org_id == org_id)) or 0
    return int(docs), int(chunks), int(size)
