import "server-only";
import { select } from "@/lib/db";
import { CALLS_VERSION } from "@/lib/calls";
import { getDcf } from "@/lib/dcf";
import { getCases } from "@/lib/filings";
import { getHolders, getInsiderTrades, summarizeInsiders } from "@/lib/ownership";
import { getOptions, getRisk } from "@/lib/riskopts";
import type { Company, EarningsEvent } from "@/lib/types";

export type Signal = {
  key: string;
  title: string; // short label, e.g. "Last quarter"
  text: string; // the finding, e.g. "Beat EPS by 4.1%"
  detail: string; // where it comes from
  tone: "up" | "down" | "neutral";
  href: string; // tab with the evidence
};

const pct = (v: number, d = 1) => `${Math.abs(v * 100).toFixed(d)}%`;

/**
 * One-glance summary: each signal is computed in code from data already on the page's tabs,
 * and links to the tab that shows the evidence. No AI.
 */
export type QuickTakeResult = { signals: Signal[]; bottomLine: string[] };

export async function getQuickTake(company: Company, events: EarningsEvent[], asOf: string): Promise<QuickTakeResult> {
  const t = encodeURIComponent(company.ticker);
  const tab = (k: string, extra = "") => `/c/${t}?tab=${k}${extra}`;
  const since = `${Number(asOf.slice(0, 4)) - 1}${asOf.slice(4)}`;
  const [cases, dcf, cmp, hist, trades, holders, risk, opts, revG] = await Promise.all([
    getCases(company.cik),
    getDcf(company.cik),
    select<{ period_a: string; period_b: string; result: { tone?: { all?: { net_tone?: { delta: number } } }; guidance?: { change: string }[] } }>(
      "call_comparisons",
      { cik: `eq.${company.cik}`, analysis_version: `eq.${CALLS_VERSION}`, select: "period_a,period_b,result", order: "created_at.desc", limit: "1" },
    ),
    select<{ snapshot_date: string; period_end: string; eps_avg: number | null }>("eps_estimate_history", {
      cik: `eq.${company.cik}`,
      horizon: "eq.fiscal year",
      snapshot_date: `gte.${since}`,
      select: "snapshot_date,period_end,eps_avg",
      order: "snapshot_date",
    }),
    getInsiderTrades(company.cik, since),
    getHolders(company.cik),
    getRisk(company.cik),
    getOptions(company.cik),
    select<{ value: number; fiscal_year: number; fiscal_period: string }>("metric_values", {
      cik: `eq.${company.cik}`,
      metric: "eq.revenue_growth_yoy",
      fiscal_period: "neq.FY",
      select: "value,fiscal_year,fiscal_period",
      order: "period_end.desc",
      limit: "1",
    }),
  ]);
  const out: Signal[] = [];

  // 1. Last report vs consensus, and track record
  const reported = events
    .filter((e) => e.eps_reported != null && e.eps_estimated != null && e.eps_estimated !== 0)
    .sort((a, b) => b.period_end.localeCompare(a.period_end));
  const last = reported[0];
  if (last) {
    const s = (last.eps_reported as number) / (last.eps_estimated as number) - 1;
    const recent = reported.slice(0, 8);
    const beats = recent.filter((e) => (e.eps_reported as number) > (e.eps_estimated as number)).length;
    out.push({
      key: "last",
      title: `FY${last.fiscal_year} Q${last.fiscal_quarter}`,
      text: Math.abs(s) < 0.005 ? "EPS in line with estimates" : `${s > 0 ? "Beat" : "Missed"} EPS estimate by ${pct(s)}`,
      detail: `$${(last.eps_reported as number).toFixed(2)} vs $${(last.eps_estimated as number).toFixed(2)} expected · beat ${beats} of last ${recent.length}`,
      tone: Math.abs(s) < 0.005 ? "neutral" : s > 0 ? "up" : "down",
      href: tab("street"),
    });
  }

  // 2. Guidance and tone from the latest call comparison
  const c = cmp[0];
  if (c) {
    const g = c.result.guidance ?? [];
    const raised = g.filter((x) => x.change === "raised").length;
    const lowered = g.filter((x) => x.change === "lowered" || x.change === "withdrawn").length;
    if (raised || lowered) {
      out.push({
        key: "guidance",
        title: "Guidance",
        text: raised > lowered ? "Raised more than lowered" : lowered > raised ? "Lowered more than raised" : "Mixed: as many cuts as raises",
        detail: `${raised} raised · ${lowered} lowered or withdrawn · ${c.period_b} vs ${c.period_a} call`,
        tone: raised > lowered ? "up" : lowered > raised ? "down" : "neutral",
        href: tab("call", `&a=${c.period_a}&b=${c.period_b}`),
      });
    }
    const d = c.result.tone?.all?.net_tone?.delta;
    if (d != null) {
      out.push({
        key: "tone",
        title: "Call tone",
        text: Math.abs(d) < 0.1 ? "About as upbeat as a year ago" : d > 0 ? "More upbeat than a year ago" : "More cautious than a year ago",
        detail: `Positive minus negative language, ${c.period_b} vs ${c.period_a}`,
        tone: Math.abs(d) < 0.1 ? "neutral" : d > 0 ? "up" : "down",
        href: tab("call", `&a=${c.period_a}&b=${c.period_b}`),
      });
    }
  }

  // 3. Estimate revisions: next fiscal year's consensus EPS, now vs ~90 days ago
  const nextFy = hist.length ? hist[hist.length - 1].period_end : null;
  const series = hist.filter((h) => h.period_end === nextFy && h.eps_avg);
  if (series.length >= 2) {
    const now = series[series.length - 1];
    const cutoff = new Date(`${now.snapshot_date}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - 90);
    const base = [...series].reverse().find((h) => h.snapshot_date <= cutoff.toISOString().slice(0, 10)) ?? series[0];
    const days = Math.round((Date.parse(now.snapshot_date) - Date.parse(base.snapshot_date)) / 864e5);
    if (days >= 21 && base.eps_avg) {
      const r = (now.eps_avg as number) / base.eps_avg - 1;
      out.push({
        key: "revisions",
        title: "Analyst estimates",
        text: Math.abs(r) < 0.01 ? "Next-year EPS estimate steady" : `Next-year EPS estimate ${r > 0 ? "up" : "down"} ${pct(r)}`,
        detail: `Over ${days} days, fiscal year ending ${nextFy}`,
        tone: Math.abs(r) < 0.01 ? "neutral" : r > 0 ? "up" : "down",
        href: tab("street", "#sv-estimates"),
      });
    }
  }

  // 4. Valuation vs the stock's own history
  const pe = company.valuation?.pe_fwd_ntm;
  const band = cases?.numbers.pe;
  if (pe && band && pe > 0) {
    const cheap = pe < band.p20;
    const rich = pe > band.p80;
    out.push({
      key: "pe",
      title: "Valuation",
      text: cheap ? "Cheaper than usual" : rich ? "Pricier than usual" : "Valued in its usual range",
      detail: `Forward P/E ${pe.toFixed(1)}× vs its 3-year range ${band.p20.toFixed(1)}–${band.p80.toFixed(1)}×`,
      tone: cheap ? "up" : rich ? "down" : "neutral",
      href: tab("street", "#sv-value"),
    });
  }

  // 5. DCF
  const up = dcf?.status === "ok" ? dcf.result?.upside : null;
  if (up != null && dcf?.result?.per_share) {
    out.push({
      key: "dcf",
      title: "DCF model",
      text: Math.abs(up) < 0.1 ? "Close to fair value" : `${pct(up, 0)} ${up > 0 ? "upside" : "downside"} to model value`,
      detail: `$${dcf.result.per_share.toFixed(0)} per share from SEC financials, 10-year model`,
      tone: Math.abs(up) < 0.1 ? "neutral" : up > 0 ? "up" : "down",
      href: tab("street", "#sv-dcf"),
    });
  }

  // 6. Insiders (open-market only)
  const s = summarizeInsiders(trades, asOf, 12);
  if (s.buys || s.sells) {
    const netBuy = s.buys > s.sells;
    const planned = (s.plannedSellPct ?? 0) >= 0.5;
    out.push({
      key: "insiders",
      title: "Insiders (12 mo.)",
      text: netBuy ? `Net buyers: ${money(s.buys)} bought` : `Net sellers: ${money(s.sells)} sold`,
      detail: netBuy
        ? `${s.buyers} ${s.buyers === 1 ? "insider" : "insiders"} bought in the open market`
        : `${s.sellers} sellers${s.plannedSellPct != null ? ` · ${pct(s.plannedSellPct, 0)} pre-scheduled` : ""}`,
      // buying is a real signal; routine planned selling isn't
      tone: netBuy ? "up" : planned ? "neutral" : "down",
      href: tab("ownership", "#insiders"),
    });
  }

  // 7. Institutions
  const ch = holders?.result.shares_change_pct;
  if (holders && ch != null) {
    out.push({
      key: "funds",
      title: "Funds (13F)",
      text: Math.abs(ch) < 0.01 ? "Fund holdings steady" : `Funds ${ch > 0 ? "added" : "cut"} ${pct(ch)} of holdings`,
      detail: `Funds filing both quarters · ${holders.result.holders.toLocaleString()} holders · quarter ended ${holders.period}`,
      tone: Math.abs(ch) < 0.01 ? "neutral" : ch > 0 ? "up" : "down",
      href: tab("ownership", "#institutions"),
    });
  }
  // 8. Options: the move priced for the next earnings report
  const em = opts?.result.earnings;
  if (em) {
    const avg = risk?.avg_earnings_move;
    out.push({
      key: "options",
      title: "Options",
      text: em.day_move != null ? `Imply ±${pct(em.day_move)} move on earnings day` : `Pricing ±${pct(em.move)} through earnings week`,
      detail: `Report ${em.date}${avg != null ? ` · past earnings days averaged ±${pct(avg)}` : ""}`,
      tone: "neutral",
      href: tab("options"),
    });
  }

  // 9. Financial strength (Piotroski F-score from SEC filings)
  const f = risk?.fundamental.piotroski;
  if (f) {
    out.push({
      key: "fscore",
      title: "Financial strength",
      text: `Piotroski score ${f.score} of ${f.out_of} — ${f.score >= 7 ? "strong" : f.score <= 3 ? "weak" : "middling"}`,
      detail: `Profitability, balance sheet and efficiency checks, FY${f.fiscal_year}`,
      tone: f.score >= 7 ? "up" : f.score <= 3 ? "down" : "neutral",
      href: tab("risk", "#rk-fund"),
    });
  }
  return { signals: out, bottomLine: bottomLine(company.ticker, out, revG[0] ?? null, band ?? null, pe ?? null) };
}

/**
 * Three plain sentences (results, outlook, valuation) assembled in code from the signals above.
 * States facts in everyday words; never a recommendation.
 */
function bottomLine(
  ticker: string,
  sig: Signal[],
  rev: { value: number; fiscal_year: number; fiscal_period: string } | null,
  band: { p20: number; p50: number; p80: number } | null,
  pe: number | null,
): string[] {
  const by = (k: string) => sig.find((x) => x.key === k);
  const lines: string[] = [];
  // 1. results
  const last = by("last");
  const revText = rev ? `revenue ${rev.value >= 0 ? "grew" : "fell"} ${pct(rev.value)} from a year earlier` : null;
  if (last) {
    const size = last.text.match(/by [\d.]+%/)?.[0];
    const verb =
      last.tone === "up" ? `beat earnings estimates${size ? ` ${size}` : ""}` : last.tone === "down" ? `missed earnings estimates${size ? ` ${size}` : ""}` : "matched earnings estimates";
    lines.push(`${ticker} ${verb} last quarter${revText ? `, and ${revText}` : ""}.`);
  } else if (revText) {
    lines.push(`Last quarter, ${revText}.`);
  }
  // 2. outlook
  const g = by("guidance");
  const r = by("revisions");
  const parts: string[] = [];
  if (g) parts.push(g.tone === "up" ? "management raised more forecasts than it cut" : g.tone === "down" ? "management cut more forecasts than it raised" : "management raised and cut forecasts in equal measure");
  if (r) parts.push(r.tone === "up" ? "analysts have been raising their estimates" : r.tone === "down" ? "analysts have been lowering their estimates" : "analysts' estimates have held steady");
  if (parts.length) lines.push(`Looking ahead, ${parts.join(", and ")}.`);
  // 3. valuation
  const d = by("dcf");
  const v: string[] = [];
  if (band && pe) {
    v.push(
      pe > band.p80
        ? `the stock is priced above its usual range (${pe.toFixed(0)}× forward earnings vs ${band.p20.toFixed(0)}–${band.p80.toFixed(0)}× over 3 years)`
        : pe < band.p20
          ? `the stock is priced below its usual range (${pe.toFixed(0)}× forward earnings vs ${band.p20.toFixed(0)}–${band.p80.toFixed(0)}× over 3 years)`
          : `the stock is priced within its usual range (${pe.toFixed(0)}× forward earnings)`,
    );
  }
  if (d) v.push(d.tone === "neutral" ? "the DCF model puts it close to fair value" : `the DCF model ${d.tone === "up" ? "is above" : "is below"} today's price (${d.text.replace(" to model value", "")})`);
  if (v.length) lines.push(`${v.join("; ").replace(/^./, (c) => c.toUpperCase())}.`);
  return lines.slice(0, 3);
}

function money(v: number): string {
  const a = Math.abs(v);
  return `$${a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : `${(a / 1e3).toFixed(0)}K`}`;
}
