import { Suspense } from "react";
import Link from "next/link";
import AnalyzePanel from "@/components/AnalyzePanel";
import CompanyTabs from "@/components/CompanyTabs";
import { resolveTab } from "@/lib/tabs";
import StreetView, { type EstimateRow } from "@/components/StreetView";
import type { FieldRow } from "@/components/ValuationCharts";
import FinancialsView from "@/components/FinancialsView";
import PriceChart from "@/components/PriceChart";
import { getCompanyByTicker, getFilings, getFinancials, getLatestJob, getPrices, getTicker } from "@/lib/company";
import { CALLS_VERSION, analyzedCalls, getAnalysis, getComparison, getEvents, getLatestCallsJob, getToneTrend, parseQ, qLabel } from "@/lib/calls";
import CallsPanel from "@/components/CallsPanel";
import CallView from "@/components/CallView";
import { compact, filingIndexFromDocUrl, GENERAL_GROUPS, PACK_GROUPS } from "@/lib/metrics";
import type { Company, Filing, PricePoint } from "@/lib/types";
import BriefView from "@/components/BriefView";
import PeersView from "@/components/PeersView";
import TrendsView, { type TrendRow } from "@/components/TrendsView";
import SegmentsView, { type SegmentRow } from "@/components/SegmentsView";
import DataInfo from "@/components/DataInfo";
import type { RiskYear } from "@/components/RiskTrend";
import { getDcf } from "@/lib/dcf";
import { getLatestPeersJob, getPeerComparison, getPeerSet } from "@/lib/peers";
import { buildExtras } from "@/lib/brief-extras";
import { figureText, releaseFigure, type StreetRow } from "@/lib/figures";
import FilingsView from "@/components/FilingsView";
import { briefPairs, getBrief, getCases, getDodges, getLatestBriefJob, getRiskChanges, getTakes, type Brief } from "@/lib/filings";
import { select, selectAll } from "@/lib/db";
import OwnershipView from "@/components/OwnershipView";
import RiskView from "@/components/RiskView";
import OptionsView from "@/components/OptionsView";
import { getOptions, getRisk } from "@/lib/riskopts";
import Overview from "@/components/Overview";
import ProGate from "@/components/ProGate";
import WatchButton from "@/components/WatchButton";
import Term, { AboutNumbers } from "@/components/Term";
import { COMPARE_ETFS, etfName } from "@/lib/etfs";
import { comparablePeerPe } from "@/lib/peer-check";
import { getHolders, getInsiderTrades, summarizeInsiders } from "@/lib/ownership";

export default function CompanyPage(props: PageProps<"/c/[ticker]">) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-6">
      <Suspense fallback={<CompanySkeleton />}>
        <CompanyContent {...props} />
      </Suspense>
    </main>
  );
}

const PACK_LABEL: Record<string, string> = { bank: "Bank", reit: "REIT", insurer: "Insurer", general: "General" };

