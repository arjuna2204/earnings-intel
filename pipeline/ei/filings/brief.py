"""The 'What changed' brief: code assembles numbered facts; Sonnet writes claims citing them; code
checks every citation and every number, dropping claims that fail. The model never computes."""

from __future__ import annotations

import re
from typing import Any

from ei.ai import AiClient, load_prompt
from ei.calls.extract import _stated

PROMPT_FILE = "brief.v1.md"
VERSION = "brief-v1"
MODEL = "claude-sonnet-5-5"
SECTIONS = ["headline", "street", "results", "guidance", "call", "risks", "tensions"]

SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["claims"],
    "properties": {
        "claims": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["section", "text", "refs"],
                "properties": {
                    "section": {"type": "string", "enum": SECTIONS},
                    "text": {"type": "string"},
                    "refs": {"type": "array", "items": {"type": "string"}},
                },
            },
        }
    },
}

# ------------------------------------------------------------------ number formatting (code only)


def money(x: float | None) -> str:
    if x is None:
        return "n/a"
    a = abs(x)
    sign = "-" if x < 0 else ""
    if a >= 1e9:
        return f"{sign}${a / 1e9:,.1f}B"
    if a >= 1e6:
        return f"{sign}${a / 1e6:,.0f}M"
    return f"{sign}${a:,.2f}"


def pct(x: float | None, digits: int = 1) -> str:
    return "n/a" if x is None else f"{x * 100:.{digits}f}%"


def chg_pct(a: float | None, b: float | None) -> str | None:
    if a is None or b is None or a == 0 or a < 0:
        return None
    return f"{(b / a - 1) * 100:+.1f}%"


def chg_pp(a: float | None, b: float | None) -> str | None:
    if a is None or b is None:
        return None
    return f"{(b - a) * 100:+.1f} pp"


# ------------------------------------------------------------------ facts

X_METRICS = [
    ("revenue", "Revenue", "money"),
    ("gross_margin", "Gross margin", "ratio"),
    ("operating_margin", "Operating margin", "ratio"),
    ("operating_income", "Operating income", "money"),
    ("net_income", "Net income", "money"),
    ("eps_diluted", "Diluted EPS (GAAP)", "eps"),
    ("adj_eps_std", "Adjusted EPS (computed by this app)", "eps"),
    ("adj_ebitda_std", "Adjusted EBITDA (computed by this app)", "money"),
    ("operating_cash_flow", "Operating cash flow", "money"),
    ("free_cash_flow", "Free cash flow", "money"),
    ("diluted_shares", "Diluted shares", "shares"),
]


def _fmt(v: float | None, kind: str) -> str:
    if v is None:
        return "n/a"
    if kind == "money":
        return money(v)
    if kind == "ratio":
        return pct(v)
    if kind == "eps":
        return f"${v:.2f}"
    return f"{v / 1e6:,.0f}M"


def xbrl_facts(vals: dict[str, dict[str, float]], la: str, lb: str, notes: dict[str, str]) -> list[dict[str, Any]]:
    out = []
    for key, label, kind in X_METRICS:
        a, b = vals.get(key, {}).get(la), vals.get(key, {}).get(lb)
        if a is None and b is None:
            continue
        change = chg_pp(a, b) if kind == "ratio" else chg_pct(a, b)
        text = f"{label}: {la} {_fmt(a, kind)} → {lb} {_fmt(b, kind)}" + (f" ({change})" if change else "")
        if key in notes:
            text += f". Method: {notes[key]}"
        out.append({"type": "xbrl", "metric": key, "text": text})
    return out


