import { select } from "@/lib/db";
import type { Company, Filing } from "@/lib/types";

const fmt = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function age(d: string, today: string): number {
  return Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${d.slice(0, 10)}T12:00:00Z`)) / 86400000);
}

/**
 * Everything about where the numbers came from and how fresh they are, behind one small button.
 * It says "Data as of <date>" normally, and turns red when something is stale or held back.
 */
export default async function DataInfo({ company, priceDate, filings }: { company: Company; priceDate: string | null; filings: Filing[] }) {
  const [est, risk, opts] = await Promise.all([
    select<{ snapshot_date: string }>("eps_estimate_history", { cik: `eq.${company.cik}`, select: "snapshot_date", order: "snapshot_date.desc", limit: "1" }).catch(() => []),
    select<{ as_of: string }>("risk_stats", { cik: `eq.${company.cik}`, select: "as_of" }).catch(() => []),
    select<{ as_of: string }>("options_snapshot", { cik: `eq.${company.cik}`, select: "as_of" }).catch(() => []),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const periodic = filings.find((f) => ["10-K", "10-Q", "20-F", "40-F"].includes(f.form));
  const items: { label: string; date: string; staleAfter: number }[] = [];
  if (priceDate) items.push({ label: "Price", date: priceDate, staleAfter: 5 });
  if (periodic) items.push({ label: `Latest ${periodic.form} filed`, date: periodic.filed_date, staleAfter: 130 });
  if (est[0]) items.push({ label: "Analyst estimates", date: est[0].snapshot_date, staleAfter: 45 });
  if (risk[0]) items.push({ label: "Risk stats", date: risk[0].as_of, staleAfter: 7 });
  if (opts[0]) items.push({ label: "Options", date: opts[0].as_of, staleAfter: 5 });
  const stale = items.filter((i) => age(i.date, today) > i.staleAfter);
  const flags = company.quality ?? [];
  const held = flags.filter((f) => f.severity === "hide");
  const alert = stale.length > 0 || held.length > 0;
  const v = company.valuation;

  return (
    <details className="group relative mt-2 inline-block text-xs">
      <summary className={`cursor-pointer list-none rounded-full px-2 py-0.5 hover:bg-card ${alert ? "text-down" : "text-muted"}`}>
        {alert ? "⚠︎ " : "ⓘ "}
        {held.length ? "Some numbers held back" : stale.length ? `${stale[0].label} is out of date` : priceDate ? `Data as of ${fmt(priceDate)}` : "About this data"}
      </summary>
      <div className="absolute left-0 z-30 mt-1 w-[min(26rem,90vw)] space-y-3 rounded-2xl border border-border bg-background p-4 text-sm shadow-lg">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">How fresh</h3>
          <ul className="mt-1 space-y-0.5">
            {items.map((i) => (
              <li key={i.label} className={`flex justify-between gap-4 ${age(i.date, today) > i.staleAfter ? "text-down" : ""}`}>
                <span>{i.label}</span>
                <span className="tabular-nums">
                  {age(i.date, today) > i.staleAfter ? "⚠︎ " : ""}
                  {fmt(i.date)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        {flags.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Today&apos;s data checks</h3>
            <ul className="mt-1 space-y-1">
              {flags.map((f) => (
                <li key={f.check} className={f.severity === "hide" ? "text-down" : ""}>
                  {f.severity === "hide" ? "■ Hidden: " : "⚠︎ "}
                  {f.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="text-xs text-muted">
          <h3 className="font-semibold uppercase tracking-wide">Where it comes from</h3>
          <p className="mt-1">
            Financials from SEC filings (each number links to its filing); prices from Tiingo; valuation computed in code
            {v?.shares_source ? ` using ${v.shares_source.toLowerCase()}` : ""}.
            {v?.fy_fallback?.length ? ` Uses the latest fiscal year for: ${v.fy_fallback.join(", ")}.` : ""}
            {v?.shares_note ? ` ${v.shares_note}` : ""}
            {v?.street_source ? ` Adjusted and forward P/E use analyst consensus from ${v.street_source.split(" (")[0]}, not SEC filings.` : ""}
          </p>
          <a href={`/c/${encodeURIComponent(company.ticker)}?tab=sources`} className="mt-1 inline-block font-medium text-foreground hover:underline">
            All sources →
          </a>
        </div>
      </div>
    </details>
  );
}
