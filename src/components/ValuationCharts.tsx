"use client";

import { useMemo } from "react";
import EChart from "@/components/EChart";
import { useThemeColors } from "@/components/useThemeColors";

export type FieldRow = { label: string; sub: string; lo: number; hi: number; mid?: number | null };

/** Football field: every valuation view as a range against today's price. */
export function FootballField({ rows, price }: { rows: FieldRow[]; price: number }) {
  const all = rows.flatMap((r) => [r.lo, r.hi]).concat(price);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min || price) * 0.06;
  const lo = Math.max(0, min - pad);
  const hi = max + pad;
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const fmt = (v: number) => `$${v >= 1000 ? v.toFixed(0) : v.toFixed(v >= 100 ? 0 : 2)}`;
  return (
    <div>
      <div className="font-semibold">What it could be worth</div>
      <p className="mt-0.5 text-sm text-muted">Each valuation method as a range. The line is today&apos;s price ({fmt(price)}).</p>
      <div className="mt-4">
        <ul className="divide-y divide-border">
          {rows.map((r) => {
            const above = r.lo > price;
            const below = r.hi < price;
            const color = above ? "bg-up" : below ? "bg-down" : "bg-foreground/60";
            return (
              <li key={r.label} className="grid gap-1 py-3 sm:grid-cols-[13rem_1fr] sm:items-center sm:gap-0">
                <span className="pr-3 text-sm">
                  <span className="font-medium">{r.label}</span>
                  <span className="block text-xs text-muted">{r.sub}</span>
                </span>
                <div className="relative h-7">
                  <div className="absolute inset-y-0 w-px bg-foreground/80" style={{ left: `${pos(price)}%` }} />
                  <div className={`absolute top-2.5 h-2 rounded-full ${color}`} style={{ left: `${pos(r.lo)}%`, width: `${Math.max(pos(r.hi) - pos(r.lo), 0.8)}%` }} />
                  {r.mid != null && <div className="absolute top-1.5 h-4 w-0.5 rounded bg-foreground" style={{ left: `${pos(r.mid)}%` }} />}
                  <span className="absolute -top-0.5 text-[11px] tabular-nums text-muted" style={{ left: `${pos(r.lo)}%`, transform: "translateX(-100%)", paddingRight: 4 }}>
                    {fmt(r.lo)}
                  </span>
                  <span className="absolute -top-0.5 text-[11px] tabular-nums text-muted" style={{ left: `${pos(r.hi)}%`, paddingLeft: 4 }}>
                    {fmt(r.hi)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="mt-2 text-xs text-muted">Green = whole range above today&apos;s price, orange = below, grey = straddles it. Tick = midpoint / base case.</p>
    </div>
  );
}

/** Forward P/E over 3 years with its 20th–80th percentile band. */
export function PeHistoryChart({ series, p20, p50, p80, current }: { series: [string, number][]; p20: number; p50: number; p80: number; current: number | null }) {
  const t = useThemeColors();
  const option = useMemo(
    () => ({
      animation: false,
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      xAxis: { type: "time", axisLabel: { color: t.muted }, axisLine: { show: false }, splitLine: { show: false } },
      yAxis: { type: "value", scale: true, axisLabel: { color: t.muted, formatter: (v: number) => `${v}x` }, splitLine: { lineStyle: { color: t.grid } } },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v.toFixed(1)}x` },
      series: [
        {
          type: "line",
          name: "Forward P/E",
          data: series,
          showSymbol: false,
          lineStyle: { color: t.fg, width: 2 },
          markArea: { silent: true, itemStyle: { color: t.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)" }, data: [[{ yAxis: p20 }, { yAxis: p80 }]] },
          markLine: {
            silent: true,
            symbol: "none",
            label: { color: t.muted, formatter: "median {c}x", position: "insideEndTop" },
            lineStyle: { color: t.muted, type: "dashed" },
            data: [{ yAxis: Number(p50.toFixed(1)) }],
          },
        },
        ...(current != null
          ? [{ type: "scatter", name: "Today", data: [[new Date().toISOString().slice(0, 10), current]], symbolSize: 11, itemStyle: { color: current <= p50 ? t.up : t.down } }]
          : []),
      ],
    }),
    [series, p20, p50, p80, current, t],
  );
  return (
    <div>
      <div className="font-semibold">Forward P/E vs. its own history</div>
      <p className="mt-0.5 text-sm text-muted">
        Price ÷ next-12-months consensus EPS, monthly over 3 years. Shaded band = 20th–80th percentile ({p20.toFixed(1)}x–{p80.toFixed(1)}x).
        {current != null && ` Today: ${current.toFixed(1)}x.`}
      </p>
      <EChart option={option} className="mt-3 h-64 w-full" ariaLabel="Forward P/E over three years with its typical range" />
    </div>
  );
}

export type RevisionPoint = { date: string; value: number };

/** Consensus for one upcoming period, week by week. */
export function RevisionsChart({ lines, firstDate }: { lines: { name: string; points: RevisionPoint[] }[]; firstDate: string | null }) {
  const t = useThemeColors();
  const enough = lines.some((l) => l.points.length >= 2);
  const option = useMemo(
    () => ({
      animation: false,
      grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
      legend: { top: 0, textStyle: { color: t.muted } },
      xAxis: { type: "time", axisLabel: { color: t.muted }, splitLine: { show: false } },
      yAxis: { type: "value", scale: true, axisLabel: { color: t.muted, formatter: (v: number) => `$${v.toFixed(2)}` }, splitLine: { lineStyle: { color: t.grid } } },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `$${v.toFixed(2)}` },
      series: lines.map((l, i) => ({ type: "line", name: l.name, data: l.points.map((p) => [p.date, p.value]), symbolSize: 6, lineStyle: { width: 2, color: i === 0 ? t.fg : t.muted }, itemStyle: { color: i === 0 ? t.fg : t.muted } })),
    }),
    [lines, t],
  );
  return (
    <div>
      <div className="font-semibold">Estimate revisions</div>
      <p className="mt-0.5 text-sm text-muted">Consensus EPS for upcoming periods, recorded every week. Rising lines = analysts raising numbers.</p>
      {enough ? (
        <EChart option={option} className="mt-3 h-56 w-full" ariaLabel="Consensus EPS estimates over time" />
      ) : (
        <p className="mt-3 text-sm text-muted">
          Collecting — the app saves a snapshot every week{firstDate ? ` (first one ${firstDate})` : ""}. The chart appears after the second week.
        </p>
      )}
    </div>
  );
}
