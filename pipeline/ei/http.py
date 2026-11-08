"""HTTP helpers: a shared rate limiter and retry-with-backoff GET."""

from __future__ import annotations

import random
import threading
import time
from typing import Any

import httpx


class RateLimiter:
    """Allows at most `rate` calls per second across all threads that share it."""

    def __init__(self, rate: float) -> None:
        self._interval = 1.0 / rate
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            if now < self._next:
                time.sleep(self._next - now)
                now = time.monotonic()
            self._next = now + self._interval


RETRY_STATUSES = {429, 500, 502, 503, 504}


def get_with_retries(
    client: httpx.Client,
    url: str,
    *,
    limiter: RateLimiter | None = None,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    attempts: int = 5,
) -> httpx.Response:
    """GET with exponential backoff on throttling/server errors. Raises on final failure."""
    delay = 1.0
    last_exc: Exception | None = None
    for attempt in range(attempts):
        if limiter:
            limiter.wait()
        try:
            resp = client.get(url, params=params, headers=headers)
            if resp.status_code not in RETRY_STATUSES:
                return resp
            last_exc = httpx.HTTPStatusError(f"HTTP {resp.status_code}", request=resp.request, response=resp)
        except httpx.TransportError as exc:
            last_exc = exc
        if attempt < attempts - 1:
            time.sleep(delay + random.uniform(0, 0.5))
            delay = min(delay * 2, 30)
    assert last_exc is not None
    raise last_exc
