"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import EChart from "@/components/EChart";
import { useThemeColors } from "@/components/useThemeColors";
import type { PricePoint } from "@/lib/types";

const RANGES = [
  { key: "1M", days: 31 },
  { key: "3M", days: 92 },
  { key: "1Y", days: 366 },
  { key: "5Y", days: 5 * 366 },
  { key: "15Y", days: 15 * 366 },
] as const;

type Marker = { date: string; label: string; href?: string };

export default function PriceChart({
  prices,
  benchmark = [],
  markers,
  currencySymbol = "$",
  emptyNote,
  markerNote = "○ = earnings report · tap to open that call",
}: {
  prices: PricePoint[];
  /** S&P 500 (SPY) prices, for the "did it beat the market" comparison */
  benchmark?: PricePoint[];
  markers: Marker[];
  currencySymbol?: string;
  emptyNote?: string;
  markerNote?: string;
}) {
  const colors = useThemeColors();
  const router = useRouter();
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("1Y");
  const [hover, setHover] = useState<number | null>(null);
  const [showSpy, setShowSpy] = useState(true);

  const series = useMemo(() => {
    if (!prices.length) return [];
    const days = RANGES.find((r) => r.key === range)!.days;
    const last = new Date(prices[prices.length - 1].date);
    const cutoff = new Date(last.getTime() - days * 86400000).toISOString().slice(0, 10);
    return prices.filter((p) => p.date >= cutoff);
  }, [prices, range]);

  // S&P 500 on the stock's dates (last close on or before each day), adjusted for dividends too
  const spy = useMemo(() => {
    if (!benchmark.length || !series.length) return null;
    const out: (number | null)[] = [];
    let j = 0;
    let last: number | null = null;
    for (const p of series) {
      while (j < benchmark.length && benchmark[j].date <= p.date) last = benchmark[j++].adj_close;
      out.push(last);
    }
    return out[0] == null ? null : out;
  }, [benchmark, series]);

  if (!prices.length) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-2xl bg-card px-6 text-center text-muted">
        <span>No price history yet</span>
        {emptyNote && <span className="max-w-md text-sm">{emptyNote}</span>}
      </div>
    );
  }

  // Adjusted close keeps long ranges continuous across splits/dividends; the headline shows the actual close.
  const first = series[0];
  const latest = series[series.length - 1];
  const shown = hover !== null ? series[hover] : latest;
  const change = shown.adj_close - first.adj_close;
  const pct = change / first.adj_close;
  const up = change >= 0;
  const color = up ? colors.up : colors.down;
  // vs the S&P 500 over the same window (both total returns, dividends included)
  const idx = hover ?? series.length - 1;
  const spyPct = spy && spy[0] && spy[idx] != null ? (spy[idx] as number) / spy[0] - 1 : null;
  const diff = spyPct == null ? null : pct - spyPct;
  const beat = diff != null && diff >= 0;
  const inRange = markers.filter((m) => m.date >= first.date && m.date <= latest.date);
  const dateIndex = new Map(series.map((p, i) => [p.date, i]));
  const placed = inRange
    .map((m) => {
      const i = dateIndex.get(m.date) ?? series.findIndex((p) => p.date >= m.date);
      return i >= 0 ? { m, point: { coord: [i, series[i].adj_close], name: m.label, value: m.label } } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const markerPoints = placed.map((x) => x.point);

  const option = {
    animationDuration: 300,
    grid: { left: 0, right: 0, top: 8, bottom: 8 },
    xAxis: { type: "category", data: series.map((p) => p.date), show: false, boundaryGap: false },
    yAxis: { type: "value", show: false, scale: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: colors.muted, width: 1 } },
      formatter: () => "",
      backgroundColor: "transparent",
      borderWidth: 0,
      extraCssText: "box-shadow:none",
    },
    series: [
      {
        type: "line",
        data: series.map((p) => p.adj_close),
        showSymbol: false,
        lineStyle: { color, width: 2 },
        itemStyle: { color },
        z: 3,
        markPoint: {
          symbol: "circle",
          symbolSize: 8,
          itemStyle: { color: colors.card, borderColor: colors.muted, borderWidth: 2 },
          label: { show: false },
          data: markerPoints,
        },
      },
      ...(showSpy && spy
        ? [
            {
              type: "line",
              name: "S&P 500",
              // drawn on the stock's scale: where the stock would be had it matched the S&P 500
              data: spy.map((v) => (v == null || !spy[0] ? null : (first.adj_close * v) / (spy[0] as number))),
              showSymbol: false,
              connectNulls: true,
              lineStyle: { color: colors.muted, width: 1.5, type: "dashed" },
              itemStyle: { color: colors.muted },
              z: 2,
            },
          ]
        : []),
    ],
  };

  return (
    <section aria-label="Price chart">
      <div className="mb-3">
        <div className="text-4xl font-semibold tracking-tight">
          {currencySymbol}
          {shown.close.toFixed(2)}
        </div>
        <div className="mt-1 text-sm font-medium" style={{ color }}>
          {up ? "▲ +" : "▼ −"}
          {currencySymbol}
          {Math.abs(change).toFixed(2)} ({up ? "+" : "−"}
          {Math.abs(pct * 100).toFixed(2)}%){" "}
          <span className="text-muted">
            {hover !== null ? shown.date : `past ${range}`} · adjusted for splits & dividends
          </span>
        </div>
        {diff != null && spyPct != null && (
          <div className="mt-1 text-sm">
            <span className="text-muted">
              S&amp;P 500 {spyPct >= 0 ? "+" : "−"}
              {Math.abs(spyPct * 100).toFixed(2)}% ·{" "}
            </span>
            <span className={`font-medium ${beat ? "text-up" : "text-down"}`}>
              {beat ? "▲ Beat" : "▼ Trailed"} the market by {Math.abs(diff * 100).toFixed(1)} pts
            </span>
          </div>
        )}
      </div>
      <div>
        <EChart
          onHoverIndex={setHover}
          onClick={(p) => {
            if (p.componentType === "markPoint") {
              const href = placed[p.dataIndex]?.m.href;
              if (href) router.push(href, { scroll: false });
            }
          }}
          option={option}
          className="h-64 w-full sm:h-80"
          ariaLabel={`Price over ${range}: ${up ? "up" : "down"} ${Math.abs(pct * 100).toFixed(1)} percent`}
        />
      </div>
      <div className="mt-2 flex items-center justify-between border-b border-border pb-3">
        <div className="flex gap-1" role="tablist" aria-label="Chart range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              role="tab"
              aria-selected={range === r.key}
              onClick={() => {
                setRange(r.key);
                setHover(null);
              }}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                range === r.key ? "text-background" : "text-muted hover:text-foreground"
              }`}
              style={range === r.key ? { background: color } : undefined}
            >
              {r.key}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {spy && (
            <button
              type="button"
              aria-pressed={showSpy}
              onClick={() => setShowSpy((v) => !v)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${showSpy ? "border-foreground text-foreground" : "border-border text-muted hover:text-foreground"}`}
            >
              <svg width="16" height="4" aria-hidden>
                <line x1="0" y1="2" x2="16" y2="2" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
              </svg>
              S&amp;P 500
            </button>
          )}
          <span className="hidden text-xs text-muted sm:inline">{markerNote}</span>
        </div>
      </div>
    </section>
  );
}
