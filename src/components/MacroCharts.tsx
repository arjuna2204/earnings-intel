"use client";

import EChart from "@/components/EChart";
import { useThemeColors } from "@/components/useThemeColors";

/** Small line chart for one macro series. */
export default function MacroChart({ points, label, zero }: { points: [string, number][]; label: string; zero?: boolean }) {
  const t = useThemeColors();
  const option = {
    animation: false,
    grid: { left: 4, right: 8, top: 8, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", valueFormatter: (v: number) => v.toFixed(2) },
    xAxis: { type: "time", axisLabel: { color: t.muted, fontSize: 10 }, splitLine: { show: false } },
    yAxis: { type: "value", scale: true, axisLabel: { color: t.muted, fontSize: 10 }, splitLine: { lineStyle: { color: t.grid } } },
    series: [
      {
        type: "line",
        data: points,
        showSymbol: false,
        lineStyle: { width: 1.5, color: t.fg },
        markLine: zero ? { silent: true, symbol: "none", lineStyle: { color: t.muted, type: "dashed" }, label: { show: false }, data: [{ yAxis: 0 }] } : undefined,
      },
    ],
  };
  return <EChart option={option} className="h-36 w-full" ariaLabel={label} />;
}
