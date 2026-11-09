from datetime import date

from ei.options import max_pain, parse_symbol, summarize


def _o(sym, bid, ask, iv, delta, oi, vol):
    return {"option": sym, "bid": bid, "ask": ask, "iv": iv, "delta": delta, "open_interest": oi, "volume": vol}


RAW = {
    "timestamp": "2026-11-09 15:00:00",
    "data": {
        "current_price": 100.0,
        "options": [
            # expiry 2026-11-20 (11 days)
            _o("XYZ261120C00100000", 2.0, 2.2, 0.30, 0.5, 100, 50),
            _o("XYZ261120P00100000", 1.9, 2.1, 0.32, -0.5, 80, 40),
            # expiry 2026-12-18 (39 days): ATM + 25-delta wings
            _o("XYZ261218C00100000", 4.0, 4.4, 0.35, 0.52, 500, 300),
            _o("XYZ261218P00100000", 3.8, 4.2, 0.36, -0.48, 400, 200),
            _o("XYZ261218C00110000", 1.0, 1.2, 0.33, 0.25, 900, 100),
            _o("XYZ261218P00090000", 1.1, 1.3, 0.41, -0.26, 1200, 150),
        ],
    },
}


def test_parse_symbol():
    assert parse_symbol("AAPL261218C00150000") == (date(2026, 12, 18), "C", 150.0)
    assert parse_symbol("BRK.B261218P00500500") == (date(2026, 12, 18), "P", 500.5)
    assert parse_symbol("garbage") is None


def test_summarize_expected_move_earnings_and_skew():
    s = summarize(RAW, date(2026, 11, 9), next_earnings=date(2026, 12, 15), realized30=0.25, iv_hist=[])
    assert [t["dte"] for t in s["term"]] == [11, 39]
    assert abs(s["term"][0]["move"] - 0.041) < 1e-9  # (2.1 + 2.0) / 100
    assert s["earnings"]["exp"] == "2026-12-18" and abs(s["earnings"]["move"] - 0.082) < 1e-9
    assert abs(s["skew"]["skew"] - (0.41 - 0.33)) < 1e-9  # 25-delta put IV minus call IV
    assert s["month_exp"] == "2026-12-18"
    assert abs(s["put_call_volume"] - 390 / 450) < 1e-9
    assert s["iv_rank"] is None  # needs 60+ days of history


def test_max_pain():
    chain = [
        {"strike": 90.0, "cp": "C", "oi": 1000},
        {"strike": 100.0, "cp": "P", "oi": 10},
        {"strike": 110.0, "cp": "P", "oi": 1000},
    ]
    # settle 90: puts pay 10*10 + 20*1000; 100: calls 10*1000 + puts 10*1000; 110: calls 20*1000
    # → payouts 20100, 20000, 20000; the first strike with the smallest payout wins
    assert max_pain(chain) == 100.0


def test_no_earnings_move_when_expiry_far_after_report():
    s = summarize(RAW, date(2026, 11, 9), next_earnings=date(2026, 11, 25), realized30=None, iv_hist=[])
    assert s["earnings"] is None  # next expiry (Dec 18) is 23 days after the report
