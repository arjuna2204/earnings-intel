import { select } from "@/lib/db";
import type { Filing } from "@/lib/types";

const fmt = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function age(d: string, today: string): number {
  return Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${d.slice(0, 10)}T12:00:00Z`)) / 86400000);
}

/** One quiet line saying how fresh each kind of data is, so nobody mistakes an old number for today's. */
export default async function Freshness({ cik, priceDate, filings }: { cik: number; priceDate: string | null; filings: Filing[] }) {
  const [est, risk, opts] = await Promise.all([
    select<{ snapshot_date: string }>("eps_estimate_history", { cik: `eq.${cik}`, select: "snapshot_date", order: "snapshot_date.desc", limit: "1" }).catch(() => []),
    select<{ as_of: string }>("risk_stats", { cik: `eq.${cik}`, select: "as_of" }).catch(() => []),
    select<{ as_of: string }>("options_snapshot", { cik: `eq.${cik}`, select: "as_of" }).catch(() => []),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const periodic = filings.find((f) => ["10-K", "10-Q", "20-F", "40-F"].includes(f.form));
  const items: { label: string; date: string; staleAfter: number }[] = [];
  if (priceDate) items.push({ label: "Price", date: priceDate, staleAfter: 5 });
  if (periodic) items.push({ label: `${periodic.form} filed`, date: periodic.filed_date, staleAfter: 130 });
  if (est[0]) items.push({ label: "Estimates", date: est[0].snapshot_date, staleAfter: 45 });
  if (opts[0]) items.push({ label: "Options", date: opts[0].as_of, staleAfter: 5 });
  else if (risk[0]) items.push({ label: "Risk stats", date: risk[0].as_of, staleAfter: 7 });
  if (!items.length) return null;
  return (
    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted" aria-label="How fresh the data is">
      <span>Data as of</span>
      {items.map((i) => {
        const stale = age(i.date, today) > i.staleAfter;
        return (
          <span key={i.label} title={i.date.slice(0, 10)} className={stale ? "text-down" : undefined}>
            {stale ? "⚠︎ " : ""}
            {i.label} {fmt(i.date)}
          </span>
        );
      })}
    </p>
  );
}
