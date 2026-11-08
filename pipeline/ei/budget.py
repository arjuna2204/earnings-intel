"""AI budget guard: estimate every Claude call's cost and refuse it if it would break the monthly cap.

Prices live in pricing.json. Until `verified` is true there, EVERY AI call is refused, so an
unconfirmed price table can never let spending slip past the cap.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any

PRICING_PATH = Path(__file__).with_name("pricing.json")
MILLION = Decimal(1_000_000)


class BudgetExceeded(RuntimeError):
    """Raised when a call would push month-to-date spend over the cap."""


class PricingUnverified(RuntimeError):
    """Raised when pricing.json hasn't been checked against Anthropic's published prices."""


@dataclass(frozen=True)
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_write_tokens: int = 0
    cache_read_tokens: int = 0
    cache_ttl_1h: bool = False


def load_pricing(path: Path = PRICING_PATH) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(path.read_text())
    return data


def _rates(model: str, usage: Usage, pricing: dict[str, Any]) -> dict[str, Any]:
    m = pricing["models"][model]
    if "standard" not in m:  # simple flat table (used in tests)
        return dict(m)
    threshold = m.get("long_prompt_threshold")
    prompt = usage.input_tokens + usage.cache_read_tokens + usage.cache_write_tokens
    if threshold and prompt > threshold and "long" in m:
        return dict(m["long"])
    return dict(m["standard"])


def cost_usd(model: str, usage: Usage, *, batch: bool = False, pricing: dict[str, Any] | None = None) -> Decimal:
    pr = pricing or load_pricing()
    p = _rates(model, usage, pr)
    write_rate = p.get("cache_write_1h", p["cache_write_5m"]) if usage.cache_ttl_1h else p["cache_write_5m"]
    c = (
        Decimal(usage.input_tokens) * Decimal(str(p["input"]))
        + Decimal(usage.output_tokens) * Decimal(str(p["output"]))
        + Decimal(usage.cache_write_tokens) * Decimal(str(write_rate))
        + Decimal(usage.cache_read_tokens) * Decimal(str(p["cache_read"]))
    ) / MILLION
    if batch:
        c *= Decimal(str(pr["batch_multiplier"]))
    return c.quantize(Decimal("0.000001"))


@dataclass(frozen=True)
class BudgetState:
    spent_usd: Decimal
    cap_usd: Decimal
    warn_at_usd: Decimal

    @property
    def remaining(self) -> Decimal:
        return max(self.cap_usd - self.spent_usd, Decimal(0))

    @property
    def warning(self) -> bool:
        return self.spent_usd >= self.warn_at_usd


def check_call(
    state: BudgetState, model: str, est: Usage, *, batch: bool = False, pricing: dict[str, Any] | None = None
) -> Decimal:
    """Return the estimated cost if allowed; raise if it would exceed the cap or pricing is unverified."""
    pr = pricing or load_pricing()
    if not pr.get("verified"):
        raise PricingUnverified("AI pricing table has not been verified yet; refusing AI calls.")
    est_cost = cost_usd(model, est, batch=batch, pricing=pr)
    if state.spent_usd + est_cost > state.cap_usd:
        raise BudgetExceeded(
            f"Monthly AI budget reached — cached results still available "
            f"(spent ${state.spent_usd:.2f} of ${state.cap_usd:.2f}; this call ≈ ${est_cost:.4f})."
        )
    return est_cost


def estimate_tokens(text: str) -> int:
    """Conservative token estimate (~3.5 chars/token) used before a call; real usage is logged after."""
    return max(1, int(len(text) / 3.5) + 1)
