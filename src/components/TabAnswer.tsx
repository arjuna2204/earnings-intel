import { cache } from "react";
import { select } from "@/lib/db";
import { getQuickTake } from "@/lib/quicktake";
import { getRisk } from "@/lib/riskopts";
import { latestRecap } from "@/lib/screener";
import type { Company, EarningsEvent } from "@/lib/types";
import type { TabKey } from "@/lib/tabs";

/** One quick take per request, shared by the tab answer and the Overview. */
export const quickTake = cache(getQuickTake);

type Tone = "up" | "down" | "neutral";
type Answer = { text: string; why: string[]; tone: Tone };

const pct = (v: number, d = 1) => `${Math.abs(v * 100).toFixed(d)}%`;

/**
 * The one-line answer every tab opens with, computed in code from the same data the tab shows (no AI),
 * then a muted line or two on why. Renders nothing when the data for that answer isn't in yet.
 */
export default async function TabAnswer({ tab, company, events, asOf }: { tab: TabKey; company: Company; events: EarningsEvent[]; asOf: string }) {
  let a: Answer | null = null;
  try {
    a = await answer(tab, company, events, asOf);
  } catch {
    a = null;
  }
  if (!a) return null;
  return (
    <section aria-label="The short answer" className="max-w-3xl">
      <p className="text-balance text-[20px] font-semibold leading-snug tracking-[-0.015em] sm:text-[24px]" data-testid="tab-answer">
        {a.tone !== "neutral" && (
          <span aria-hidden className={`mr-2 inline-block h-2.5 w-2.5 translate-y-[-0.15em] rounded-full ${a.tone === "up" ? "bg-up" : "bg-down"}`} />
        )}
        {a.text}
      </p>
      {a.why.length > 0 && <p className="mt-2 text-[15px] leading-relaxed text-muted">{a.why.join(" · ")}</p>}
    </section>
  );
}

