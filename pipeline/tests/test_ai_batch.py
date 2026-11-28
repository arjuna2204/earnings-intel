"""Batch mode in the Claude API wrapper: half-price calls, with a normal call when a batch is slow."""

from __future__ import annotations

import json
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest

from ei import ai


class FakeDb:
    def __init__(self) -> None:
        self.spend: list[dict[str, Any]] = []

    def rpc(self, name: str, args: dict[str, Any]) -> Any:
        return 0

    def select(self, table: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        return []

    def insert(self, table: str, row: dict[str, Any], returning: bool = True) -> None:
        self.spend.append(row)


def message(data: dict[str, Any]) -> Any:
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=json.dumps(data))],
        stop_reason="end_turn",
        usage=SimpleNamespace(
            input_tokens=50_000, output_tokens=0, cache_creation_input_tokens=0, cache_read_input_tokens=0
        ),
    )


class FakeBatches:
    def __init__(self, polls_until_done: int, result: str = "succeeded") -> None:
        self.polls_until_done = polls_until_done
        self.result = result
        self.created: list[Any] = []
        self.cancelled = False
        self.polls = 0

    def create(self, requests: list[dict[str, Any]]) -> Any:
        self.created.append(requests)
        return SimpleNamespace(id="b1")

    def retrieve(self, batch_id: str) -> Any:
        self.polls += 1
        done = self.cancelled or self.polls >= self.polls_until_done
        return SimpleNamespace(processing_status="ended" if done else "in_progress")

    def cancel(self, batch_id: str) -> None:
        self.cancelled = True

    def results(self, batch_id: str) -> list[Any]:
        if self.cancelled:
            return [SimpleNamespace(custom_id="x", result=SimpleNamespace(type="canceled"))]
        if self.result == "errored":
            err = SimpleNamespace(error=SimpleNamespace(message="bad schema"))
            return [SimpleNamespace(custom_id="x", result=SimpleNamespace(type="errored", error=err))]
        return [
            SimpleNamespace(custom_id="x", result=SimpleNamespace(type="succeeded", message=message({"via": "batch"})))
        ]


def client(batches: FakeBatches, batch: bool = True) -> tuple[ai.AiClient, FakeDb, list[Any]]:
    db = FakeDb()
    c = ai.AiClient.__new__(ai.AiClient)
    normal: list[Any] = []

    def create(**kw: Any) -> Any:
        normal.append(kw)
        return message({"via": "normal"})

    c._client = SimpleNamespace(messages=SimpleNamespace(batches=batches, create=create))
    c._db = db  # type: ignore[assignment]
    c._batch = batch
    c._sleep = lambda s: None
    return c, db, normal


def call(c: ai.AiClient) -> ai.AiResult:
    return c.json_call(
        model=ai.HAIKU, purpose="test", system="sys", user="hi", schema={"type": "object"}, max_tokens=10
    )


@pytest.fixture(autouse=True)
def reset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ai, "_batch_off", False)


def test_batched_call_is_half_price_and_logged() -> None:
    b = FakeBatches(polls_until_done=3)
    c, db, normal = client(b)
    res = call(c)
    assert res.data == {"via": "batch"} and not normal
    assert b.created[0][0]["params"]["thinking"] == {"type": "disabled"}
    assert db.spend[0]["batch"] is True
    # 50k Haiku input tokens: $0.005 normally, half in a batch
    assert res.cost == Decimal("0.002500")


def test_slow_batch_is_cancelled_and_made_normally(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(ai.BATCH_WAIT_ENV, "0")
    b = FakeBatches(polls_until_done=10**6)
    c, db, normal = client(b)
    res = call(c)
    assert b.cancelled and res.data == {"via": "normal"} and len(normal) == 1
    assert db.spend[0]["batch"] is False and res.cost == Decimal("0.005000")
    # later calls in this process skip batches instead of waiting again
    call(c)
    assert len(b.created) == 1 and len(normal) == 2


def test_batch_error_is_raised() -> None:
    c, _, _ = client(FakeBatches(polls_until_done=1, result="errored"))
    with pytest.raises(ai.BatchRequestError, match="bad schema"):
        call(c)


def test_normal_mode_never_batches() -> None:
    b = FakeBatches(polls_until_done=1)
    c, db, _ = client(b, batch=False)
    assert call(c).data == {"via": "normal"} and not b.created and db.spend[0]["batch"] is False


def test_rate_limiters_share_the_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    from ei.http import RATE_SHARE_ENV, RateLimiter

    monkeypatch.setenv(RATE_SHARE_ENV, "4")
    lim = RateLimiter(rate=8)
    lim.wait()
    import time

    gap = lim._next - time.monotonic()
    assert 0.4 < gap <= 0.5  # 8/s shared by 4 processes = one request every 0.5 s
