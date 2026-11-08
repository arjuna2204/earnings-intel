import { Suspense } from "react";
import Link from "next/link";
import AnalyzePanel from "@/components/AnalyzePanel";
import CompanyTabs, { type TabKey } from "@/components/CompanyTabs";
import FinancialsView from "@/components/FinancialsView";
import PriceChart from "@/components/PriceChart";
import { getCompanyByTicker, getFilings, getFinancials, getLatestJob, getPrices, getTicker } from "@/lib/company";
import { getAnalysis, getComparison, getEvents, getLatestCallsJob, getToneTrend, parseQ, qLabel } from "@/lib/calls";
import CallsPanel from "@/components/CallsPanel";
import CallView from "@/components/CallView";
import { compact, filingIndexFromDocUrl, GENERAL_GROUPS, PACK_GROUPS } from "@/lib/metrics";
import type { Company, Filing } from "@/lib/types";

export default function CompanyPage(props: PageProps<"/c/[ticker]">) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-6 sm:pb-12">
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
  const tab = (typeof sp.tab === "string" ? sp.tab : "financials") as TabKey;

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
        <CompanyTabs defaultTab="financials" />
      </div>
      <div className="mt-6">
        {tab === "financials" && <FinancialsTab company={company} filings={filings} />}
        {tab === "sources" && <SourcesTab company={company} filings={filings} />}
        {tab === "brief" && <ComingSoon phase="3" what="The “what changed” brief compares any two periods across calls and filings, with every claim linked to its source." />}
        {tab === "call" && <CallTab company={company} events={events} a={typeof sp.a === "string" ? sp.a : undefined} b={typeof sp.b === "string" ? sp.b : undefined} />}
        {tab === "filings" && <ComingSoon phase="3" what="Risk-factor redlines, MD&A drivers, and call-vs-filing consistency flags." />}
        {tab === "peers" && <ComingSoon phase="4" what="Editable peer set, ranking table, scatter plot, and a how-it-stacks-up summary." />}
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

function ComingSoon({ phase, what }: { phase: string; what: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-8 text-center">
      <p className="text-sm font-semibold text-accent">Arrives in Phase {phase}</p>
      <p className="mx-auto mt-2 max-w-md text-muted">{what}</p>
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