async function answer(tab: TabKey, company: Company, events: EarningsEvent[], asOf: string): Promise<Answer | null> {
  switch (tab) {
    case "overview": {
      const q = await quickTake(company, events, asOf);
      if (!q.bottomLine.length) return null;
      return { text: q.bottomLine[0], why: q.bottomLine.slice(1), tone: "neutral" };
    }
    case "earnings": {
      const [q, recap] = await Promise.all([quickTake(company, events, asOf), latestRecap(company.ticker, 45)]);
      const sig = (k: string) => q.signals.find((s) => s.key === k);
      const last = sig("last");
      const g = sig("guidance");
      const tone = sig("tone");
      if (!last && !recap) return null;
      const lead = q.bottomLine[0] ?? (last ? `${last.text} last quarter.` : "");
      const why = [last?.detail, g ? `Guidance: ${g.text.toLowerCase()}` : null, tone?.text ?? null].filter((x): x is string => Boolean(x));
      if (recap?.move != null) why.push(`Stock ${recap.move >= 0 ? "rose" : "fell"} ${pct(recap.move)} on the report`);
      return { text: lead || `Reported ${recap?.quarter ?? "last quarter"}.`, why: why.slice(0, 3), tone: last?.tone ?? "neutral" };
    }
    case "valuation": {
      const q = await quickTake(company, events, asOf);
      const pe = q.signals.find((s) => s.key === "pe");
      const dcf = q.signals.find((s) => s.key === "dcf");
      const v = company.valuation;
      if (!pe && !dcf && !v?.pe) return null;
      const text = pe
        ? `${pe.text}${dcf ? `, and ${dcf.text.toLowerCase()}` : ""}.`
        : dcf
          ? `${dcf.text}.`
          : `Trades at ${(v?.pe as number).toFixed(1)}× last year's earnings.`;
      const why = [pe?.detail, dcf?.detail].filter((x): x is string => Boolean(x));
      return { text, why, tone: pe?.tone ?? dcf?.tone ?? "neutral" };
    }
    case "risk": {
      const [r, rc] = await Promise.all([
        getRisk(company.cik),
        select<{ summary: { report_new?: string; counts?: { added?: number } } }>("risk_comparisons", { cik: `eq.${company.cik}`, select: "summary" }).catch(() => []),
      ]);
      const vol = r?.volatility.y1;
      const mkt = r?.volatility.market_y1;
      const latest = [...rc].sort((x, y) => String(y.summary.report_new ?? "").localeCompare(String(x.summary.report_new ?? "")))[0];
      const added = latest?.summary.counts?.added ?? null;
      if (vol == null || !mkt) {
        if (added == null) return null;
        return { text: `${added ? `${added} new risk factor${added === 1 ? "" : "s"}` : "No new risk factors"} in the latest annual report.`, why: [], tone: added ? "down" : "neutral" };
      }
      const ratio = vol / mkt;
      const text =
        ratio > 1.6 ? `About ${ratio.toFixed(1)}× as jumpy as the S&P 500` : ratio < 0.8 ? "Calmer than the S&P 500" : "About as jumpy as the S&P 500";
      const tail = added != null ? `, with ${added ? `${added} new risk factor${added === 1 ? "" : "s"}` : "no new risk factors"} in its latest 10-K.` : ".";
      const why = [`Swings about ${pct(vol, 0)} a year vs ${pct(mkt, 0)} for the market`];
      if (r?.drawdown.y1.max != null) why.push(`Worst drop in the past year: ${pct(r.drawdown.y1.max, 0)}`);
      return { text: `${text}${tail}`, why, tone: ratio > 1.6 ? "down" : "neutral" };
    }
    case "financials": {
      const rows = await select<{ metric: string; value: number; fiscal_year: number; fiscal_period: string }>("metric_values", {
        cik: `eq.${company.cik}`,
        metric: "in.(revenue_growth_yoy,operating_margin)",
        fiscal_period: "neq.FY",
        select: "metric,value,fiscal_year,fiscal_period",
        order: "period_end.desc",
        limit: "12",
      }).catch(() => []);
      const g = rows.filter((x) => x.metric === "revenue_growth_yoy");
      const m = rows.filter((x) => x.metric === "operating_margin");
      if (!g[0] && !m[0]) return null;
      const parts: string[] = [];
      if (g[0]) parts.push(`Revenue ${g[0].value >= 0 ? "up" : "down"} ${pct(g[0].value)} from a year ago`);
      // the same quarter a year earlier, for the margin trend
      const m0 = m[0];
      const mYear = m0 ? m.find((x) => x.fiscal_period === m0.fiscal_period && x.fiscal_year === m0.fiscal_year - 1) : undefined;
      if (m0)
        parts.push(
          `operating margin ${pct(m0.value, 0)}${mYear ? (Math.abs(m0.value - mYear.value) < 0.005 ? ", about the same as a year earlier" : ` (${m0.value > mYear.value ? "up" : "down"} from ${pct(mYear.value, 0)})`) : ""}`,
        );
      const text = `${parts.join(", with ")}.`;
      const ref = g[0] ?? m0;
      return {
        text: text.charAt(0).toUpperCase() + text.slice(1),
        why: [`${ref.fiscal_period} FY${ref.fiscal_year}, from the company's 10-Q/10-K`],
        tone: g[0] ? (g[0].value > 0.02 ? "up" : g[0].value < 0 ? "down" : "neutral") : "neutral",
      };
    }
    case "business": {
      const rows = await select<{ result: { customers: { name: string; share_pct: number | null; basis: string }[]; suppliers: { name: string }[]; sole_source: boolean } }>(
        "supply_chain",
        { cik: `eq.${company.cik}`, select: "result" },
      ).catch(() => []);
      const s = rows[0]?.result;
      if (!s) return null;
      const rev = s.customers.filter((c) => c.basis === "revenue" && c.share_pct != null && !/^(top|largest)\b|customers\b/i.test(c.name));
      const top = rev.reduce((acc, c) => acc + (c.share_pct ?? 0), 0);
      const biggest = [...rev].sort((x, y) => (y.share_pct ?? 0) - (x.share_pct ?? 0))[0];
      const text = biggest
        ? `${rev.length === 1 ? `One customer, ${biggest.name},` : `${rev.length} customers`} made up ${top.toFixed(0)}% of revenue.`
        : "No single customer is big enough to name in the 10-K.";
      const why = [
        s.suppliers.length ? `${s.suppliers.length} key supplier${s.suppliers.length === 1 ? "" : "s"} named` : "No key suppliers named",
        ...(s.sole_source ? ["relies on at least one sole-source supplier"] : []),
      ];
      return { text, why, tone: top >= 30 ? "down" : "neutral" };
    }
  }
}
