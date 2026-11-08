"""Daily price data behind a swappable provider interface."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Protocol

import httpx

from ei.http import RateLimiter, get_with_retries


@dataclass(frozen=True)
class PriceBar:
    day: date
    close: float
    adj_close: float
    volume: int | None


class PriceProvider(Protocol):
    name: str
    daily_limit: int

    def daily(self, ticker: str, start: date, end: date | None = None) -> list[PriceBar]: ...


class TiingoProvider:
    """Tiingo end-of-day prices (free tier: 1,000 requests/day, 50/hour, 500 unique symbols/month)."""

    name = "tiingo"
    daily_limit = 1000

    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise RuntimeError("TIINGO_API_KEY is not set")
        self._client = httpx.Client(
            headers={"Authorization": f"Token {api_key}", "Content-Type": "application/json"}, timeout=60
        )
        self._limiter = RateLimiter(rate=2)

    def close(self) -> None:
        self._client.close()

    @staticmethod
    def _symbol(ticker: str) -> str:
        # SEC uses BRK-B style; Tiingo uses the same dash convention.
        return ticker.replace(".", "-").lower()

    def daily(self, ticker: str, start: date, end: date | None = None) -> list[PriceBar]:
        params = {"startDate": start.isoformat(), "resampleFreq": "daily"}
        if end:
            params["endDate"] = end.isoformat()
        resp = get_with_retries(
            self._client,
            f"https://api.tiingo.com/tiingo/daily/{self._symbol(ticker)}/prices",
            limiter=self._limiter,
            params=params,
        )
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        return [
            PriceBar(
                day=date.fromisoformat(r["date"][:10]),
                close=float(r["close"]),
                adj_close=float(r["adjClose"]),
                volume=int(r["volume"]) if r.get("volume") is not None else None,
            )
            for r in resp.json()
        ]
