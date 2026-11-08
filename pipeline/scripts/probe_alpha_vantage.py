"""One-off probe: how does Alpha Vantage label transcript quarters, and what does EARNINGS return?

Saves a trimmed, non-sensitive summary to ops/av-probe.json (no full transcript text).
Uses 2 of the 25 free daily requests.
"""

from __future__ import annotations

import json
import os
import time
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
    est = get({"function": "EARNINGS_ESTIMATES", "symbol": "AAPL"})
    rows = est.get("estimates") or []
    out["estimates_keys"] = sorted(est.keys())
    out["estimates_notice"] = est.get("Information") or est.get("Note")
    out["estimates_count"] = len(rows)
    out["estimates_sample"] = rows[:8]
    Path("ops").mkdir(exist_ok=True)
    Path("ops/av-probe.json").write_text(json.dumps(out, indent=2, default=str) + "\n")
    print(json.dumps(out, indent=2, default=str)[:3000])


if __name__ == "__main__":
    main()
