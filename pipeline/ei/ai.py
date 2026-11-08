"""Claude API wrapper: budget guard BEFORE every call, spend ledger AFTER every call.

Models: Haiku 5.5 for extraction/classification, Sonnet 5.5 only for final brief writing.
Structured output is enforced with a JSON schema and then validated with Pydantic by the caller.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any

from ei.budget import BudgetState, Usage, check_call, cost_usd, estimate_tokens
from ei.db import Db

HAIKU = "claude-haiku-5-5"
SONNET = "claude-sonnet-5-5"
PROMPTS = Path(__file__).resolve().parents[2] / "prompts"


def load_prompt(name: str) -> str:
    return (PROMPTS / name).read_text()


def budget_state(db: Db) -> BudgetState:
    spent = Decimal(str(db.rpc("ai_spend_month_to_date", {}) or 0))
    rows = db.select("app_settings", {"key": "eq.ai_budget", "select": "value"})
    cfg = rows[0]["value"] if rows else {"monthly_cap_usd": 10, "warn_at_usd": 8}
    return BudgetState(spent, Decimal(str(cfg["monthly_cap_usd"])), Decimal(str(cfg["warn_at_usd"])))


@dataclass
class AiResult:
    data: dict[str, Any]
    cost: Decimal
    usage: Usage


class AiClient:
    def __init__(self, api_key: str, db: Db) -> None:
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        import anthropic  # imported lazily so code paths without AI don't need the package

        self._client = anthropic.Anthropic(api_key=api_key, max_retries=3, timeout=300)
        self._db = db

    def json_call(
        self,
        *,
        model: str,
        purpose: str,
        system: str,
        user: str,
        schema: dict[str, Any],
        max_tokens: int,
        cik: int | None = None,
    ) -> AiResult:
        # 1) Estimate the worst case (full max_tokens of output) and refuse if it would break the cap.
        est = Usage(input_tokens=estimate_tokens(system) + estimate_tokens(user) + 200, output_tokens=max_tokens)
        check_call(budget_state(self._db), model, est)

        # 2) Call with enforced JSON schema; long fixed instructions are marked for prompt caching.
        resp = self._client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
            thinking={"type": "disabled"},
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
        )

        # 3) Log actual usage and cost, whatever happens next.
        u = resp.usage
        usage = Usage(
            input_tokens=u.input_tokens or 0,
            output_tokens=u.output_tokens or 0,
            cache_write_tokens=getattr(u, "cache_creation_input_tokens", 0) or 0,
            cache_read_tokens=getattr(u, "cache_read_input_tokens", 0) or 0,
        )
        cost = cost_usd(model, usage)
        self._db.insert(
            "ai_spend",
            {
                "model": model,
                "purpose": purpose,
                "cik": cik,
                "input_tokens": usage.input_tokens,
                "output_tokens": usage.output_tokens,
                "cache_write_tokens": usage.cache_write_tokens,
                "cache_read_tokens": usage.cache_read_tokens,
                "cost_usd": str(cost),
            },
            returning=False,
        )
        if resp.stop_reason == "max_tokens":
            raise RuntimeError(f"{purpose}: response hit max_tokens ({max_tokens}); output incomplete")
        text = "".join(getattr(b, "text", "") for b in resp.content if getattr(b, "type", "") == "text")
        return AiResult(json.loads(text), cost, usage)
