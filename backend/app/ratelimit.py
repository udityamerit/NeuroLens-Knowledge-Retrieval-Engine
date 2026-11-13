"""In-memory sliding-window rate limiter (swap `_Store` for Redis when running several replicas)."""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from typing import Callable

from fastapi import HTTPException, Request, status

from .security import client_ip


class _Store:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window: float) -> tuple[bool, int]:
        """Record a hit. Returns (allowed, retry_after_seconds)."""
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                return False, max(1, int(window - (now - q[0])) + 1)
            q.append(now)
            if len(self._hits) > 50_000:  # opportunistic cleanup
                for k in [k for k, v in self._hits.items() if not v or now - v[-1] > window]:
                    self._hits.pop(k, None)
            return True, 0

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


store = _Store()


def rate_limit(name: str, limit: Callable[[], int], by: str = "user", window: float = 60.0):
    """FastAPI dependency factory. `by` is "user" (falls back to IP) or "ip"."""

    def dep(request: Request) -> None:
        ident = client_ip(request)
        if by == "user":
            uid = getattr(request.state, "user_id", None)
            if uid:
                ident = f"u:{uid}"
        allowed, retry = store.hit(f"{name}:{ident}", limit(), window)
        if not allowed:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Too many requests. Please slow down.",
                headers={"Retry-After": str(retry)},
            )

    return dep
