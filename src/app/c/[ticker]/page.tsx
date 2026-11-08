import { Suspense } from "react";
import Link from "next/link";
import AnalyzePanel from "@/components/AnalyzePanel";
import CompanyTabs, { type TabKey } from "@/components/CompanyTabs";
import FinancialsView from "@/components/FinancialsView";
import PriceChart from "@/components/PriceChart";
import { getCompanyByTicker, getFilings, getFinancials, getLatestJob, getPrices, getTicker } from "@/lib/company";
import { compact, GENERAL_GROUPS, PACK_GROUPS, secFilingIndexUrl } from "@/lib/metrics";
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

  const [prices, filings, job] = await Promise.all([getPrices(company.ticker), getFilings(company.cik), getLatestJob(company.ticker)]);
  const markers = filings
    .filter((f) => ["10-K", "10-Q", "20-F", "40-F"].includes(f.form))
    .map((f) => ({ date: f.filed_date, label: f.form }));

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
      {company.sector_note && (
        <p className="mt-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
          <b>Sector check:</b> {company.sector_note}. Using general metrics for now — tell Claude if a sector pack should apply.
        </p>
      )}

      <div className="mt-6">
        <PriceChart prices={prices} markers={markers} currencySymbol="$" />
      </div>

      <ValuationStrip company={company} />

      <div className="mt-6">
        <CompanyTabs defaultTab="financials" />
      </div>
      <div className="mt-6">
        {tab === "financials" && <FinancialsTab company={company} filings={filings} />}
        {tab === "sources" && <SourcesTab company={company} filings={filings} />}
        {tab === "brief" && <ComingSoon phase="3" what="The “what changed” brief compares any two periods across calls and filings, with every claim linked to its source." />}
        {tab === "call" && <ComingSoon phase="2" what="Guidance changes, new and dropped topics, tone by executive, and Q&A evasiveness." />}
        {tab === "filings" && <ComingSoon phase="3" what="Risk-factor redlines, MD&A drivers, and call-vs-filing consistency flags." />}
        {tab === "peers" && <ComingSoon phase="4" what="Editable peer set, ranking table, scatter plot, and a how-it-stacks-up summary." />}
      </div>
    </>
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
          <p className="mt-2 text-xs text-muted">
            Price {cur}
            {v.price?.toFixed(2)} on {v.price_date} · shares: {v.shares_source?.toLowerCase()} · computed in code from the
            latest filings
          </p>
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
              <a href={secFilingIndexUrl(company.cik, f.accession)} target="_blank" rel="noreferrer" className="text-muted underline">
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
