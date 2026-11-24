import Link from "next/link";
import type { ReactNode } from "react";
import Term from "@/components/Term";
import { RecapFacts, recapDate } from "@/components/RecapLine";
import { select } from "@/lib/db";
import { getEvents8k, ITEMS } from "@/lib/events";
import { fmtMacro, getMacro, MACRO, reading, SECTOR_MACRO } from "@/lib/macro";
import type { Signal } from "@/lib/quicktake";
import { quickTake } from "@/components/TabAnswer";
import { getOptions, getRisk } from "@/lib/riskopts";
import { latestRecap } from "@/lib/screener";
import { viewHref, type ViewKey } from "@/lib/tabs";
import type { Company, EarningsEvent } from "@/lib/types";

type Tone = "up" | "down" | "neutral";
type Card = { q: string; term: string; answer: string; tone: Tone; support: string[]; view: ViewKey; cta: string };

const pct = (v: number, d = 1) => `${Math.abs(v * 100).toFixed(d)}%`;

function Arrow({ tone }: { tone: Tone }) {
  if (tone === "up") return <span className="text-up-ink" aria-label="positive">▲</span>;
  if (tone === "down") return <span className="text-down-ink" aria-label="negative">▼</span>;
  return <span className="text-muted" aria-label="neutral">●</span>;
}

/**
 * The first screen for a company: the bottom line, four everyday questions answered in one line each,
 * and what to watch next. Every answer is computed in code from the other tabs and links to them.
 */
