import { Suspense } from "react";
import Link from "next/link";
import AnalyzePanel from "@/components/AnalyzePanel";
import CompanyTabs from "@/components/CompanyTabs";
import { normalizeTab } from "@/lib/tabs";
import StreetView, { type EstimateRow } from "@/components/StreetView";
import FinancialsView from "@/components/FinancialsView";
import PriceChart from "@/components/PriceChart";
import { getCompanyByTicker, getFilings, getFinancials, getLatestJob, getPrices, getTicker } from "@/lib/company";
import { CALLS_VERSION, getAnalysis, getComparison, getEvents, getLatestCallsJob, getToneTrend, parseQ, qLabel } from "@/lib/calls";
import CallsPanel from "@/components/CallsPanel";
import CallView from "@/components/CallView";
import { compact, filingIndexFromDocUrl, GENERAL_GROUPS, PACK_GROUPS } from "@/lib/metrics";
import type { Company, Filing } from "@/lib/types";
import BriefView from "@/components/BriefView";
import PeersView from "@/components/PeersView";
import { getDcf } from "@/lib/dcf";
import { getLatestPeersJob, getPeerComparison, getPeerSet } from "@/lib/peers";
import { buildExtras } from "@/lib/brief-extras";
import { figureText, releaseFigure, type StreetRow } from "@/lib/figures";
import FilingsView from "@/components/FilingsView";
import { getBrief, getCases, getDodges, getLatestBriefJob, getRiskChanges, getTakes, type Brief } from "@/lib/filings";
import { select } from "@/lib/db";

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
const SYMBOL: Record<string, string> = { USD: "$", TWD: "NT$", EUR: "€", GBP: "£", JPY: "¥" };

async function CompanyContent({ params, searchParams }: PageProps<"/c/[ticker]">) {
  const ticker = decodeURIComponent((await params).ticker).toUpperCase();
  const sp = await searchParams;
  const tab = normalizeTab(typeof sp.tab === "string" ? sp.tab : null, "street");

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

  const [prices, filings, job, events] = await Promise.all([
    getPrices(company.ticker),
    getFilings(company.cik),
    getLatestJob(company.ticker),
    getEvents(company.cik),
  ]);
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
        <AnalyzePanel ticker={company.ticker} initialJob={job?.status === "running" || job?.status === "queued" ? job : null} mode="refresh" />
      </header>
      {company.history_note && <p className="mt-3 text-sm text-muted">ⓘ {company.history_note}</p>}
      {company.sector_note && (
        <p className="mt-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
          <b>Sector check:</b> {company.sector_note}. Using general metrics for now — tell Claude if a sector pack should apply.
        </p>
      )}

      <div className="mt-6">
        <PriceChart
          prices={prices}
          markers={markers}
          currencySymbol="$"
          markerNote={events.length ? "○ = earnings report · tap to open that call" : "○ = 10-K / 10-Q filed"}
          emptyNote={
            job?.status === "deferred"
              ? "The price download was paused by the free price source's hourly limit (50 requests/hour). It retries automatically within 3 hours; per-share history is split-adjusted once prices arrive."
              : undefined
          }
        />
      </div>

      <ValuationStrip company={company} />

      <div className="mt-6">
        <CompanyTabs defaultTab="street" />
      </div>
      <div className="mt-6">
        <Suspense key={`${tab}-${sp.a ?? ""}-${sp.b ?? ""}`} fallback={<TabSkeleton />}>
        {tab === "historical" && <FinancialsTab company={company} filings={filings} />}
        {tab === "street" && <StreetTab company={company} events={events} />}
        {tab === "sources" && <SourcesTab company={company} filings={filings} />}
        {tab === "brief" && <BriefTab company={company} events={events} a={typeof sp.a === "string" ? sp.a : undefined} b={typeof sp.b === "string" ? sp.b : undefined} />}
        {tab === "call" && <CallTab company={company} events={events} a={typeof sp.a === "string" ? sp.a : undefined} b={typeof sp.b === "string" ? sp.b : undefined} />}
        {tab === "filings" && <BriefTab company={company} events={events} a={typeof sp.a === "string" ? sp.a : undefined} b={typeof sp.b === "string" ? sp.b : undefined} mode="filings" />}
        {tab === "peers" && <PeersTab company={company} />}
        </Suspense>
      </div>
    </>
  );
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
  const { ea, eb, la, lb, options } = quarterChoice(events, a, b);

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
      <CallsPanel ticker={company.ticker} options={options} a={la} b={lb} initialJob={activeJob} hasResult={Boolean(comparison)} />
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

function quarterChoice(events: Awaited<ReturnType<typeof getEvents>>, a?: string, b?: string) {
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
      return { value: v, label: `${v.replace("FY", "FY ").replace("Q", " · Q")}${ev ? ` (reported ${ev.report_date})` : ""}` };
    });

  return { ea, eb, la, lb, options };
}

type Events = Awaited<ReturnType<typeof getEvents>>;