async function CompanyContent({ params, searchParams }: PageProps<"/c/[ticker]">) {
  const ticker = decodeURIComponent((await params).ticker).toUpperCase();
  const sp = await searchParams;
  const { view } = resolveTab(typeof sp.tab === "string" ? sp.tab : null, typeof sp.view === "string" ? sp.view : null);

  const company = await getCompanyByTicker(ticker);
  if (!company) {
    const hit = await getTicker(ticker);
    if (!hit) {
      return (
        <div className="py-16 text-center">
          <h1 className="text-2xl font-semibold">{ticker} not found</h1>
          <p className="mt-2 text-muted">It isn&apos;t in the SEC&apos;s list of US-listed companies.</p>
          <Link href="/" className="mt-6 inline-block text-accent underline">
            Back to search
          </Link>
        </div>
      );
    }
    const job = await getLatestJob(ticker);
    return (
      <div className="max-w-xl py-10">
        <p className="text-sm text-muted">
          {hit.ticker} · {hit.exchange}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{hit.name}</h1>
        <p className="mt-4 text-muted">
          This company hasn&apos;t been loaded yet. Loading pulls 15 years of SEC filings and financials plus daily
          prices. It uses only free data — no AI budget.
        </p>
        <div className="mt-6">
          <AnalyzePanel ticker={ticker} initialJob={job} mode="load" />
        </div>
      </div>
    );
  }

  // chart comparison fund: the sector fund, except tech stocks compare with the Nasdaq-100 (QQQ)
  const chartFund = company.sector_etf === "XLK" ? "QQQ" : company.sector_etf;
  const sectorEtf = chartFund && chartFund !== company.ticker ? chartFund : null;
  const [prices, filings, job, events, spy, sectorPx, loaded] = await Promise.all([
    getPrices(company.ticker),
    getFilings(company.cik),
    getLatestJob(company.ticker),
    getEvents(company.cik),
    company.ticker === "SPY" ? Promise.resolve([]) : getPrices("SPY"),
    sectorEtf ? getPrices(sectorEtf) : Promise.resolve([]),
    select<{ ticker: string; name: string }>("companies", { select: "ticker,name", order: "ticker" }),
  ]);
  const compareDefaults = [
    ...(spy.length ? [{ ticker: "SPY", label: "S&P 500", prices: spy.map((p) => ({ date: p.date, adj_close: p.adj_close })) }] : []),
    ...(sectorEtf && sectorPx.length
      ? [{ ticker: sectorEtf, label: etfName(sectorEtf) ?? sectorEtf, prices: sectorPx.map((p) => ({ date: p.date, adj_close: p.adj_close })) }]
      : []),
  ];
  const fundTickers = new Set(COMPARE_ETFS.map((e) => e.ticker));
  const compareChoices = [
    ...COMPARE_ETFS.map((e) => ({ ticker: e.ticker, name: e.name, kind: "fund" as const })),
    ...loaded.filter((c) => !fundTickers.has(c.ticker)).map((c) => ({ ticker: c.ticker, name: c.name, kind: "stock" as const })),
  ];
  // Earnings-report dots (tap → that quarter's call vs. the same quarter a year earlier).
  // Until report dates are loaded (first call comparison), fall back to filing dates.
  const markers = events.length
    ? events.map((e) => ({
        date: e.report_date,
        label: `Earnings ${qLabel(e.fiscal_year, e.fiscal_quarter)}`,
        href: `/c/${company.ticker}?tab=call&a=${qLabel(e.fiscal_year - 1, e.fiscal_quarter)}&b=${qLabel(e.fiscal_year, e.fiscal_quarter)}`,
      }))
    : filings.filter((f) => ["10-K", "10-Q", "20-F", "40-F"].includes(f.form)).map((f) => ({ date: f.filed_date, label: f.form }));

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            {company.ticker} · {company.exchange ?? "US"} · {PACK_LABEL[company.sector_pack]} metrics · vs {company.sector_etf}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{company.name}</h1>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <WatchButton ticker={company.ticker} />
          <Link
            href={`/compare?a=${encodeURIComponent(company.ticker)}`}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-card"
          >
            Compare
          </Link>
          <AnalyzePanel ticker={company.ticker} initialJob={job?.status === "running" || job?.status === "queued" ? job : null} mode="refresh" />
        </div>
      </header>
      <Suspense fallback={null}>
        <DataInfo company={company} priceDate={prices.at(-1)?.date ?? company.valuation?.price_date ?? null} filings={filings} />
      </Suspense>
      {company.history_note && <p className="mt-3 text-sm text-muted">ⓘ {company.history_note}</p>}
      {company.sector_note && (
        <p className="mt-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
          <b>Sector check:</b> {company.sector_note}. Using general metrics for now — tell Claude if a sector pack should apply.
        </p>
      )}

      <div className="mt-6">
        <PriceChart
          ticker={company.ticker}
          prices={prices}
          defaults={compareDefaults}
          choices={compareChoices}
          markers={markers}
          currencySymbol="$"
          markerNote={events.length ? "○ = earnings report · tap to open that call" : "○ = 10-K / 10-Q filed"}
          emptyNote={
            job?.status === "deferred"
              ? "The price download was paused by the free price source's hourly limit (50 requests/hour). It retries automatically within 6 hours; per-share history is split-adjusted once prices arrive."
              : undefined
          }
        />
      </div>

      <ValuationStrip company={company} />

      <div className="mt-6">
        <CompanyTabs />
      </div>

      <div className="mt-6">
        <Suspense key={`${view}-${sp.a ?? ""}-${sp.b ?? ""}`} fallback={<TabSkeleton />}>
        {view === "overview" && (
          <Overview company={company} events={events} asOf={prices.at(-1)?.date ?? company.valuation?.price_date ?? "2026-01-01"} />
        )}
        {view === "historical" && <FinancialsTab company={company} filings={filings} />}
        {view === "street" && <StreetTab company={company} events={events} prices={prices} />}
        {view === "sources" && <SourcesTab company={company} filings={filings} />}
        {view === "brief" && (
          <BriefTab company={company} events={events} a={typeof sp.a === "string" ? sp.a : undefined} b={typeof sp.b === "string" ? sp.b : undefined} />
        )}
        {view === "call" && <CallTab company={company} events={events} a={typeof sp.a === "string" ? sp.a : undefined} b={typeof sp.b === "string" ? sp.b : undefined} />}
        {view === "filings" && (
          <ProGate what="Filings detail (adjusted numbers, MD&A, risk-factor redline)">
            <BriefTab company={company} events={events} a={typeof sp.a === "string" ? sp.a : undefined} b={typeof sp.b === "string" ? sp.b : undefined} mode="filings" />
          </ProGate>
        )}
        {view === "peers" && <PeersTab company={company} prices={prices} />}
        {view === "riskstats" && <RiskTab company={company} />}
        {view === "options" && (
          <ProGate what="Options data">
            <OptionsTab company={company} />
          </ProGate>
        )}
        {view === "ownership" && <OwnershipTab company={company} asOf={prices.at(-1)?.date ?? company.valuation?.price_date ?? "2026-01-01"} />}
        </Suspense>
      </div>
      <p className="mt-12 border-t border-border pt-4 text-xs text-muted">
        Every number links to where it came from.{" "}
        <Link href={`/c/${encodeURIComponent(company.ticker)}?tab=sources`} className="font-medium text-foreground hover:underline">
          All sources for {company.ticker} →
        </Link>
      </p>
    </>
  );
}


