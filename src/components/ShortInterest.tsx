import Term from "@/components/Term";

export type ShortRow = { settlement_date: string; short_shares: number; avg_daily_volume: number | null; days_to_cover: number | null };

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const big = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(0)}K`);

/** Shares sold short (FINRA, twice a month): how many people are betting the price falls, and the trend. */
export default function ShortInterest({ rows, sharesOut }: { rows: ShortRow[]; sharesOut: number | null }) {
  if (!rows.length) return null;
  const [now, prev] = rows;
  const yearAgo = rows.find((r) => Date.parse(now.settlement_date) - Date.parse(r.settlement_date) > 330 * 86400000);
  const pct = sharesOut ? now.short_shares / sharesOut : null;
  const ch = prev ? now.short_shares / prev.short_shares - 1 : null;
  const level = pct == null ? "" : pct > 0.1 ? "high — a lot of investors are betting against it" : pct > 0.04 ? "moderate" : "low — few investors are betting against it";
  const spark = [...rows].reverse();
  const max = Math.max(...spark.map((r) => r.short_shares));
  return (
    <section aria-label="Short interest">
      <h2 className="flex items-center border-b border-border pb-3 text-xl font-semibold tracking-tight">
        <Term k="short_interest" quiet>Short interest</Term>
      </h2>
      <p className="mt-2 text-[15px]">
        {big(now.short_shares)} shares were sold short as of {fmt(now.settlement_date)}
        {pct != null ? ` — ${(pct * 100).toFixed(1)}% of shares outstanding, ${level}` : ""}.
        {ch != null && ` ${ch >= 0 ? "Up" : "Down"} ${Math.abs(ch * 100).toFixed(1)}% from two weeks earlier.`}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">Shares short</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums">{big(now.short_shares)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">% of shares outstanding</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums">{pct != null ? `${(pct * 100).toFixed(2)}%` : "—"}</dd>
        </div>
        <div>
          <dt className="flex items-center text-xs text-muted">
            <Term k="days_to_cover">Days to cover</Term>
          </dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums">{now.days_to_cover != null ? now.days_to_cover.toFixed(1) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">vs a year ago</dt>
          <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${yearAgo ? (now.short_shares >= yearAgo.short_shares ? "text-down" : "text-up") : ""}`}>
            {yearAgo ? `${now.short_shares >= yearAgo.short_shares ? "▲" : "▼"} ${Math.abs((now.short_shares / yearAgo.short_shares - 1) * 100).toFixed(0)}%` : "—"}
          </dd>
        </div>
      </dl>
      <div className="mt-4 flex h-12 items-end gap-0.5" aria-label="Short interest over the last year" role="img">
        {spark.map((r) => (
          <div key={r.settlement_date} title={`${fmt(r.settlement_date)}: ${big(r.short_shares)}`} className="flex-1 rounded-t bg-muted/40" style={{ height: `${(r.short_shares / max) * 100}%` }} />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">Source: FINRA consolidated short interest, reported for the middle and end of each month and released about a week later.</p>
    </section>
  );
}
