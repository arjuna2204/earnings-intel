"""Compare two calls in code (no AI): guidance changes, topic shifts, tone deltas, price reaction."""

from __future__ import annotations

import re
from datetime import date
from typing import Any

from ei.embed import Embedder, OverlapEmbedder, greedy_match

MAINTAINED_TOLERANCE = 0.005  # +/-0.5% of the earlier midpoint counts as "maintained"


# ---------------------------------------------------------------- guidance


def _mid(g: dict[str, Any]) -> float | None:
    if g.get("point") is not None:
        return float(g["point"])
    lo, hi = g.get("low"), g.get("high")
    if lo is not None and hi is not None:
        return (float(lo) + float(hi)) / 2
    return float(lo) if lo is not None else (float(hi) if hi is not None else None)


def _norm(s: str | None) -> str:
    return re.sub(r"[^a-z0-9%]+", " ", (s or "").lower()).strip()


def _horizon(period: str) -> str:
    p = period.lower()
    if re.search(r"full[- ]?year|fiscal year|\bfy\b|annual|year", p) and not re.search(r"\bq[1-4]\b|quarter", p):
        return "year"
    if re.search(r"quarter|\bq[1-4]\b", p):
        return "quarter"
    return "other"


def compare_guidance(
    earlier: list[dict[str, Any]], later: list[dict[str, Any]], embedder: Embedder | None = None
) -> list[dict[str, Any]]:
    """Match guidance items by metric (+ horizon: quarter vs. year) and label the change numerically."""
    emb = embedder or OverlapEmbedder()
    sim = emb.similarity_matrix([_norm(g["metric"]) for g in earlier], [_norm(g["metric"]) for g in later])
    # Only pair items with the same horizon (next-quarter guide vs. next-quarter guide, etc.).
    for i, a in enumerate(earlier):
        for j, b in enumerate(later):
            if _horizon(a["period"]) != _horizon(b["period"]):
                sim[i][j] = 0.0
            elif _norm(a["metric"]) == _norm(b["metric"]):
                sim[i][j] = 1.0
    matches = greedy_match(sim, threshold=0.6 if emb.name != "word-overlap" else 0.5)
    rows: list[dict[str, Any]] = []
    matched_a = {i for i, _, _ in matches}
    matched_b = {j for _, j, _ in matches}
    for i, j, _ in matches:
        a, b = earlier[i], later[j]
        rows.append({"metric": b["metric"], "earlier": a, "later": b, **_label(a, b)})
    for j, b in enumerate(later):
        if j not in matched_b:
            rows.append(
                {
                    "metric": b["metric"],
                    "earlier": None,
                    "later": b,
                    "change": "withdrawn" if b.get("withdrawn") else "new",
                }
            )
    for i, a in enumerate(earlier):
        if i not in matched_a:
            rows.append({"metric": a["metric"], "earlier": a, "later": None, "change": "withdrawn"})
    order = {"raised": 0, "lowered": 1, "new": 2, "withdrawn": 3, "maintained": 4, "changed basis": 5, "qualitative": 6}
    return sorted(rows, key=lambda r: order.get(r["change"], 9))