async function RiskTab({ company }: { company: Company }) {
  const r = await getRisk(company.cik);
  if (!r) return <Pending what="Stats & risk" />;
  return <RiskView ticker={company.ticker} r={r} sector={company.sector_etf} />;
}

async function OptionsTab({ company }: { company: Company }) {
  const [o, r] = await Promise.all([getOptions(company.cik), getRisk(company.cik)]);
  if (!o) return <Pending what="Options data" note="Stocks without listed options have nothing to show here." />;
  return <OptionsView ticker={company.ticker} o={o.result} asOf={o.as_of} avgEarningsMove={r?.avg_earnings_move ?? null} />;
}

function Pending({ what, note }: { what: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted">
      {what} for this stock will appear after the next morning refresh (it&apos;s computed daily for every loaded stock). {note}
    </div>
  );
}

async function OwnershipTab({ company, asOf }: { company: Company; asOf: string }) {
  const since = `${Number(asOf.slice(0, 4)) - 2}${asOf.slice(4)}`;
  const [trades, holders] = await Promise.all([getInsiderTrades(company.cik, since), getHolders(company.cik)]);
  return <OwnershipView ticker={company.ticker} trades={trades} summary={summarizeInsiders(trades, asOf)} holders={holders} asOf={asOf} />;
}

async function CallTab({
  company,
  events,
  a,
  b,
}: {
  company: Company;
  events: Awaited<ReturnType<typeof getEvents>>;
  a?: string;
  b?: string;
}) {
  const done = await analyzedCalls(company.cik);
  const { ea, eb, la, lb, options } = quarterChoice(events, a, b, done.quarters);

  const [comparison, job, trend] = await Promise.all([
    getComparison(company.cik, la, lb),
    getLatestCallsJob(company.ticker, la, lb),
    getToneTrend(company.cik),
  ]);
  const [anA, anB] = comparison
    ? await Promise.all([getAnalysis(company.cik, ea[0], ea[1]), getAnalysis(company.cik, eb[0], eb[1])])
    : [null, null];
  const activeJob = job && ["queued", "running", "failed", "deferred"].includes(job.status) ? job : null;

  return (
    <div className="space-y-8">
      <CallsPanel ticker={company.ticker} options={options} a={la} b={lb} initialJob={activeJob} hasResult={Boolean(comparison)} ready={done.pairs} />
      {comparison && anA && anB ? (
        <CallView cik={company.cik} comparison={comparison} a={anA} b={anB} trend={trend} />
      ) : (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted">
          Pick two quarters and press <b className="text-foreground">Analyze calls</b>. Transcripts are fetched once and stored; each new
          quarter costs about half a cent of AI budget.
        </div>
      )}
    </div>
  );
}

function quarterChoice(events: Awaited<ReturnType<typeof getEvents>>, a?: string, b?: string, analyzed: string[] = []) {
  // Quarter choices: reported quarters (once report dates are loaded), else the last 12 fiscal quarters.
  const quarters: [number, number][] = events.length
    ? [...events]
        .sort((x, y) => y.report_date.localeCompare(x.report_date)) // newest first, whatever the row order
        .slice(0, 24)
        .map((e) => [e.fiscal_year, e.fiscal_quarter])
    : fallbackQuarters();
  const latest = quarters[0];
  const pb = parseQ(b) ?? latest;
  const pa = parseQ(a) ?? [pb[0] - 1, pb[1]];
  const [ea, eb] = [pa, pb].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const la = qLabel(ea[0], ea[1]);
  const lb = qLabel(eb[0], eb[1]);
  const options = [...new Set([...quarters.map(([y, q]) => qLabel(y, q)), la, lb])]
    .sort()
    .reverse()
    .map((v) => {
      const ev = events.find((e) => qLabel(e.fiscal_year, e.fiscal_quarter) === v);
      const mark = analyzed.includes(v) ? " ✓ analyzed" : "";
      return { value: v, label: `${v.replace("FY", "FY ").replace("Q", " · Q")}${ev ? ` (reported ${ev.report_date})` : ""}${mark}` };
    });

  return { ea, eb, la, lb, options };
}

type Events = Awaited<ReturnType<typeof getEvents>>;

