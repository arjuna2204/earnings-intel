"use client";

import { useMemo } from "react";
import EChart from "@/components/EChart";
import { useThemeColors } from "@/components/useThemeColors";

export type TrendRow = { fiscal_year: number; metric: string; value: number };

/** Margin trends and share count over time (fiscal years, from SEC data). */
export default function TrendsView({ rows }: { rows: TrendRow[] }) {
  const t = useThemeColors();
  const years = [...new Set(rows.map((r) => r.fiscal_year))].sort();
  const val = (m: string, y: number) => rows.find((r) => r.metric === m && r.fiscal_year === y)?.value ?? null;
  const lines: [string, string, string][] = [
    ["gross_margin", "Gross margin", t.muted],
    ["operating_margin", "Operating margin", t.fg],
    ["fcf_margin", "Free-cash-flow margin", t.up],
  ];
  const present = lines.filter(([m]) => years.some((y) => val(m, y) != null));
  const shares = years.map((y) => val("diluted_shares", y));
  const firstS = shares.find((x) => x != null) ?? null;
  const lastS = [...shares].reverse().find((x) => x != null) ?? null;
  const change = firstS && lastS ? lastS / firstS - 1 : null;

  const marginOpt = useMemo(
    () => ({
      animation: false,
      grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
      legend: { top: 0, textStyle: { color: t.muted } },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`) },
      xAxis: { type: "category", data: years.map((y) => `FY${String(y).slice(2)}`), axisLabel: { color: t.muted }, axisLine: { lineStyle: { color: t.grid } } },
      yAxis: { type: "value", axisLabel: { color: t.muted, formatter: (v: number) => `${Math.round(v * 100)}%` }, splitLine: { lineStyle: { color: t.grid } } },
      series: present.map(([m, name, color]) => ({ type: "line", name, data: years.map((y) => val(m, y)), connectNulls: true, symbolSize: 5, lineStyle: { width: 2, color }, itemStyle: { color } })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, t],
  );
  const shareOpt = useMemo(
    () => ({
      animation: false,
      grid: { left: 8, right: 16, top: 10, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => (v == null ? "—" : `${(v / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })}M`) },
      xAxis: { type: "category", data: years.map((y) => `FY${String(y).slice(2)}`), axisLabel: { color: t.muted }, axisLine: { lineStyle: { color: t.grid } } },
      yAxis: { type: "value", scale: true, axisLabel: { color: t.muted, formatter: (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : `${(v / 1e6).toFixed(0)}M`) }, splitLine: { lineStyle: { color: t.grid } } },
      series: [{ type: "bar", data: shares, itemStyle: { color: change != null && change < 0 ? t.up : t.down, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 22 }],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, t],
  );
  if (years.length < 3) return null;
  return (
    <section className="space-y-10">
      {present.length > 0 && (
        <div>
          <h3 className="border-b border-border pb-3 text-xl font-semibold tracking-tight">Margins over time</h3>
          <p className="mt-2 text-sm text-muted">How much of each dollar of sales becomes gross profit, operating profit and free cash flow (fiscal years, SEC filings).</p>
          <EChart option={marginOpt} className="mt-3 h-72 w-full" ariaLabel="Gross, operating and free-cash-flow margins by fiscal year" />
        </div>
      )}
      {lastS && (
        <div>
          <h3 className="border-b border-border pb-3 text-xl font-semibold tracking-tight">Share count</h3>
          <p className="mt-2 text-sm text-muted">
            Diluted shares by fiscal year.{" "}
            {change != null && (
              <span className={change < 0 ? "font-semibold text-up" : "font-semibold text-down"}>
                {change < 0 ? "▼" : "▲"} {Math.abs(change * 100).toFixed(1)}% since FY{years[shares.findIndex((x) => x != null)]}
              </span>
            )}
            {change != null && (change < 0 ? " — buybacks are shrinking the share count, so each share owns more of the company." : " — new shares are diluting existing owners.")}
          </p>
          <EChart option={shareOpt} className="mt-3 h-56 w-full" ariaLabel="Diluted share count by fiscal year" />
        </div>
      )}
    </section>
  );
}
