"use client";

import { useMemo } from "react";
import EChart from "@/components/EChart";
import { useThemeColors } from "@/components/useThemeColors";

export type RiskYear = { year: string; factors: number; added: number; removed: number; escalated: number; words: number };

/** Risk factors across annual reports: how many, how many new, and how many reworded more strongly. */
export default function RiskTrend({ years }: { years: RiskYear[] }) {
  const t = useThemeColors();
  const option = useMemo(
    () => ({
      animation: false,
      grid: { left: 8, right: 8, top: 30, bottom: 8, containLabel: true },
      legend: { top: 0, textStyle: { color: t.muted } },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: years.map((y) => y.year), axisLabel: { color: t.muted }, axisLine: { lineStyle: { color: t.grid } } },
      yAxis: [
        { type: "value", name: "", axisLabel: { color: t.muted }, splitLine: { lineStyle: { color: t.grid } } },
        { type: "value", axisLabel: { color: t.muted }, splitLine: { show: false } },
      ],
      series: [
        { type: "bar", name: "Risk factors", data: years.map((y) => y.factors), itemStyle: { color: t.muted, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 22 },
        { type: "line", name: "New", yAxisIndex: 1, data: years.map((y) => y.added), symbolSize: 6, lineStyle: { color: t.fg, width: 2 }, itemStyle: { color: t.fg } },
        { type: "line", name: "Stronger wording", yAxisIndex: 1, data: years.map((y) => y.escalated), symbolSize: 6, lineStyle: { color: t.down, width: 2 }, itemStyle: { color: t.down } },
      ],
    }),
    [years, t],
  );
  if (years.length < 2) return null;
  const first = years[0];
  const last = years[years.length - 1];
  const growth = first.words ? last.words / first.words - 1 : null;
  return (
    <div>
      <div className="font-semibold">Risk factors over time</div>
      <p className="mt-0.5 text-sm text-muted">
        Each annual report compared with the one before (left axis: number of risk factors; right axis: new and stronger-worded).
        {growth != null && ` The section is ${growth >= 0 ? "" : "−"}${Math.abs(growth * 100).toFixed(0)}% ${growth >= 0 ? "longer" : "shorter"} than in ${first.year}.`}
      </p>
      <EChart option={option} className="mt-3 h-60 w-full" ariaLabel="Number of risk factors, new ones and stronger-worded ones by annual report" />
    </div>
  );
}