const usd = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `$${v.toFixed(2)}`);
const big = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`;

async function BriefTab({ company, events, a, b, mode = "brief" }: { company: Company; events: Events; a?: string; b?: string; mode?: "brief" | "filings" }) {
  const ready = await briefPairs(company.cik);
  const { ea, eb, la, lb, options } = quarterChoice(events, a, b);
  const [brief, job] = await Promise.all([getBrief(company.cik, la, lb), getLatestBriefJob(company.ticker, la, lb)]);
  const activeJob = job && ["queued", "running", "failed", "deferred"].includes(job.status) ? job : null;
  const panel = (
    <CallsPanel
      ticker={company.ticker}
      options={options}
      a={la}
      b={lb}
      initialJob={activeJob}
      hasResult={Boolean(brief)}
      endpoint="/api/brief"
      tab={mode}
      cta={mode === "brief" ? "Write brief" : "Analyze filings"}
      hint="Reads the 10-K/10-Q, earnings releases and call for both quarters. About $0.05 of AI budget the first time; cached after that."
      doneStep="brief"
      ready={ready}
    />
  );
  if (!brief) {
    return (
      <div className="space-y-8">
        {panel}
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted">
          Pick two quarters and press <b className="text-foreground">{mode === "brief" ? "Write brief" : "Analyze filings"}</b>. The same run fills both
          the Brief and Filings tabs. Comparing the same quarter a year apart shows risk-factor changes too.
        </div>
      </div>
    );
  }
  if (mode === "filings") {
    const [risks, riskHist] = await Promise.all([
      brief.inputs.risk ? getRiskChanges(company.cik, brief.inputs.risk.accession_new, brief.inputs.risk.accession_old) : Promise.resolve([]),
      select<{ summary: { counts: Record<string, number>; escalated: number; factors_new: number; words_new: number; report_new: string } }>("risk_comparisons", {
        cik: `eq.${company.cik}`,
        select: "summary",
      }),
    ]);
    const byYear = new Map<string, RiskYear>();
    for (const r of riskHist) {
      const y = String(r.summary.report_new ?? "").slice(0, 4);
      if (!y) continue;
      byYear.set(y, { year: y, factors: r.summary.factors_new, added: r.summary.counts.added ?? 0, removed: r.summary.counts.removed ?? 0, escalated: r.summary.escalated, words: r.summary.words_new });
    }
    const riskYears = [...byYear.values()].sort((a, b) => a.year.localeCompare(b.year));
    return (
      <div className="space-y-8">
        {panel}
        <FilingsView inputs={brief.inputs} risks={risks} la={la} lb={lb} riskYears={riskYears} />
      </div>
    );
  }
  const [street, comparison, kpis] = await Promise.all([
    streetRows(company, events, brief, ea, eb, la, lb),
    getComparison(company.cik, la, lb),
    select<{ metric: string; fiscal_year: number; fiscal_period: string; value: number }>("metric_values", {
      cik: `eq.${company.cik}`,
      metric: "in.(revenue,operating_margin)",
      fiscal_period: `in.(Q${ea[1]},Q${eb[1]})`,
      fiscal_year: `in.(${ea[0]},${eb[0]})`,
      select: "metric,fiscal_year,fiscal_period,value",
    }),
  ]);
  const [takes, dodges, peerCmp, cases] = await Promise.all([
    getTakes(company.cik, la, lb),
    getDodges(company.cik, eb[0], eb[1], CALLS_VERSION),
    getPeerComparison(company.cik),
    getCases(company.cik),
  ]);
  const v = company.valuation;
  const valuation =
    v?.price && v?.eps_ntm && v.eps_ntm > 0
      ? { price: v.price, epsNtm: v.eps_ntm, peerMedianPe: comparablePeerPe(peerCmp?.result.medians.pe_fwd_ntm, null, v.pe_fwd_ntm, company.ticker).pe }
      : null;
  const kv = (m: string, q: [number, number]) => kpis.find((r) => r.metric === m && r.fiscal_year === q[0] && r.fiscal_period === `Q${q[1]}`)?.value;
  const extras = buildExtras({
    brief,
    events,
    comparison,
    la,
    lb,
    revenue: { a: kv("revenue", ea), b: kv("revenue", eb) },
    margin: { a: kv("operating_margin", ea), b: kv("operating_margin", eb) },
  });
  return (
    <div className="space-y-8">
      {panel}
      <BriefView brief={brief} street={street} extras={extras} la={la} lb={lb} more={{ cik: company.cik, ticker: company.ticker, valuation, dodges, takes, cases }} />
    </div>
  );
}

async function streetRows(company: Company, events: Events, brief: Brief, ea: [number, number], eb: [number, number], la: string, lb: string): Promise<StreetRow[]> {
  const ev = (q: [number, number]) => events.find((e) => e.fiscal_year === q[0] && e.fiscal_quarter === q[1]);
  const factId = (pred: (t: string, q?: string | null) => boolean) => Object.entries(brief.inputs.facts).find(([, f]) => pred(f.text, f.quote))?.[0];
  const rows: StreetRow[] = [];
  const [evA, evB] = [ev(ea), ev(eb)];
  if (evB?.eps_reported !== null && evB?.eps_reported !== undefined) {
    const beat = evB.eps_estimated !== null && evB.eps_estimated !== undefined ? evB.eps_reported - evB.eps_estimated : null;
    rows.push({
      label: "Street EPS (vs. consensus)",
      note: beat === null ? "Adjusted EPS as tracked by analysts" : `${lb}: ${beat >= 0 ? "beat" : "missed"} consensus ${usd(evB.eps_estimated)} by ${usd(Math.abs(beat))}`,
      a: evA?.eps_reported !== null && evA?.eps_reported !== undefined ? `${usd(evA.eps_reported)} vs ${usd(evA.eps_estimated)}` : "—",
      b: `${usd(evB.eps_reported)} vs ${usd(evB.eps_estimated)}`,
      tone: beat === null ? null : beat >= 0 ? "up" : "down",
      ref: factId((t) => t.startsWith(`${lb} Street EPS`)),
    });
  }
  const relB = brief.inputs.results[lb]?.release;
  const relA = brief.inputs.results[la]?.release;
  for (const [kind, label] of [
    ["eps_adjusted", "Company adjusted EPS"],
    ["eps_gaap", "GAAP diluted EPS"],
    ["revenue", "Revenue"],
    ["operating_margin_adjusted", "Adjusted operating margin"],
    ["ebitda_adjusted", "Company adjusted EBITDA"],
    ["free_cash_flow", "Free cash flow (company)"],
  ] as const) {
    const fB = releaseFigure(relB, kind);
    const fA = releaseFigure(relA, kind);
    if (!fB && !fA) continue;
    rows.push({
      label,
      note: fB?.label && fB.label !== label ? `“${fB.label}” in the release` : undefined,
      a: fA ? figureText(fA) : fB ? figureText(fB, "prior") : "—",
      b: figureText(fB),
      tone: fB && (fA || fB.prior !== null) ? (fB.current >= (fA ? fA.current : (fB.prior as number)) ? "up" : "down") : null,
      ref: fB ? factId((_t, q) => q === fB.quote) : undefined,
    });
  }
  const mv = await select<{ metric: string; fiscal_year: number; fiscal_period: string; value: number; derivation: string | null }>("metric_values", {
    cik: `eq.${company.cik}`,
    metric: "in.(adj_eps_std,adj_ebitda_std)",
    fiscal_period: `in.(Q${ea[1]},Q${eb[1]})`,
    fiscal_year: `in.(${ea[0]},${eb[0]})`,
    select: "metric,fiscal_year,fiscal_period,value,derivation",
  });
  const get = (m: string, q: [number, number]) => mv.find((r) => r.metric === m && r.fiscal_year === q[0] && r.fiscal_period === `Q${q[1]}`);
  for (const [m, label, fmt] of [
    ["adj_eps_std", "Adjusted EPS — computed by this app", usd],
    ["adj_ebitda_std", "Adjusted EBITDA — computed by this app", big],
  ] as const) {
    const [va, vb] = [get(m, ea), get(m, eb)];
    if (!va && !vb) continue;
    rows.push({
      label,
      note: (vb ?? va)?.derivation?.replace("Computed by this app: ", "") ?? undefined,
      a: fmt(va?.value),
      b: fmt(vb?.value),
      tone: va && vb ? (vb.value >= va.value ? "up" : "down") : null,
    });
  }
  const v = company.valuation;
  if (v?.pe_fwd_ntm) rows.push({ label: "Forward P/E (next 12 months)", note: v.eps_ntm_method ?? undefined, a: "", b: `${v.pe_fwd_ntm.toFixed(1)}x` });
  if (v?.pe_adj_ltm) rows.push({ label: "Adjusted P/E (last 12 months)", a: "", b: `${v.pe_adj_ltm.toFixed(1)}x` });
  return rows;
}

async function PeersTab({ company, prices }: { company: Company; prices: PricePoint[] }) {
  const [peerSet, comparison, job] = await Promise.all([getPeerSet(company.cik), getPeerComparison(company.cik), getLatestPeersJob(company.ticker)]);
  // 1-year performance, rebased to 100, sampled weekly
  const tickers = [company.ticker, ...(comparison?.result.rows.map((r) => r.ticker).filter((t) => t !== company.ticker) ?? [])];
  const lastDate = prices.length ? prices[prices.length - 1].date : null;
  let perf: { ticker: string; points: [string, number][] }[] = [];
  if (lastDate && tickers.length > 1) {
    const since = `${Number(lastDate.slice(0, 4)) - 1}${lastDate.slice(4)}`;
    const rows = await selectAll<{ ticker: string; date: string; adj_close: number }>("prices", {
      ticker: `in.(${tickers.join(",")})`,
      date: `gte.${since}`,
      select: "ticker,date,adj_close",
      order: "date",
    });
    perf = tickers
      .map((t) => {
        const pts = rows.filter((r) => r.ticker === t && r.adj_close);
        if (pts.length < 100) return null;
        const base = pts[0].adj_close;
        const sampled = pts.filter((_, i) => i % 5 === 0 || i === pts.length - 1);
        return { ticker: t, points: sampled.map((r) => [r.date, Number(((r.adj_close / base) * 100).toFixed(2))] as [string, number]) };
      })
      .filter((x): x is { ticker: string; points: [string, number][] } => x !== null);
  }
  return <PeersView ticker={company.ticker} peerSet={peerSet} comparison={comparison} initialJob={job} perf={perf} />;
}

function fallbackQuarters(): [number, number][] {
  const now = new Date();
  let y = now.getFullYear();
  let q = Math.floor(now.getMonth() / 3) + 1;
  const out: [number, number][] = [];
  for (let i = 0; i < 12; i++) {
    q -= 1;
    if (q === 0) {
      q = 4;
      y -= 1;
    }
    out.push([y, q]);
  }
  return out;
}

async function StreetTab({ company, events, prices }: { company: Company; events: Events; prices: PricePoint[] }) {
  const v = company.valuation;
  const lastReported = [...events].filter((e) => e.eps_reported != null).sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
  const [estimates, cases, dcf, peers] = await Promise.all([
    select<EstimateRow>("eps_estimates", {
      cik: `eq.${company.cik}`,
      period_end: `gt.${lastReported?.period_end ?? "1900-01-01"}`,
      select: "horizon,period_end,eps_low,eps_avg,eps_high,revenue_avg,analysts",
      order: "period_end",
      limit: "12",
    }),
    getCases(company.cik),
    getDcf(company.cik),
    getPeerComparison(company.cik),
  ]);
  const lb = lastReported ? `FY${lastReported.fiscal_year}Q${lastReported.fiscal_quarter}` : null;
  const reactRows = await select<{ label: string; event_date: string; value: number; reaction: number | null }>("backtest_events", {
    cik: `eq.${company.cik}`,
    signal: "eq.eps_surprise",
    select: "label,event_date,value,reaction",
    order: "event_date.desc",
    limit: "12",
  });
  const reactions = reactRows
    .filter((r) => r.reaction != null)
    .reverse()
    .map((r) => ({ label: r.label, date: r.event_date, surprise: r.value, reaction: r.reaction as number }));
  // weekly consensus snapshots for the next quarter and next fiscal year
  const hist = await select<{ snapshot_date: string; horizon: string; period_end: string; eps_avg: number | null }>("eps_estimate_history", {
    cik: `eq.${company.cik}`,
    period_end: `gt.${lastReported?.period_end ?? "1900-01-01"}`,
    select: "snapshot_date,horizon,period_end,eps_avg",
    order: "snapshot_date",
    limit: "2000",
  });
  const nextOf = (h: string) => estimates.find((e) => e.horizon === h)?.period_end;
  const revisions = (["fiscal quarter", "fiscal year"] as const)
    .map((h) => {
      const pe = nextOf(h);
      return {
        name: `${h === "fiscal year" ? "Full year" : "Quarter"} ending ${pe}`,
        points: hist.filter((x) => x.horizon === h && x.period_end === pe && x.eps_avg != null).map((x) => ({ date: x.snapshot_date, value: x.eps_avg as number })),
      };
    })
    .filter((l) => l.points.length);
  // football field
  const field: FieldRow[] = [];
  const price = v?.price ?? null;
  const lastDate = prices.length ? prices[prices.length - 1].date : "";
  const yearAgo = lastDate ? `${Number(lastDate.slice(0, 4)) - 1}${lastDate.slice(4)}` : "";
  const lastYear = prices.filter((p) => p.date >= yearAgo).map((p) => p.close);
  if (lastYear.length > 100) field.push({ label: "52-week trading range", sub: "Low to high close", lo: Math.min(...lastYear), hi: Math.max(...lastYear) });
  const nb = cases?.numbers;
  const eps = nb?.eps;
  if (eps?.eps_low && eps.eps_high && v?.pe_fwd_ntm)
    field.push({ label: "Analyst EPS range", sub: `Low–high estimate × today's ${v.pe_fwd_ntm.toFixed(1)}x`, lo: eps.eps_low * v.pe_fwd_ntm, hi: eps.eps_high * v.pe_fwd_ntm, mid: price });
  if (nb?.pe && eps?.eps_avg)
    field.push({ label: "Own forward P/E range", sub: `${nb.pe.p20.toFixed(1)}x–${nb.pe.p80.toFixed(1)}x × consensus EPS`, lo: nb.pe.p20 * eps.eps_avg, hi: nb.pe.p80 * eps.eps_avg, mid: nb.pe.p50 * eps.eps_avg });
  const peerCheck = comparablePeerPe(peers?.result.medians.pe_fwd_ntm, nb?.pe?.p50, v?.pe_fwd_ntm, company.ticker);
  const peerPe = peerCheck.pe;
  if (peerPe && eps?.eps_low && eps.eps_high)
    field.push({ label: "Peer median multiple", sub: `${peerPe.toFixed(1)}x × low–high EPS`, lo: eps.eps_low * peerPe, hi: eps.eps_high * peerPe, mid: eps.eps_avg ? eps.eps_avg * peerPe : null });
  const sc = nb?.scenarios;
  if (sc?.bear && sc.bull) field.push({ label: "Bear · base · bull", sub: "Scenario values", lo: sc.bear.value, hi: sc.bull.value, mid: sc.base?.value ?? null });
  const grid = dcf?.result?.sensitivity.values.flat().filter((x): x is number => x != null && x > 0) ?? [];
  if (dcf?.status === "ok" && dcf.result?.per_share && grid.length)
    field.push({ label: "DCF (10-year)", sub: "Sensitivity range, tick = base", lo: Math.min(...grid), hi: Math.max(...grid), mid: dcf.result.per_share });
  const analysis = lastReported ? await getAnalysis(company.cik, lastReported.fiscal_year, lastReported.fiscal_quarter) : null;
  const streak = [...events]
    .filter((e) => e.eps_reported != null && e.eps_estimated != null && e.eps_estimated !== 0)
    .sort((a, b) => b.period_end.localeCompare(a.period_end))
    .slice(0, 8)
    .reverse()
    .map((e) => ({
      label: `FY${e.fiscal_year}Q${e.fiscal_quarter}`,
      reported: e.eps_reported as number,
      estimated: e.eps_estimated as number,
      surprisePct: ((e.eps_reported as number) / (e.eps_estimated as number) - 1) * 100,
    }));
  return (
    <StreetView
      d={{
        ticker: company.ticker,
        price: v?.price ?? null,
        priceDate: v?.price_date ?? null,
        epsNtm: v?.eps_ntm ?? null,
        epsNtmMethod: v?.eps_ntm_method ?? null,
        peFwd: v?.pe_fwd_ntm ?? null,
        peAdjLtm: v?.pe_adj_ltm ?? null,
        adjEpsLtm: v?.adj_eps_ltm ?? null,
        peerMedianPe: peerPe ?? null,
        peerNote: peerCheck.note,
        estimates,
        streak,
        guidance: analysis?.extraction?.guidance?.length && lb ? { label: lb, items: analysis.extraction.guidance } : null,
        cases,
        dcf,
        field,
        revisions,
        firstSnapshot: hist[0]?.snapshot_date ?? null,
        reactions,
      }}
    />
  );
}

