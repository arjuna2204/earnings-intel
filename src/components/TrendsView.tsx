"use client";

import { useMemo } from "react";
import EChart from "@/components/EChart";
import Term from "@/components/Term";
import { useThemeColors } from "@/components/useThemeColors";

export type TrendRow = { fiscal_year: number; metric: string; value: number };

/** Margin trends and share count over time (fiscal years, from SEC data). */
export default function TrendsView({ rows, wacc }: { rows: TrendRow[]; wacc: number | null }) {
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
  const growth = (m: string) => years.map((y) => {
    const a = val(m, y - 1);
    const b = val(m, y);
    return a != null && b != null && a > 0 ? b / a - 1 : null;
  });
  const revG = growth("revenue");
  const epsG = growth("eps_diluted");
  const growthOpt = useMemo(
    () => ({
      animation: false,
      grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
      legend: { top: 0, textStyle: { color: t.muted } },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`) },
      xAxis: { type: "category", data: years.map((y) => `FY${String(y).slice(2)}`), axisLabel: { color: t.muted }, axisLine: { lineStyle: { color: t.grid } } },
      yAxis: { type: "value", axisLabel: { color: t.muted, formatter: (v: number) => `${Math.round(v * 100)}%` }, splitLine: { lineStyle: { color: t.grid } } },
      series: [
        { type: "bar", name: "Revenue growth", data: revG, itemStyle: { color: t.muted, borderRadius: 2 }, barMaxWidth: 16 },
        { type: "line", name: "EPS growth", data: epsG.map((v) => (v == null ? null : Math.max(Math.min(v, 2), -1))), connectNulls: true, symbolSize: 5, lineStyle: { width: 2, color: t.fg }, itemStyle: { color: t.fg } },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, t],
  );
  const roic = years.map((y) => val("roic", y));
  const roicOpt = useMemo(
    () => ({
      animation: false,
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`) },
      xAxis: { type: "category", data: years.map((y) => `FY${String(y).slice(2)}`), axisLabel: { color: t.muted }, axisLine: { lineStyle: { color: t.grid } } },
      yAxis: { type: "value", axisLabel: { color: t.muted, formatter: (v: number) => `${Math.round(v * 100)}%` }, splitLine: { lineStyle: { color: t.grid } } },
      series: [
        {
          type: "bar",
          name: "Return on invested capital",
          data: roic.map((v) => (v == null ? null : { value: v, itemStyle: { color: wacc != null && v < wacc ? t.down : t.up, borderRadius: [3, 3, 0, 0] } })),
          barMaxWidth: 22,
          markLine:
            wacc != null
              ? { silent: true, symbol: "none", lineStyle: { color: t.fg, type: "dashed" }, label: { color: t.fg, formatter: `cost of capital ${(wacc * 100).toFixed(1)}%`, position: "insideEndTop" }, data: [{ yAxis: wacc }] }
              : undefined,
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, t, wacc],
  );
  // one plain headline per chart, from the numbers (the explanation lives in the title's info sheet)
  const lastOf = (m: string) => {
    for (let i = years.length - 1; i >= 0; i--) {
      const v = val(m, years[i]);
      if (v != null) return { y: years[i], v };
    }
    return null;
  };
  const om = lastOf("operating_margin");
  const om5 = om ? val("operating_margin", om.y - 5) : null;
  const marginHead = om
    ? `Operating margin ${(om.v * 100).toFixed(1)}% in FY${om.y}${om5 != null ? `, ${om.v >= om5 ? "up" : "down"} ${Math.abs((om.v - om5) * 100).toFixed(1)} points from FY${om.y - 5}` : ""}.`
    : "How much of each dollar of sales becomes profit.";
  const gi = revG.length - 1;
  const rg = revG[gi];
  const eg = epsG[gi];
  const growthHead =
    rg != null
      ? `Sales ${rg >= 0 ? "grew" : "fell"} ${Math.abs(rg * 100).toFixed(0)}% in FY${years[gi]}${eg != null ? `; earnings per share ${eg >= 0 ? "grew" : "fell"} ${Math.abs(eg * 100).toFixed(0)}%` : ""}${eg != null && rg != null ? (eg > rg + 0.02 ? " — profits growing faster than sales." : eg < rg - 0.02 ? " — profits lagging sales." : ".") : "."}`
      : "";
  const above = roic.filter((v) => v != null && wacc != null && v > wacc).length;
  const counted = roic.filter((v) => v != null).length;
  if (years.length < 3) return null;
  return (
    <section className="space-y-10">
      {present.length > 0 && (
        <div>
          <h3 className="flex items-center border-b border-border pb-3 text-xl font-semibold tracking-tight">
            <Term k="trend_margins" quiet>Margins over time</Term>
          </h3>
          <p className="mt-2 text-[15px]">{marginHead}</p>
          <EChart option={marginOpt} className="mt-3 h-72 w-full" ariaLabel="Gross, operating and free-cash-flow margins by fiscal year" />
        </div>
      )}
      {revG.some((v) => v != null) && (
        <div>
          <h3 className="flex items-center border-b border-border pb-3 text-xl font-semibold tracking-tight">
            <Term k="trend_sales_eps" quiet>Sales growth vs. earnings growth</Term>
          </h3>
          <p className="mt-2 text-[15px]">{growthHead}</p>
          <EChart option={growthOpt} className="mt-3 h-64 w-full" ariaLabel="Revenue growth and EPS growth by fiscal year" />
        </div>
      )}
      {counted > 2 && (
        <div className="pro-only">
          <h3 className="flex items-center border-b border-border pb-3 text-xl font-semibold tracking-tight">
            <Term k="trend_roic_wacc" quiet>Return on capital vs. cost of capital</Term>
          </h3>
          <p className="mt-2 text-[15px]">
            {wacc != null ? `Earned more than its cost of capital in ${above} of ${counted} years.` : "Return on the money invested in the business, by year."}
          </p>
          <EChart option={roicOpt} className="mt-3 h-56 w-full" ariaLabel="Return on invested capital by year versus cost of capital" />
        </div>
      )}
      {lastS && (
        <div>
          <h3 className="flex items-center border-b border-border pb-3 text-xl font-semibold tracking-tight">
            <Term k="trend_shares" quiet>Share count</Term>
          </h3>
          <p className="mt-2 text-[15px]">
            {" "}
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
