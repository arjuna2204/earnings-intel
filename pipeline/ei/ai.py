"""Claude API wrapper: budget guard BEFORE every call, spend ledger AFTER every call.

Models: Haiku 5.5 for extraction/classification, Sonnet 5.5 only for final brief writing.
Structured output is enforced with a JSON schema and then validated with Pydantic by the caller.

Batch mode (EI_AI_BATCH=1, set by the daily auto-research run): each call goes through the Message
Batches API at half price. Nothing waits on the nightly run, so a few minutes' delay is fine. If a
batch hasn't finished within EI_AI_BATCH_WAIT_S seconds it is cancelled and the call is made the
normal way (full price), so a slow batch can never stall a company. Visitor-started runs stay normal.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any, Literal

from ei.budget import BudgetState, Usage, check_call, cost_usd, estimate_tokens
from ei.db import Db

HAIKU = "claude-haiku-5-5"
SONNET = "claude-sonnet-5-5"
log = logging.getLogger(__name__)
BATCH_ENV = "EI_AI_BATCH"
BATCH_WAIT_ENV = "EI_AI_BATCH_WAIT_S"
BATCH_WAIT_DEFAULT_S = 600
PROMPTS = Path(__file__).resolve().parents[2] / "prompts"
_THINKING_OFF: dict[str, str] = {SONNET: "between_tools"}


def load_prompt(name: str) -> str:
    return (PROMPTS / name).read_text()


def budget_state(db: Db) -> BudgetState:
    spent = Decimal(str(db.rpc("ai_spend_month_to_date", {}) or 0))
    rows = db.select("app_settings", {"key": "eq.ai_budget", "select": "value"})
    cfg = rows[0]["value"] if rows else {"monthly_cap_usd": 10, "warn_at_usd": 8}
    return BudgetState(spent, Decimal(str(cfg["monthly_cap_usd"])), Decimal(str(cfg["warn_at_usd"])))


_batch_off = False  # set after a batch runs too long; this process then makes normal calls


def batch_enabled() -> bool:
    return os.environ.get(BATCH_ENV) == "1" and not _batch_off


def batch_wait_s() -> float:
    try:
        return float(os.environ.get(BATCH_WAIT_ENV, BATCH_WAIT_DEFAULT_S))
    except ValueError:
        return BATCH_WAIT_DEFAULT_S


class BatchRequestError(RuntimeError):
    """The API rejected a batched request (the batch equivalent of a 400 error)."""


@dataclass
class AiResult:
    data: dict[str, Any]
    cost: Decimal
    usage: Usage


class AiClient:
    def __init__(self, api_key: str, db: Db, *, batch: bool | None = None) -> None:
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        import anthropic  # imported lazily so code paths without AI don't need the package

        self._client = anthropic.Anthropic(api_key=api_key, max_retries=3, timeout=300)
        self._db = db
        self._batch = batch_enabled() if batch is None else batch
        self._sleep = time.sleep  # replaced in tests

    def _create(self, kwargs: dict[str, Any], thinking_mode: str) -> Any:
        return self._client.messages.create(**kwargs, thinking={"type": thinking_mode})  # type: ignore[call-overload]

    def _create_batched(self, kwargs: dict[str, Any], thinking_mode: str, purpose: str) -> Any | None:
        """One request through the Batches API. Returns the message, or None if it didn't finish in
        time (the batch is cancelled). An error result raises BatchRequestError."""
        params = {**kwargs, "thinking": {"type": thinking_mode}}
        batch = self._client.messages.batches.create(
            requests=[{"custom_id": uuid.uuid4().hex, "params": params}]  # type: ignore[typeddict-item]
        )
        start, delay = time.monotonic(), 5.0
        while True:
            b = self._client.messages.batches.retrieve(batch.id)
            if b.processing_status == "ended":
                break
            if time.monotonic() - start >= batch_wait_s():
                # Cancel, then read whatever it ended with: a request that finished at the last moment
                # is used (and paid for) rather than paid for twice.
                try:
                    self._client.messages.batches.cancel(batch.id)
                    for _ in range(12):
                        if self._client.messages.batches.retrieve(batch.id).processing_status == "ended":
                            break
                        self._sleep(5)
                    else:
                        log.warning("%s: batch %s still cancelling; making a normal call", purpose, batch.id)
                        return None
                except Exception as e:
                    log.warning("cancel batch %s: %s", batch.id, e)
                    return None
                log.warning("%s: batch not done after %.0fs", purpose, time.monotonic() - start)
                break
            self._sleep(delay)
            delay = min(delay * 1.5, 30.0)
        for entry in self._client.messages.batches.results(batch.id):
            r = entry.result
            if r.type == "succeeded":
                log.info("%s: batch done in %.0fs", purpose, time.monotonic() - start)
                return r.message
            if r.type == "errored":
                err = getattr(getattr(r.error, "error", None), "message", None) or str(r.error)
                raise BatchRequestError(err)
        return None  # canceled or expired

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
        effort: Literal["low", "medium", "high"] = "low",
    ) -> AiResult:
        # 1) Estimate the worst case (full max_tokens of output) and refuse if it would break the cap.
        #    Priced at the normal rate even in batch mode, since a slow batch falls back to a normal call.
        est = Usage(input_tokens=estimate_tokens(system) + estimate_tokens(user) + 200, output_tokens=max_tokens)
        check_call(budget_state(self._db), model, est)

        # 2) Call with enforced JSON schema; long fixed instructions are marked for prompt caching.
        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            "messages": [{"role": "user", "content": user}],
            "output_config": {"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        }
        # Thinking off. Some models express "off" as {"type": "between_tools"}; switch if the API says so.
        thinking_mode = _THINKING_OFF.get(model, "disabled")
        import anthropic

        def send(mode: str) -> tuple[Any, bool]:
            global _batch_off
            if self._batch and not _batch_off:
                msg = self._create_batched(kwargs, mode, purpose)
                if msg is not None:
                    return msg, True
                # Batches are slow right now: finish this company with normal calls rather than
                # waiting again on every call.
                _batch_off = True
            return self._create(kwargs, mode), False

        try:
            resp, batched = send(thinking_mode)
        except (anthropic.BadRequestError, BatchRequestError) as e:
            if "between_tools" not in str(e) or thinking_mode == "between_tools":
                raise
            _THINKING_OFF[model] = "between_tools"
            resp, batched = send("between_tools")

        # 3) Log actual usage and cost, whatever happens next.
        u = resp.usage
        usage = Usage(
            input_tokens=u.input_tokens or 0,
            output_tokens=u.output_tokens or 0,
            cache_write_tokens=getattr(u, "cache_creation_input_tokens", 0) or 0,
            cache_read_tokens=getattr(u, "cache_read_input_tokens", 0) or 0,
        )
        cost = cost_usd(model, usage, batch=batched)
        self._db.insert(
            "ai_spend",
            {
                "model": model,
                "purpose": purpose,
                "batch": batched,
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
