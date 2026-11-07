"""Phase 0 key check.

Verifies each data/AI credential works and records ONLY pass/fail plus non-sensitive
facts (row counts, field names) to ops/key-check.json. Never prints or writes a key.
Uses only the standard library so it runs without installing anything.
Cost: $0 (the Anthropic check lists models; it does not generate text).
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

TIMEOUT = 30


def _get(url: str, headers: dict[str, str] | None = None) -> tuple[int, Any]:
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            status = resp.status
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        status = e.code
    try:
        return status, json.loads(body)
    except json.JSONDecodeError:
        return status, body[:300]


def _scrub(text: str, secrets: list[str]) -> str:
    for s in secrets:
        if s:
            text = text.replace(s, "***")
    return text


def check_anthropic(key: str) -> dict[str, Any]:
    status, data = _get(
        "https://api.anthropic.com/v1/models?limit=100",
        {"x-api-key": key, "anthropic-version": "2023-06-01"},
    )
    if status != 200:
        msg = data.get("error", {}).get("message") if isinstance(data, dict) else str(data)
        return {"ok": False, "http_status": status, "error": msg}
    ids = [m.get("id") for m in data.get("data", [])]
    wanted = ["claude-haiku-5-5", "claude-sonnet-5-5"]
    return {"ok": True, "required_models_available": {w: w in ids for w in wanted}}


def check_alpha_vantage(key: str) -> dict[str, Any]:
    params = urllib.parse.urlencode(
        {"function": "EARNINGS_CALL_TRANSCRIPT", "symbol": "IBM", "quarter": "2024Q1", "apikey": key}
    )
    status, data = _get(f"https://www.alphavantage.co/query?{params}")
    if not isinstance(data, dict):
        return {"ok": False, "http_status": status, "error": "non-JSON response"}
    transcript = data.get("transcript")
    if isinstance(transcript, list) and transcript:
        first = transcript[0] if isinstance(transcript[0], dict) else {}
        return {
            "ok": True,
            "transcript_turns": len(transcript),
            "turn_fields": sorted(first.keys()),
            "has_speaker_titles": any(isinstance(t, dict) and t.get("title") for t in transcript),
        }
    # Free-tier limits / premium notices come back as "Information" or "Note".
    notice = data.get("Information") or data.get("Note") or data.get("Error Message")
    return {"ok": False, "http_status": status, "notice": notice, "top_level_keys": sorted(data.keys())}


def check_tiingo(key: str) -> dict[str, Any]:
    status, data = _get(
        "https://api.tiingo.com/tiingo/daily/AAPL/prices?startDate=2010-01-01&resampleFreq=daily",
        {"Authorization": f"Token {key}", "Content-Type": "application/json"},
    )
    if status != 200 or not isinstance(data, list):
        detail = data.get("detail") if isinstance(data, dict) else str(data)[:200]
        return {"ok": False, "http_status": status, "error": detail}
    return {
        "ok": True,
        "rows": len(data),
        "first_date": data[0].get("date") if data else None,
        "last_date": data[-1].get("date") if data else None,
        "has_adjusted_close": bool(data) and "adjClose" in data[0],
    }


def check_sec(user_agent: str) -> dict[str, Any]:
    looks_valid = "@" in user_agent and " " in user_agent.strip()
    status, data = _get(
        "https://data.sec.gov/submissions/CIK0000320193.json",
        {"User-Agent": user_agent, "Accept-Encoding": "identity"},
    )
    if status != 200 or not isinstance(data, dict):
        return {"ok": False, "http_status": status, "format_looks_valid": looks_valid}
    return {"ok": True, "format_looks_valid": looks_valid, "sample_company": data.get("name")}


def main() -> int:
    env = {
        k: os.environ.get(k, "")
        for k in ["ANTHROPIC_API_KEY", "ALPHA_VANTAGE_API_KEY", "TIINGO_API_KEY", "SEC_USER_AGENT"]
    }
    secrets = list(env.values())
    checks = {
        "anthropic": (env["ANTHROPIC_API_KEY"], check_anthropic),
        "alpha_vantage": (env["ALPHA_VANTAGE_API_KEY"], check_alpha_vantage),
        "tiingo": (env["TIINGO_API_KEY"], check_tiingo),
        "sec": (env["SEC_USER_AGENT"], check_sec),
    }
    results: dict[str, Any] = {}
    for name, (value, fn) in checks.items():
        if not value:
            results[name] = {"ok": False, "error": "secret is missing or empty"}
            continue
        try:
            results[name] = fn(value)
        except Exception as e:  # noqa: BLE001 - report any failure without crashing other checks
            results[name] = {"ok": False, "error": f"{type(e).__name__}: {e}"}

    out = {"checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "results": results}
    text = _scrub(json.dumps(out, indent=2), secrets)
    os.makedirs("ops", exist_ok=True)
    with open("ops/key-check.json", "w") as f:
        f.write(text + "\n")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