async function FinancialsTab({ company, filings }: { company: Company; filings: Filing[] }) {
  const [data, trends, dcf, segments] = await Promise.all([
    getFinancials(company, filings),
    select<TrendRow>("metric_values", {
      cik: `eq.${company.cik}`,
      fiscal_period: "eq.FY",
      metric: "in.(gross_margin,operating_margin,fcf_margin,diluted_shares,roic,revenue,eps_diluted)",
      select: "fiscal_year,metric,value",
      order: "fiscal_year",
      limit: "400",
    }),
    getDcf(company.cik),
    selectAll<SegmentRow>("segment_values", {
      cik: `eq.${company.cik}`,
      select: "axis,measure,member,label,fiscal_year,fiscal_period,value,source,adds_up",
    }).catch(() => [] as SegmentRow[]),
  ]);
  const groups = [...GENERAL_GROUPS, ...(company.sector_pack !== "general" ? [PACK_GROUPS[company.sector_pack]] : [])];
  return (
    <div className="space-y-12">
      <TrendsView rows={trends} wacc={dcf?.status === "ok" ? (dcf.assumptions.wacc?.value ?? null) : null} />
      <SegmentsView
        rows={segments.filter((r) => !(company.quality ?? []).some((f) => f.severity === "hide" && f.fields.includes(`segments:${r.axis}`)))}
      />
      <FinancialsView data={data} groups={groups} />
    </div>
  );
}

