import "server-only";
import { select } from "@/lib/db";
import { CALLS_VERSION } from "@/lib/calls";
import { getDcf } from "@/lib/dcf";
import { getCases } from "@/lib/filings";
import { getHolders, getInsiderTrades, summarizeInsiders } from "@/lib/ownership";
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
export async function getQuickTake(company: Company, events: EarningsEvent[], asOf: string): Promise<Signal[]> {
  const t = encodeURIComponent(company.ticker);
  const tab = (k: string, extra = "") => `/c/${t}?tab=${k}${extra}`;
  const since = `${Number(asOf.slice(0, 4)) - 1}${asOf.slice(4)}`;
  const [cases, dcf, cmp, hist, trades, holders] = await Promise.all([
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
      detail: `${holders.result.holders.toLocaleString()} funds · quarter ended ${holders.period}`,
      tone: Math.abs(ch) < 0.01 ? "neutral" : ch > 0 ? "up" : "down",
      href: tab("ownership", "#institutions"),
    });
  }
  return out;
}

function money(v: number): string {
  const a = Math.abs(v);
  return `$${a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : `${(a / 1e3).toFixed(0)}K`}`;
}