def _label(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    if b.get("withdrawn"):
        return {"change": "withdrawn"}
    ma, mb = _mid(a), _mid(b)
    if ma is None or mb is None:
        return {"change": "qualitative"}
    if _norm(a.get("unit")) != _norm(b.get("unit")):
        return {"change": "changed basis", "note": f"units differ ({a.get('unit')} vs {b.get('unit')})"}
    delta = mb - ma
    rel = delta / abs(ma) if ma else None
    if abs(delta) <= MAINTAINED_TOLERANCE * max(abs(ma), 1e-9):
        change = "maintained"
    else:
        change = "raised" if delta > 0 else "lowered"
    same_target = _norm(a["period"]) == _norm(b["period"])
    out: dict[str, Any] = {"change": change, "delta": delta, "delta_pct": rel, "same_target_period": same_target}
    if not same_target:
        out["note"] = f"compares guidance for different target periods ({a['period']} → {b['period']})"
    return out


# ---------------------------------------------------------------- topics


def airtime(topics: list[dict[str, Any]], turn_words: list[int]) -> list[float]:
    total = sum(turn_words) or 1
    return [sum(turn_words[t] for t in tp.get("turns", []) if 0 <= t < len(turn_words)) / total for tp in topics]


def _topic_text(t: dict[str, Any]) -> str:
    return f"{t['label']}. {t.get('summary', '')}"


def compare_topics(
    earlier: list[dict[str, Any]],
    later: list[dict[str, Any]],
    words_a: list[int],
    words_b: list[int],
    embedder: Embedder | None = None,
) -> list[dict[str, Any]]:
    """new / dropped / expanded / reduced / steady, by share of the call's words ("airtime")."""
    emb = embedder or OverlapEmbedder()
    sim = emb.similarity_matrix([_topic_text(t) for t in earlier], [_topic_text(t) for t in later])
    matches = greedy_match(sim, threshold=0.62 if emb.name != "word-overlap" else 0.25)
    sa, sb = airtime(earlier, words_a), airtime(later, words_b)
    rows: list[dict[str, Any]] = []
    ma, mb = {i for i, _, _ in matches}, {j for _, j, _ in matches}
    for i, j, s in matches:
        a, b = sa[i], sb[j]
        if b >= a * 1.5 and b - a >= 0.02:
            change = "expanded"
        elif b <= a / 1.5 and a - b >= 0.02:
            change = "reduced"
        else:
            change = "steady"
        rows.append(
            {
                "label": later[j]["label"],
                "earlier": earlier[i],
                "later": later[j],
                "share_a": a,
                "share_b": b,
                "similarity": round(s, 3),
                "change": change,
            }
        )
    rows += [
        {"label": t["label"], "earlier": None, "later": t, "share_a": 0.0, "share_b": sb[j], "change": "new"}
        for j, t in enumerate(later)
        if j not in mb
    ]
    rows += [
        {"label": t["label"], "earlier": t, "later": None, "share_a": sa[i], "share_b": 0.0, "change": "dropped"}
        for i, t in enumerate(earlier)
        if i not in ma
    ]
    order = {"new": 0, "dropped": 1, "expanded": 2, "reduced": 3, "steady": 4}
    return sorted(rows, key=lambda r: (order[r["change"]], -max(r["share_a"], r["share_b"])))


# ---------------------------------------------------------------- tone


def compare_tone(tone_a: dict[str, Any], tone_b: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for sec in ("prepared", "qa", "all"):
        a, b = tone_a.get("executives", {}).get(sec), tone_b.get("executives", {}).get(sec)
        if a and b:
            out[sec] = {
                k: {"a": a[k], "b": b[k], "delta": b[k] - a[k]}
                for k in ("uncertainty_rate", "positive_rate", "negative_rate", "net_tone")
            }
    return out


# ---------------------------------------------------------------- price reaction


def price_reaction(
    report_date: date,
    report_time: str | None,
    prices: list[tuple[date, float]],
    benchmark: list[tuple[date, float]],
) -> dict[str, Any] | None:
    """1-day and 5-day returns after the report, minus the sector ETF over the same days.

    After-close reports are measured from that day's close; pre-market (or unknown) reports from the
    prior trading day's close. Adjusted closes, so dividends and splits don't distort returns."""
    days = [d for d, _ in prices]
    if not days:
        return None
    post = (report_time or "").lower().startswith("post")
    base_i = max((i for i, d in enumerate(days) if (d <= report_date if post else d < report_date)), default=None)
    if base_i is None or base_i + 1 >= len(days):
        return None
    bench = dict(benchmark)

    def ret(series: dict[date, float] | list[tuple[date, float]], n: int) -> float | None:
        if base_i + n >= len(days):
            return None
        d0, dn = days[base_i], days[base_i + n]
        s = dict(series) if isinstance(series, list) else series
        if d0 not in s or dn not in s or not s[d0]:
            return None
        return s[dn] / s[d0] - 1

    out: dict[str, Any] = {"base_date": str(days[base_i]), "timing": "after close" if post else "before open / unknown"}
    for n in (1, 5):
        r, b = ret(prices, n), ret(bench, n)
        out[f"r{n}"] = r
        out[f"bench_r{n}"] = b
        out[f"excess_r{n}"] = (r - b) if r is not None and b is not None else None
    return out