const usd = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `$${v.toFixed(2)}`);
const big = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`;

async function BriefTab({ company, events, a, b, mode = "brief" }: { company: Company; events: Events; a?: string; b?: string; mode?: "brief" | "filings" }) {
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
    const risks = brief.inputs.risk ? await getRiskChanges(company.cik, brief.inputs.risk.accession_new, brief.inputs.risk.accession_old) : [];
    return (
      <div className="space-y-8">
        {panel}
        <FilingsView inputs={brief.inputs} risks={risks} la={la} lb={lb} />
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
  const valuation = v?.price && v?.eps_ntm && v.eps_ntm > 0 ? { price: v.price, epsNtm: v.eps_ntm, peerMedianPe: peerCmp?.result.medians.pe_fwd_ntm ?? null } : null;
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

async function PeersTab({ company }: { company: Company }) {
  const [peerSet, comparison, job] = await Promise.all([getPeerSet(company.cik), getPeerComparison(company.cik), getLatestPeersJob(company.ticker)]);
  return <PeersView ticker={company.ticker} peerSet={peerSet} comparison={comparison} initialJob={job} />;
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

async function StreetTab({ company, events }: { company: Company; events: Events }) {
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
        peerMedianPe: peers?.result.medians.pe_fwd_ntm ?? null,
        estimates,
        streak,
        guidance: analysis?.extraction?.guidance?.length && lb ? { label: lb, items: analysis.extraction.guidance } : null,
        cases,
        dcf,
      }}
    />
  );
}

async function FinancialsTab({ company, filings }: { company: Company; filings: Filing[] }) {
  const data = await getFinancials(company, filings);
  const groups = [...GENERAL_GROUPS, ...(company.sector_pack !== "general" ? [PACK_GROUPS[company.sector_pack]] : [])];
  return <FinancialsView data={data} groups={groups} />;
}

function ValuationStrip({ company }: { company: Company }) {
  const v = company.valuation;
  if (!v) return null;
  const cur = SYMBOL[v.currency] ?? "";
  const items: [string, string | null][] = [
    ["Market cap", v.market_cap != null ? `$${compact(v.market_cap)}` : null],
    ["Enterprise value", v.enterprise_value != null ? `$${compact(v.enterprise_value)}` : null],
    ["P/E (TTM)", v.pe != null ? `${v.pe.toFixed(1)}×` : null],
  ];
  if (company.sector_pack === "bank") items.push(["P/TBV", v.p_tbv != null ? `${v.p_tbv.toFixed(2)}×` : null]);
  else if (company.sector_pack === "insurer") items.push(["P/B", v.p_b != null ? `${v.p_b.toFixed(2)}×` : null]);
  else {
    items.push(["EV/EBITDA (TTM)", v.ev_ebitda != null ? `${v.ev_ebitda.toFixed(1)}×` : null]);
    items.push(["EV/Revenue (TTM)", v.ev_revenue != null ? `${v.ev_revenue.toFixed(2)}×` : null]);
  }
  items.push(["FCF yield (TTM)", v.fcf_yield != null ? `${(v.fcf_yield * 100).toFixed(1)}%` : null]);
  const x = (n: number | null | undefined) => (n != null ? `${n.toFixed(1)}×` : null);
  const street: [string, string | null, string][] = v.street_source
    ? [
        ["Adj. P/E (LTM)", x(v.pe_adj_ltm), v.adj_eps_ltm != null ? `EPS $${v.adj_eps_ltm.toFixed(2)}, last 4 quarters` : "needs 4 reported quarters"],
        ["Adj. P/E (run-rate)", x(v.pe_adj_run_rate), v.adj_eps_run_rate != null ? `${v.adj_eps_run_rate_quarter} EPS × 4 = $${v.adj_eps_run_rate.toFixed(2)}` : ""],
        ["Fwd P/E (next 12 mo.)", x(v.pe_fwd_ntm), v.eps_ntm != null ? `consensus EPS $${v.eps_ntm.toFixed(2)}` : "no consensus available"],
      ]
    : [];

  return (
    <section className="mt-6" aria-label="Valuation">
      {v.note ? (
        <p className="rounded-xl bg-card px-4 py-3 text-sm text-muted">{v.note}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
            {items.map(([label, val]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className={`mt-0.5 text-lg font-semibold ${val ? "" : "text-muted"}`}>{val ?? "Not reported"}</dd>
              </div>
            ))}
          </dl>
          {street.length > 0 && (
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-4 sm:grid-cols-3">
              {street.map(([label, val, sub]) => (
                <div key={label}>
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className={`mt-0.5 text-lg font-semibold ${val ? "" : "text-muted"}`}>{val ?? "Not available"}</dd>
                  <dd className="text-xs text-muted">{sub}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-2 text-xs text-muted">
            Price {cur}
            {v.price?.toFixed(2)} on {v.price_date} · shares: {v.shares_source?.toLowerCase()} · computed in code from the
            latest filings
            {v.fy_fallback?.length ? ` · uses latest fiscal year (no quarterly data) for: ${v.fy_fallback.join(", ")}` : ""}
          </p>
          {v.street_source && (
            <p className="mt-1 text-xs text-muted">
              Adjusted and forward P/E use Street EPS (the adjusted basis companies report to analysts) and analyst consensus from{" "}
              {v.street_source.split(" (")[0]} — not SEC filings. Run-rate annualizes one quarter, so it overstates seasonal businesses
              after their peak quarter. {v.eps_ntm_method ? `Forward EPS: ${v.eps_ntm_method}.` : ""}
            </p>
          )}
        </>
      )}
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
