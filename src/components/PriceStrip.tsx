import Link from "next/link";
import type { Company } from "@/lib/types";

type Px = { date: string; adj_close: number; close?: number | null };

/** Slim price line for tabs other than Overview: the full chart lives on Overview, so content starts right away. */
export default function PriceStrip({ ticker, prices, valuation }: { ticker: string; prices: Px[]; valuation: Company["valuation"] }) {
  const last = prices.at(-1);
  if (!last) return null;
  const cut = new Date(Date.parse(`${last.date}T00:00:00Z`) - 365 * 864e5).toISOString().slice(0, 10);
  const year = prices.filter((p) => p.date >= cut && p.adj_close > 0);
  const first = year[0] ?? last;
  const chg = last.adj_close / first.adj_close - 1;
  const up = chg >= 0;
  const price = valuation?.price ?? last.close ?? last.adj_close;

  // sparkline: ~120 points is plenty for 1 year at this size
  const step = Math.max(1, Math.floor(year.length / 120));
  const pts = year.filter((_, i) => i % step === 0 || i === year.length - 1);
  const lo = Math.min(...pts.map((p) => p.adj_close));
  const hi = Math.max(...pts.map((p) => p.adj_close));
  const W = 160;
  const H = 36;
  const path = pts
    .map((p, i) => `${i ? "L" : "M"}${((i / Math.max(1, pts.length - 1)) * W).toFixed(1)},${(H - ((p.adj_close - lo) / (hi - lo || 1)) * H).toFixed(1)}`)
    .join(" ");
  const fmt = (n: number) => (n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`);

  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-border px-4 py-3">
      <div className="flex items-baseline gap-3">
        <span className="figure text-2xl">${price.toFixed(2)}</span>
        <span className={`text-sm font-medium tabular-nums ${up ? "text-up" : "text-down"}`}>
          {up ? "▲" : "▼"} {Math.abs(chg * 100).toFixed(1)}% <span className="font-normal text-muted">past year</span>
        </span>
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="hidden overflow-visible sm:block" aria-hidden>
        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-foreground/70" />
      </svg>
      <dl className="flex gap-6 text-sm">
        {valuation?.market_cap != null && (
          <div>
            <dt className="text-xs text-muted">Market cap</dt>
            <dd className="font-medium tabular-nums">{fmt(valuation.market_cap)}</dd>
          </div>
        )}
        {valuation?.pe != null && (
          <div>
            <dt className="text-xs text-muted">P/E</dt>
            <dd className="font-medium tabular-nums">{valuation.pe.toFixed(1)}×</dd>
          </div>
        )}
      </dl>
      <Link href={`/c/${encodeURIComponent(ticker)}`} className="ml-auto text-sm font-medium text-accent hover:underline">
        Full chart →
      </Link>
    </div>
  );
}
