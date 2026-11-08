"""Peer selection and ranking (pure code, no network)."""

from __future__ import annotations

from ei.peers import GENERAL_COLS, choose_peers, compare, fmt, ordinal, verify_competitors

LISTED = {
    1: ("AAA", "Target Co"),
    2: ("BBB", "Big Rival"),
    3: ("CCC", "Close Peer"),
    4: ("DDD", "Tiny Co"),
    5: ("EEE", "Mid Peer"),
    6: ("FFF", "Huge Co"),
}
REV = {1: 100e9, 2: 150e9, 3: 90e9, 4: 0.5e9, 5: 60e9, 6: 5000e9}


def test_competitors_first_then_closest_revenue() -> None:
    comps = [{"cik": 6, "name": "Huge"}, {"cik": 2, "name": "Big Rival", "quote": "We compete with Big Rival"}]
    peers, rest = choose_peers(1, REV[1], [1, 3, 4, 5, 7], LISTED, REV, comps, n=3)
    assert [p["ticker"] for p in peers] == ["BBB", "CCC", "EEE"]  # FFF too large (>20x), skipped
    assert peers[0]["source"] == "10-K competitor"
    assert "DDD" not in [r["ticker"] for r in rest]  # 200x smaller: out of range


def test_named_competitors_leave_room_for_industry_peers() -> None:
    comps = [{"cik": c, "name": LISTED[c][1], "quote": "q"} for c in (2, 3, 5)]
    peers, _ = choose_peers(1, REV[1], [4], LISTED, REV | {4: 80e9}, comps, n=3)
    assert [p["ticker"] for p in peers] == ["BBB", "DDD", "CCC"]


def test_verify_competitors_requires_quote_and_listed_ticker() -> None:
    paras = ["We compete with Big Rival and Phantom Corp in cloud services."]
    raw = {
        "competitors": [
            {"name": "Big Rival", "ticker_guess": "bbb", "quote": "We compete with Big Rival", "para": 0},
            {"name": "Phantom Corp", "ticker_guess": "ZZZZ", "quote": "Phantom Corp in cloud services", "para": 0},
            {"name": "Made Up", "ticker_guess": "CCC", "quote": "not in text", "para": 0},
        ]
    }
    out = verify_competitors(raw, paras, {"BBB": (2, "Big Rival"), "CCC": (3, "Close Peer")})
    assert [c["ticker"] for c in out] == ["BBB"]


def test_compare_ranks_medians_and_facts() -> None:
    t = {"ticker": "AAA", "m": {"pe_fwd_ntm": 25.0, "op_margin": 0.45, "market_cap": 1e12}}
    ps = [
        {"ticker": "BBB", "m": {"pe_fwd_ntm": 30.0, "op_margin": 0.30}},
        {"ticker": "CCC", "m": {"pe_fwd_ntm": 20.0, "op_margin": 0.20}},
        {"ticker": "EEE", "m": {"pe_fwd_ntm": 40.0, "op_margin": None}},
    ]
    r = compare(t, ps, GENERAL_COLS)
    assert r["ranks"]["pe_fwd_ntm"] == {"EEE": 1, "BBB": 2, "AAA": 3, "CCC": 4}
    assert r["medians"]["pe_fwd_ntm"] == 30.0
    texts = {f["metric"]: f["text"] for f in r["facts"].values()}
    assert texts["op_margin"].startswith("Operating margin: AAA 45.0% — highest of 3; peer median 25.0%")
    assert "3rd highest of 4" in texts["pe_fwd_ntm"]
    assert "market_cap" not in texts


def test_formatting() -> None:
    assert fmt(3.94e12, "money") == "$3.94T" and fmt(0.1234, "pct") == "12.3%" and fmt(25.21, "x") == "25.2x"
    assert [ordinal(i) for i in (1, 2, 3, 4, 11, 12, 13, 22)] == [
        "1st",
        "2nd",
        "3rd",
        "4th",
        "11th",
        "12th",
        "13th",
        "22nd",
    ]


def test_assets_cross_check_rejects_bad_revenue_value() -> None:
    # "TINY" reports a bogus revenue close to the target's, but its assets are 1/1000th: excluded.
    listed = LISTED | {9: ("TINY", "Tiny Mislabelled")}
    rev = REV | {9: 101e9}
    assets = {1: 300e9, 3: 250e9, 5: 200e9, 9: 0.3e9}
    peers, _ = choose_peers(1, REV[1], [3, 5, 9], listed, rev, [], n=3, assets=assets)
    assert "TINY" not in [p["ticker"] for p in peers]


def test_related_industry_ranks_after_exact_match() -> None:
    tiers = {3: 1, 5: 0}  # CCC closer in size but only a related industry
    peers, _ = choose_peers(1, REV[1], tiers, LISTED, REV, [], n=2)
    assert [p["ticker"] for p in peers] == ["EEE", "CCC"]
    assert peers[1]["reason"].startswith("Closely related")
