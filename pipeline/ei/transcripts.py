"""Earnings call transcripts and report dates behind a swappable provider interface.

Alpha Vantage free tier: 25 requests/day and at most 1 request/second. Every request is counted
in the api_usage table; when the day's quota is used up, work is deferred instead of failing.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Protocol

import httpx

from ei.http import RateLimiter, get_with_retries


class QuotaReached(RuntimeError):
    """The provider's free daily quota is used up; retry tomorrow."""


@dataclass(frozen=True)
class Turn:
    speaker: str
    title: str
    content: str


@dataclass(frozen=True)
class EarningsEvent:
    period_end: date
    report_date: date
    report_time: str | None
    eps_reported: float | None
    eps_estimated: float | None


class TranscriptProvider(Protocol):
    name: str
    daily_limit: int

    def transcript(self, ticker: str, fiscal_year: int, fiscal_quarter: int) -> list[Turn] | None: ...

    def earnings_events(self, ticker: str) -> list[EarningsEvent]: ...


def _num(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


class AlphaVantageProvider:
    name = "alpha_vantage"
    daily_limit = 25
    URL = "https://www.alphavantage.co/query"

    def __init__(self, api_key: str, quota_check: Any = None) -> None:
        """`quota_check()` is called before every request and must raise QuotaReached when exhausted."""
        if not api_key:
            raise RuntimeError("ALPHA_VANTAGE_API_KEY is not set")
        self._key = api_key
        self._client = httpx.Client(timeout=60)
        self._limiter = RateLimiter(rate=0.6)  # one request every ~1.7s (free tier allows 1/s)
        self._quota_check = quota_check

    def close(self) -> None:
        self._client.close()

    def _get(self, params: dict[str, str]) -> dict[str, Any]:
        if self._quota_check:
            self._quota_check()
        resp = get_with_retries(self._client, self.URL, limiter=self._limiter, params={**params, "apikey": self._key})
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()
        notice = data.get("Information") or data.get("Note")
        if notice and not any(k in data for k in ("transcript", "quarterlyEarnings")):
            if "25 requests" in notice or "rate limit" in notice.lower() or "sparingly" in notice:
                raise QuotaReached(f"Alpha Vantage limit: {notice[:160]}")
            raise RuntimeError(f"Alpha Vantage: {notice[:200]}")
        return data

    def transcript(self, ticker: str, fiscal_year: int, fiscal_quarter: int) -> list[Turn] | None:
        """Alpha Vantage labels quarters by the company's FISCAL calendar (verified: AAPL 2024Q1 =
        "Apple Q1 Fiscal Year 2024"). Returns None when no transcript exists for that quarter."""
        data = self._get(
            {"function": "EARNINGS_CALL_TRANSCRIPT", "symbol": ticker, "quarter": f"{fiscal_year}Q{fiscal_quarter}"}
        )
        turns = data.get("transcript") or []
        out = [
            Turn(
                str(t.get("speaker") or "").strip(),
                str(t.get("title") or "").strip(),
                str(t.get("content") or "").strip(),
            )
            for t in turns
            if (t.get("content") or "").strip()
        ]
        return out or None

    def earnings_events(self, ticker: str) -> list[EarningsEvent]:
        data = self._get({"function": "EARNINGS", "symbol": ticker})
        out = []
        for q in data.get("quarterlyEarnings", []):
            try:
                out.append(
                    EarningsEvent(
                        period_end=date.fromisoformat(q["fiscalDateEnding"]),
                        report_date=date.fromisoformat(q["reportedDate"]),
                        report_time=q.get("reportTime") or None,
                        eps_reported=_num(q.get("reportedEPS")),
                        eps_estimated=_num(q.get("estimatedEPS")),
                    )
                )
            except (KeyError, ValueError):
                continue
        return out
