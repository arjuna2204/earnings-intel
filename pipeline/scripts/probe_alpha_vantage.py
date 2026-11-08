"""One-off probe: how does Alpha Vantage label transcript quarters, and what does EARNINGS return?

Saves a trimmed, non-sensitive summary to ops/av-probe.json (no full transcript text).
Uses 2 of the 25 free daily requests.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from pathlib import Path


def get(params: dict[str, str]) -> dict:
    params = {**params, "apikey": os.environ["ALPHA_VANTAGE_API_KEY"]}
    url = "https://www.alphavantage.co/query?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.loads(r.read().decode())


def main() -> None:
    out: dict = {}
    earn = get({"function": "EARNINGS", "symbol": "AAPL"})
    q = earn.get("quarterlyEarnings", [])
    out["earnings_keys"] = sorted(earn.keys())
    out["earnings_quarterly_sample"] = q[:6]
    out["earnings_quarterly_count"] = len(q)
    out["earnings_notice"] = earn.get("Information") or earn.get("Note")

    tr = get({"function": "EARNINGS_CALL_TRANSCRIPT", "symbol": "AAPL", "quarter": "2024Q1"})
    turns = tr.get("transcript") or []
    out["transcript_top_keys"] = sorted(tr.keys())
    out["transcript_meta"] = {k: v for k, v in tr.items() if k != "transcript"}
    out["transcript_turns"] = len(turns)
    out["transcript_first_turns"] = [
        {**{k: v for k, v in t.items() if k != "content"}, "content_start": (t.get("content") or "")[:220]}
        for t in turns[:6]
    ]
    out["speakers"] = sorted({(t.get("speaker"), t.get("title")) for t in turns}, key=str)
    out["total_chars"] = sum(len(t.get("content") or "") for t in turns)
    Path("ops").mkdir(exist_ok=True)
    Path("ops/av-probe.json").write_text(json.dumps(out, indent=2, default=str) + "\n")
    print(json.dumps(out, indent=2, default=str)[:3000])


if __name__ == "__main__":
    main()