export default async function Overview({
  company,
  events,
  asOf,
  eventsSlot,
}: {
  company: Company;
  events: EarningsEvent[];
  asOf: string;
  /** the company's 8-K events, shown inside Things to watch */
  eventsSlot?: ReactNode;
}) {
  const path = `/c/${encodeURIComponent(company.ticker)}`;
  const today = new Date(`${asOf}T12:00:00Z`).toISOString().slice(0, 10);
  const since60 = new Date(Date.parse(`${today}T12:00:00Z`) - 60 * 86400000).toISOString().slice(0, 10);
  const [q, recap, risk, opts, revG, next, ev] = await Promise.all([
    quickTake(company, events, asOf),
    latestRecap(company.ticker),
    getRisk(company.cik),
    getOptions(company.cik),
    select<{ value: number; fiscal_year: number; fiscal_period: string }>("metric_values", {
      cik: `eq.${company.cik}`,
      metric: "eq.revenue_growth_yoy",
      fiscal_period: "neq.FY",
      select: "value,fiscal_year,fiscal_period",
      order: "period_end.desc",
      limit: "5",
    }).catch(() => []),
    select<{ report_date: string; eps_estimate: number | null }>("earnings_calendar", {
      ticker: `eq.${company.ticker}`,
      report_date: `gte.${today}`,
      select: "report_date,eps_estimate",
      order: "report_date.asc",
      limit: "1",
    }).catch(() => []),
    getEvents8k(company.cik, since60),
  ]);
  const sig = (k: string): Signal | undefined => q.signals.find((s) => s.key === k);

  // 1. Growing?
  const cards: Card[] = [];
  const g0 = revG[0];
  if (g0) {
    const prior = revG.slice(1).map((r) => r.value);
    const avg = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : null;
    const pace = avg == null ? "" : g0.value > avg + 0.02 ? ", faster than its recent pace" : g0.value < avg - 0.02 ? ", slower than its recent pace" : ", in line with its recent pace";
    const last = sig("last");
    cards.push({
      q: "Is the business growing?",
      term: "revenue_growth_yoy",
      answer: `Revenue ${g0.value >= 0 ? "up" : "down"} ${pct(g0.value)} vs a year ago${pace}`,
      tone: g0.value > 0.02 ? "up" : g0.value < 0 ? "down" : "neutral",
      support: [`${g0.fiscal_period} FY${g0.fiscal_year}, from the 10-Q/10-K`, ...(last ? [last.text] : [])],
      view: "historical",
      cta: "See the financials",
    });
  }
  // 2. Expensive?
  const pe = sig("pe");
  const dcf = sig("dcf");
  const v = company.valuation;
  if (pe || dcf || v?.pe) {
    cards.push({
      q: "Is it expensive?",
      term: "pe",
      answer: pe ? pe.text : v?.pe ? `Trades at ${v.pe.toFixed(1)}× last year's earnings` : (dcf?.text ?? ""),
      tone: pe ? pe.tone : "neutral",
      support: [...(pe ? [pe.detail] : []), ...(dcf ? [`Our DCF: ${dcf.text.toLowerCase()}`] : [])],
      view: "street",
      cta: "See the valuation",
    });
  }
  // 3. What did management say?
  const guid = sig("guidance");
  const tone = sig("tone");
  const rev = sig("revisions");
  cards.push(
    guid || tone || rev
      ? {
          q: "What did management just say?",
          term: "guidance",
          answer: guid ? guid.text : tone ? tone.text : (rev?.text ?? ""),
          tone: guid ? guid.tone : tone ? tone.tone : (rev?.tone ?? "neutral"),
          support: [...(guid && tone ? [tone.text] : []), ...(rev ? [`Analysts: ${rev.text.toLowerCase()}`] : [])],
          view: "call",
          cta: "Read the call",
        }
      : {
          q: "What did management just say?",
          term: "guidance",
          answer: "Not analyzed yet",
          tone: "neutral",
          support: ["Open the call to compare the last two earnings calls."],
          view: "call",
          cta: "Analyze the call",
        },
  );
  // 4. How bumpy?
  const vol = risk?.volatility.y1;
  const mkt = risk?.volatility.market_y1;
  if (vol != null && mkt) {
    const r = vol / mkt;
    const em = opts?.result.earnings?.day_move;
    cards.push({
      q: "How bumpy is the ride?",
      term: "volatility",
      answer: r > 1.6 ? `About ${r.toFixed(1)}× as jumpy as the S&P 500` : r < 0.8 ? "Calmer than the S&P 500" : "About as jumpy as the S&P 500",
      tone: "neutral",
      support: [
        `Swings about ${pct(vol, 0)} a year vs ${pct(mkt, 0)} for the market`,
        ...(em != null ? [`Options expect a ±${pct(em)} move on earnings day`] : []),
      ],
      view: "riskstats",
      cta: "See the risk",
    });
  }

  // things to watch
  const watch: { text: string; sub?: string; tone: Tone; href: string }[] = [];
  if (next[0]) {
    const em = opts?.result.earnings;
    watch.push({
      text: `Reports ${recapDate(next[0].report_date)}`,
      sub: [
        next[0].eps_estimate != null ? `EPS est. $${Number(next[0].eps_estimate).toFixed(2)}` : null,
        em?.date === next[0].report_date && em.day_move != null ? `options expect ±${pct(em.day_move)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      tone: "neutral",
      href: viewHref(path, "brief"),
    });
  }
  const big = ev.find((e) => e.weight !== "routine");
  if (big) {
    watch.push({
      text: big.items.map((i) => ITEMS[i]?.label ?? `Item ${i}`).join(" · "),
      sub: `8-K filed ${recapDate(big.date)}`,
      tone: big.weight === "high" ? "down" : "neutral",
      href: "#company-events",
    });
  }
  for (const k of ["insiders", "funds", "revisions"]) {
    const s = sig(k);
    if (s && s.tone !== "neutral" && watch.length < 3) watch.push({ text: s.text, sub: s.title, tone: s.tone, href: s.href });
  }
  // the macro number that matters most for this company's sector
  const sm = company.sector_etf ? SECTOR_MACRO[company.sector_etf] : undefined;
  if (sm && watch.length < 3) {
    const [s] = await getMacro([sm.ids[0]], 1);
    const r = s ? reading(s) : null;
    if (r) {
      watch.push({
        text: `${MACRO[s.id].name} ${fmtMacro(s.id, r.last[1])}${r.change != null ? `, ${r.change >= 0 ? "up" : "down"} ${Math.abs(r.change).toFixed(2)}${MACRO[s.id].unit === "%" || MACRO[s.id].unit === "pts" ? " pts" : ""} in 3 months` : ""}`,
        sub: sm.note,
        tone: "neutral",
        href: "/macro",
      });
    }
  }
  const held = (company.quality ?? []).filter((f) => f.severity === "hide");
  if (held.length && watch.length < 3) {
    watch.push({ text: "Some numbers are held back", sub: "They failed today's data checks", tone: "neutral", href: viewHref(path, "street") });
  }

  return (
    <div className="space-y-12">
      {recap && (
        <section aria-labelledby="ov-recap" className="rounded-2xl bg-card p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="ov-recap" className="text-lg">
              Just reported{recap.quarter ? ` · ${recap.quarter}` : ""}
            </h2>
            <span className="text-[13px] text-muted">{recapDate(recap.report_date)}</span>
          </div>
          <div className="mt-2">
            <RecapFacts r={recap} />
          </div>
        </section>
      )}

      <section aria-label="Four questions">
        <ul className="grid gap-3 sm:grid-cols-2">
          {cards.map((c) => (
            <li key={c.q}>
              <Link href={viewHref(path, c.view)} scroll={false} className="lift group flex h-full flex-col rounded-2xl bg-card p-5 sm:p-6">
                <span className="text-[15px] text-muted">{c.q}</span>
                <span className="mt-1.5 flex items-baseline gap-2 text-[19px] font-semibold leading-snug tracking-[-0.01em]">
                  <Arrow tone={c.tone} />
                  {c.answer}
                </span>
                {c.support.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-sm text-muted">
                    {c.support.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                )}
                <span className="mt-auto flex items-center gap-1 pt-4 text-sm font-semibold text-accent-ink">
                  {c.cta}
                  <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">
                    →
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section id="things-to-watch" aria-labelledby="ttw" className="scroll-mt-40">
        <h2 id="ttw" className="text-[22px] tracking-tight">
          Things to watch
        </h2>
        {watch.length > 0 && (
          <ul className="mt-3">
            {watch.map((w) => (
              <li key={w.text}>
                <Link href={w.href} className="row-link -mx-3 flex items-baseline gap-2.5 rounded-xl px-3 py-3">
                  <Arrow tone={w.tone} />
                  <span className="font-semibold">{w.text}</span>
                  {w.sub && <span className="text-sm text-muted">{w.sub}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {eventsSlot && (
          <div id="company-events" className="mt-8 scroll-mt-40">
            {eventsSlot}
          </div>
        )}
      </section>

      <p className="text-[13px] text-muted">
        Every answer is computed in code from the data in the other tabs. <Term k="quick_take">How this works</Term>. Not investment advice.
      </p>
    </div>
  );
}
