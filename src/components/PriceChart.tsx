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
  markers,
  currencySymbol = "$",
  emptyNote,
  markerNote = "○ = earnings report · tap to open that call",
}: {
  prices: PricePoint[];
  markers: Marker[];
  currencySymbol?: string;
  emptyNote?: string;
  markerNote?: string;
}) {
  const colors = useThemeColors();
  const router = useRouter();
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("1Y");
  const [hover, setHover] = useState<number | null>(null);

  const series = useMemo(() => {
    if (!prices.length) return [];
    const days = RANGES.find((r) => r.key === range)!.days;
    const last = new Date(prices[prices.length - 1].date);
    const cutoff = new Date(last.getTime() - days * 86400000).toISOString().slice(0, 10);
    return prices.filter((p) => p.date >= cutoff);
  }, [prices, range]);

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
        markPoint: {
          symbol: "circle",
          symbolSize: 8,
          itemStyle: { color: colors.card, borderColor: colors.muted, borderWidth: 2 },
          label: { show: false },
          data: markerPoints,
        },
      },
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
        <span className="hidden text-xs text-muted sm:inline">{markerNote}</span>
      </div>
    </section>
  );
}
