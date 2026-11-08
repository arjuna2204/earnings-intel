"""Regression eval on real AI outputs for 3 companies (Apple, Microsoft, JPMorgan).

Each fixture holds what the AI actually returned plus the exact source text. Re-running today's
verification code must reproduce what was stored, and the share of AI items that pass the checks
must stay high — so a code change can't silently start accepting made-up quotes or dropping real ones.
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any

import pytest

from ei.filings.brief import verify_claims
from ei.filings.mdna import verify_mdna
from ei.filings.release import verify_release

FIX = Path(__file__).parent / "fixtures" / "eval"
FILES = sorted(FIX.glob("*.json.gz")) if FIX.exists() else []


def load(p: Path) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(gzip.decompress(p.read_bytes()))
    return data


@pytest.mark.skipif(not FILES, reason="eval fixtures not downloaded yet")
@pytest.mark.parametrize("path", FILES, ids=[p.name.split(".")[0] for p in FILES])
def test_verification_reproduces_stored_results(path: Path) -> None:
    d = load(path)
    for r in d["releases"]:
        kept, _ = verify_release(r["raw"], r["paragraphs"])
        assert [f["kind"] for f in kept["figures"]] == [f["kind"] for f in r["kept"]["figures"]], (
            d["ticker"],
            r["period"],
        )
        assert [round(f["value"], 6) for f in kept["figures"]] == [round(f["value"], 6) for f in r["kept"]["figures"]]
    for m in d["mdna"]:
        kept, _ = verify_mdna(m["raw"], m["paragraphs"])
        assert len(kept["drivers"]) == len(m["kept"]["drivers"]), (d["ticker"], m["period"])
    for b in d["briefs"]:
        kept, _ = verify_claims(b["raw"], b["facts"])
        assert [c["text"] for c in kept] == [c["text"] for c in b["claims"]], (d["ticker"], b["period_b"])


@pytest.mark.skipif(not FILES, reason="eval fixtures not downloaded yet")
def test_pass_rates_stay_high() -> None:
    """Across all companies: most AI-returned quotes and numbers should verify against the source."""
    tot = {"release": [0, 0], "mdna": [0, 0], "brief": [0, 0]}
    for p in FILES:
        d = load(p)
        for r in d["releases"]:
            kept, _ = verify_release(r["raw"], r["paragraphs"])
            tot["release"][0] += len(kept["figures"]) + len(kept["adjustments"])
            tot["release"][1] += len(r["raw"].get("figures", [])) + len(r["raw"].get("adjustments", []))
        for m in d["mdna"]:
            kept, _ = verify_mdna(m["raw"], m["paragraphs"])
            tot["mdna"][0] += sum(len(kept[k]) for k in ("drivers", "capital", "outlook"))
            tot["mdna"][1] += sum(len(m["raw"].get(k, [])) for k in ("drivers", "capital", "outlook"))
        for b in d["briefs"]:
            kept, _ = verify_claims(b["raw"], b["facts"])
            tot["brief"][0] += len(kept)
            tot["brief"][1] += len(b["raw"].get("claims", []))
    rates = {k: (v[0] / v[1] if v[1] else 1.0) for k, v in tot.items()}
    print("pass rates:", rates)
    assert rates["release"] >= 0.75 and rates["mdna"] >= 0.80 and rates["brief"] >= 0.85, rates


def test_fabricated_quote_is_rejected() -> None:
    """A made-up quote and an altered number must never pass, whatever the fixtures contain."""
    paras = ["Revenue was $92.3 billion and increased 19% (up 17% in constant currency)."]
    raw = {
        "reports_non_gaap": False,
        "non_gaap_definition": None,
        "figures": [
            {
                "kind": "revenue",
                "label": "Revenue",
                "current": 93.2,
                "prior": None,
                "unit": "USD",
                "scale": "billions",
                "basis": "quarter",
                "quote": paras[0],
                "para": 0,
            },
            {
                "kind": "other",
                "label": "x",
                "current": 5.0,
                "prior": None,
                "unit": "percent",
                "scale": "units",
                "basis": "quarter",
                "quote": "Cloud grew 5% this quarter",
                "para": 0,
            },
        ],
        "adjustments": [],
    }
    kept, dropped = verify_release(raw, paras)
    assert kept["figures"] == [] and len(dropped) == 2