function ValuationStrip({ company }: { company: Company }) {
  const v = company.valuation;
  if (!v) return null;
  if (v.note) return <p className="mt-6 rounded-xl bg-card px-4 py-3 text-sm text-muted">{v.note}</p>;
  const x1 = (n: number | null | undefined) => (n != null ? `${n.toFixed(1)}×` : null);
  const dy = v.dividend_yield != null ? (v.dividend_yield > 0 ? `${(v.dividend_yield * 100).toFixed(2)}%` : "None") : null;
  // four numbers everyone needs; the rest one tap away
  const key: [string, string | null, string][] = [
    ["Market cap", v.market_cap != null ? `$${compact(v.market_cap)}` : null, "market_cap"],
    ["P/E (TTM)", x1(v.pe), "pe"],
    v.pe_fwd_ntm != null ? ["Fwd P/E", x1(v.pe_fwd_ntm), "pe_fwd_ntm"] : ["FCF yield", v.fcf_yield != null ? `${(v.fcf_yield * 100).toFixed(1)}%` : null, "fcf_yield"],
    ["Dividend yield", dy, "dividend_yield"],
  ];
  const more: [string, string | null, string, string?][] = [["Enterprise value", v.enterprise_value != null ? `$${compact(v.enterprise_value)}` : null, "enterprise_value"]];
  if (company.sector_pack === "bank") more.push(["P/TBV", v.p_tbv != null ? `${v.p_tbv.toFixed(2)}×` : null, "p_tbv"]);
  else if (company.sector_pack === "insurer") more.push(["P/B", v.p_b != null ? `${v.p_b.toFixed(2)}×` : null, "p_b"]);
  else {
    more.push(["EV/EBITDA (TTM)", x1(v.ev_ebitda), "ev_ebitda"]);
    more.push(["EV/Revenue (TTM)", v.ev_revenue != null ? `${v.ev_revenue.toFixed(2)}×` : null, "ev_revenue"]);
  }
  if (v.pe_fwd_ntm != null) more.push(["FCF yield (TTM)", v.fcf_yield != null ? `${(v.fcf_yield * 100).toFixed(1)}%` : null, "fcf_yield"]);
  if (v.shareholder_yield != null) more.push(["Shareholder yield", `${(v.shareholder_yield * 100).toFixed(1)}%`, "shareholder_yield", "dividends + buybacks"]);
  if (v.street_source) {
    more.push(["Adj. P/E (LTM)", x1(v.pe_adj_ltm), "pe_adj_ltm", v.adj_eps_ltm != null ? `EPS $${v.adj_eps_ltm.toFixed(2)}, last 4 quarters` : "needs 4 reported quarters"]);
    more.push(["Adj. P/E (run-rate)", x1(v.pe_adj_run_rate), "pe_adj_run_rate", v.adj_eps_run_rate != null ? `${v.adj_eps_run_rate_quarter} EPS × 4` : ""]);
  }
  const Tile = ({ label, val, k, sub }: { label: string; val: string | null; k: string; sub?: string }) => (
    <div>
      <dt className="flex items-center text-xs text-muted">
        <Term k={k} value={val}>{label}</Term>
      </dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${val ? "" : "text-muted"}`}>{val ?? "—"}</dd>
      {sub && <dd className="text-xs text-muted">{sub}</dd>}
    </div>
  );
  return (
    <section className="mt-6" aria-label="Key numbers">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        {key.map(([label, val, k]) => (
          <Tile key={label} label={label} val={val} k={k} />
        ))}
      </dl>
      <details className="group mt-3">
        <summary className="cursor-pointer list-none text-sm font-medium text-muted hover:text-foreground">
          <span className="group-open:hidden">More valuation numbers ▾</span>
          <span className="hidden group-open:inline">Fewer ▴</span>
        </summary>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-3 sm:grid-cols-4">
          {more.map(([label, val, k, sub]) => (
            <Tile key={label} label={label} val={val} k={k} sub={sub} />
          ))}
        </dl>
        <div className="mt-2">
          <AboutNumbers
            title="About these valuation numbers"
            keys={["market_cap", "enterprise_value", "pe", "ev_ebitda", "ev_revenue", "fcf_yield", "dividend_yield", "shareholder_yield", "p_tbv", "p_b", "pe_adj_ltm", "pe_adj_run_rate", "pe_fwd_ntm"]}
          />
        </div>
      </details>
    </section>
  );
}

function SourcesTab({ company, filings }: { company: Company; filings: Filing[] }) {
  const main = filings.filter((f) => !["8-K", "6-K"].includes(f.form));
  return (
    <section>
      <h2 className="text-lg font-semibold">Documents used</h2>
      <p className="mt-1 text-sm text-muted">
        Financials come from SEC XBRL data (company facts API) for CIK {company.cik}; each value links to its filing. Prices from
        Tiingo. {filings.length} filings on record since {filings.at(-1)?.filed_date.slice(0, 4)}.
      </p>
      <ul className="mt-4 divide-y divide-border rounded-2xl border border-border">
        {main.map((f) => (
          <li key={f.accession} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
            <span className="w-14 font-semibold">{f.form}</span>
            <span className="text-muted">filed {f.filed_date}</span>
            {f.report_date && <span className="text-muted">period {f.report_date}</span>}
            <span className="ml-auto flex gap-3">
              <a href={f.url} target="_blank" rel="noreferrer" className="text-accent underline">
                Document ↗
              </a>
              <a href={filingIndexFromDocUrl(f.url, f.accession)} target="_blank" rel="noreferrer" className="text-muted underline">
                Index
              </a>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}


function TabSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-6">
      <div className="skeleton h-7 w-2/3" />
      <div className="skeleton h-4 w-full" />
      <div className="skeleton h-4 w-5/6" />
      <div className="grid grid-cols-2 gap-6 border-y border-border py-5 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="skeleton h-3 w-20" />
            <div className="skeleton h-7 w-24" />
          </div>
        ))}
      </div>
      <div className="skeleton h-40 w-full" />
    </div>
  );
}

function CompanySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading company">
      <div className="skeleton h-4 w-48" />
      <div className="skeleton mt-3 h-8 w-72" />
      <div className="skeleton mt-8 h-10 w-40" />
      <div className="skeleton mt-4 h-64 w-full sm:h-80" />
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-12" />
        ))}
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-44" />
        ))}
      </div>
    </div>
  );
}