def street_facts(
    release_b: dict[str, Any] | None,
    release_a: dict[str, Any] | None,
    events: dict[str, dict[str, Any]],
    lb: str,
    la: str,
    valuation: dict[str, Any],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for lbl, ev in ((lb, events.get(lb)), (la, events.get(la))):
        if ev and ev.get("eps_reported") is not None and ev.get("eps_estimated") is not None:
            rep, est = float(ev["eps_reported"]), float(ev["eps_estimated"])
            surprise = (rep / est - 1) * 100 if est else None
            verdict = "beat" if rep > est else "missed" if rep < est else "matched"
            out.append(
                {
                    "type": "street_eps",
                    "text": f"{lbl} Street EPS (as reported to analysts) ${rep:.2f} vs consensus ${est:.2f}: {verdict}"
                    + (f" by {surprise:+.1f}%" if surprise is not None else "")
                    + " (Alpha Vantage)",
                }
            )
    for lbl, rel in ((lb, release_b), (la, release_a)):
        if not rel:
            continue
        for f in rel.get("figures", []):
            unit = f["unit"]
            if unit == "percent":
                cur = f"{f['current']}%"
                prior = f"{f['prior']}%" if f.get("prior") is not None else None
            elif unit == "USD per share":
                cur = f"${f['current']:.2f}"
                prior = f"${f['prior']:.2f}" if f.get("prior") is not None else None
            else:
                cur = money(f["value"])
                prior = money(f["prior_value"]) if f.get("prior_value") is not None else None
            out.append(
                {
                    "type": "release",
                    "period": lbl,
                    "text": f"{lbl} earnings release — {f['label']}: {cur}" + (f" (year-ago {prior})" if prior else ""),
                    "quote": f["quote"],
                }
            )
        for adj in rel.get("adjustments", [])[:8]:
            out.append(
                {
                    "type": "release_adj",
                    "period": lbl,
                    "text": f"{lbl} non-GAAP adjustment ({adj['applies_to']}): {adj['label']}",
                    "quote": adj["quote"],
                }
            )
        if rel.get("non_gaap_definition"):
            out.append(
                {
                    "type": "release_def",
                    "period": lbl,
                    "text": f"{lbl} non-GAAP definition",
                    "quote": rel["non_gaap_definition"],
                }
            )
    if valuation.get("pe_fwd_ntm") and valuation.get("eps_ntm"):
        text = (
            f"Forward P/E on next-12-months consensus EPS ${valuation['eps_ntm']:.2f}: {valuation['pe_fwd_ntm']:.1f}x"
        )
        if valuation.get("pe_adj_ltm"):
            text += f"; adjusted P/E on last-12-months Street EPS: {valuation['pe_adj_ltm']:.1f}x"
        out.append({"type": "valuation", "text": text})
    return [f for f in out if f["text"]]


def call_facts(comp: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not comp:
        return []
    out: list[dict[str, Any]] = []
    for g in comp.get("guidance", []):
        if g.get("change") in {"unchanged", None}:
            continue
        side = g.get("later") or g.get("earlier") or {}
        out.append(
            {
                "type": "guidance",
                "text": f"Guidance {g['change']}: {g.get('metric')}"
                + (f" — earlier: “{g['earlier']['quote']}”" if g.get("earlier") else "")
                + (f" — later: “{g['later']['quote']}”" if g.get("later") else ""),
                "quote": side.get("quote"),
                "turn": side.get("turn"),
            }
        )
    for t in comp.get("topics", []):
        if t.get("change") not in {"new", "dropped", "grew", "shrank"}:
            continue
        side = t.get("later") or t.get("earlier") or {}
        out.append(
            {
                "type": "topic",
                "text": f"Call topic {t['change']}: {t['label']} — “{side.get('quote', '')}”",
                "quote": side.get("quote"),
                "turn": side.get("turn"),
            }
        )
    tone = (comp.get("tone") or {}).get("all") or {}
    nt = tone.get("net_tone") or {}
    if nt.get("a") is not None and nt.get("b") is not None:
        out.append(
            {"type": "tone", "text": f"Call net tone (Loughran-McDonald word counts): {nt['a']:.2f} → {nt['b']:.2f}"}
        )
    unc = tone.get("uncertainty_rate") or {}
    if unc.get("a") is not None and unc.get("b") is not None:
        out.append(
            {"type": "tone", "text": f"Call hedging words per 100 words: {unc['a'] * 100:.2f} → {unc['b'] * 100:.2f}"}
        )
    return out[:30]


def filing_facts(mdna_b: dict[str, Any] | None, label_b: str) -> list[dict[str, Any]]:
    if not mdna_b:
        return []
    out = []
    for d in mdna_b.get("drivers", [])[:24]:
        out.append(
            {
                "type": "driver",
                "text": f"{label_b} MD&A — {d['metric']} {d['direction']}"
                + (f" ({d['change_text']})" if d.get("change_text") else "")
                + f"{' offset' if d.get('offset') else ''}: {d['driver']} — “{d['quote']}”",
                "quote": d["quote"],
            }
        )
    for o in mdna_b.get("outlook", [])[:6]:
        out.append(
            {
                "type": "outlook",
                "text": f"{label_b} filing outlook — {o['metric']}: “{o['quote']}”",
                "quote": o["quote"],
            }
        )
    for c in mdna_b.get("capital", [])[:6]:
        out.append(
            {"type": "capital", "text": f"{label_b} capital — {c['label']}: “{c['quote']}”", "quote": c["quote"]}
        )
    return out


def risk_facts(risk: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not risk:
        return []
    out = []
    for c in risk.get("changes", []):
        if c["status"] == "added":
            out.append({"type": "risk", "text": f"Risk factor ADDED: “{c['headline']}”"})
        elif c["status"] == "removed":
            out.append({"type": "risk", "text": f"Risk factor REMOVED: “{c['headline']}”"})
        elif c["status"] == "modified" and c.get("escalations"):
            out.append(
                {
                    "type": "risk",
                    "text": f"Risk factor reworded with escalated language: “{c['headline']}” — "
                    + "; ".join(c["escalations"][:2]),
                }
            )
    return out[:14]


def assemble(groups: dict[str, list[dict[str, Any]]]) -> dict[str, dict[str, Any]]:
    facts: dict[str, dict[str, Any]] = {}
    for prefix, items in groups.items():
        for n, f in enumerate(items, 1):
            facts[f"{prefix}{n}"] = f
    return facts


def render_facts(facts: dict[str, dict[str, Any]]) -> str:
    return "\n".join(f"[{k}] {v['text']}" for k, v in facts.items())


# ------------------------------------------------------------------ verification

_NUM_TOKEN = re.compile(r"(?<![A-Za-z0-9.,])[-+]?\$?\d[\d,]*(?:\.\d+)?")


def _numbers(text: str) -> list[float]:
    out = []
    for m in _NUM_TOKEN.finditer(text):
        tok = m.group(0).replace("$", "").replace(",", "").lstrip("+")
        try:
            v = float(tok)
        except ValueError:
            continue
        tail = text[m.end() : m.end() + 1]
        if 1990 <= abs(v) <= 2100 and "." not in tok and tail not in {"%", "M", "B"}:
            continue  # years
        if re.match(r"[QH]\d", text[max(m.start() - 1, 0) : m.end()]):
            continue  # Q4, H1
        out.append(abs(v))
    return out


def verify_claims(
    raw: dict[str, Any], facts: dict[str, dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    kept: list[dict[str, Any]] = []
    dropped: list[dict[str, Any]] = []
    for c in raw.get("claims", []):
        refs = [r.strip("[] ") for r in c.get("refs", [])]
        bad = [r for r in refs if r not in facts]
        if not refs or bad:
            dropped.append({**c, "reason": f"unknown source {bad}" if bad else "no sources"})
            continue
        support = " ".join(facts[r]["text"] + " " + (facts[r].get("quote") or "") for r in refs)
        missing = [x for x in _numbers(c["text"]) if not _stated(x, support)]
        if missing:
            dropped.append({**c, "reason": f"number(s) not in cited facts: {missing}"})
            continue
        if c["section"] == "tensions":
            kinds = {r[0] for r in refs}
            if "C" not in kinds or not kinds & {"F", "X", "R"}:
                dropped.append({**c, "reason": "tension needs a call fact and a filing/financial fact"})
                continue
        kept.append({**c, "refs": refs})
    return kept, dropped


def write_brief(
    ai: AiClient, facts: dict[str, dict[str, Any]], company: str, la: str, lb: str, cik: int
) -> dict[str, Any]:
    user = f"Company: {company}\nCompare {la} (earlier) with {lb} (later).\n\nFACTS\n{render_facts(facts)}"
    res = ai.json_call(
        model=MODEL,
        purpose=f"brief:{la}-{lb}",
        system=load_prompt(PROMPT_FILE),
        user=user,
        schema=SCHEMA,
        max_tokens=5000,
        cik=cik,
        effort="medium",
    )
    kept, dropped = verify_claims(res.data, facts)
    return {"claims": kept, "dropped": dropped, "raw": res.data, "cost_usd": float(res.cost)}
