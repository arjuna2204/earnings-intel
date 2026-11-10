"use client";

import { useMemo, useState } from "react";
import EChart from "@/components/EChart";
import Term, { AboutNumbers } from "@/components/Term";
import ShowNumbers from "@/components/ShowNumbers";
import { useThemeColors } from "@/components/useThemeColors";

export type SegmentRow = {
  axis: "segment" | "product" | "region";
  measure: "revenue" | "operating_income";
  member: string;
  label: string;
  fiscal_year: number;
  fiscal_period: string;
  value: number;
  source: string;
  adds_up: boolean | null;
};

const AXIS_LABEL = {
  segment: "Business segments",
  product: "Products & services",
  region: "Regions",
} as const;
// categorical, never green/red (those mean up/down)
const PALETTE = [
  "#5b9dff",
  "#a78bfa",
  "#22d3ee",
  "#f59e0b",
  "#f472b6",
  "#94a3b8",
  "#eab308",
  "#60a5fa",
];
const MAX_LINES = 7;

const money = (v: number) => {
  const a = Math.abs(v);
  const s =
    a >= 1e9 ? `$${(a / 1e9).toFixed(1)}B` : `$${(a / 1e6).toFixed(0)}M`;
  return v < 0 ? `−${s}` : s;
};

export default function SegmentsView({ rows }: { rows: SegmentRow[] }) {
  const t = useThemeColors();
  const axes = (["segment", "product", "region"] as const).filter(
    (a) =>
      new Set(
        rows
          .filter((r) => r.axis === a && r.measure === "revenue")
          .map((r) => r.member),
      ).size >= 2,
  );
  const [axis, setAxis] = useState<(typeof axes)[number] | null>(null);
  const [freq, setFreq] = useState<"annual" | "quarterly">("annual");
  const active = axis && axes.includes(axis) ? axis : axes[0];

  const view = useMemo(() => {
    if (!active) return null;
    const rev = rows.filter(
      (r) => r.axis === active && r.measure === "revenue",
    );
    const want = (r: SegmentRow) =>
      freq === "annual" ? r.fiscal_period === "FY" : r.fiscal_period !== "FY";
    const order = (fy: number, fp: string) =>
      fy * 10 + (fp === "FY" ? 5 : Number(fp.slice(1)));
    const periods = [
      ...new Map(
        rev
          .filter(want)
          .map((r) => [
            `${r.fiscal_year}${r.fiscal_period}`,
            [r.fiscal_year, r.fiscal_period] as const,
          ]),
      ).values(),
    ]
      .sort((a, b) => order(...a) - order(...b))
      .slice(freq === "annual" ? -5 : -12);
    if (!periods.length) return null;
    const val = (m: string, fy: number, fp: string, measure = "revenue") =>
      rows.find(
        (r) =>
          r.axis === active &&
          r.measure === measure &&
          r.member === m &&
          r.fiscal_year === fy &&
          r.fiscal_period === fp,
      )?.value ?? null;
    const [lfy, lfp] = periods[periods.length - 1];
    const labels = new Map(rev.map((r) => [r.member, r.label]));
    // biggest lines in the latest period first; the long tail goes into "Other"
    const members = [...labels.keys()]
      .filter((m) => periods.some(([fy, fp]) => val(m, fy, fp) != null))
      .sort(
        (a, b) =>
          (val(b, lfy, lfp) ?? -Infinity) - (val(a, lfy, lfp) ?? -Infinity),
      );
    const top =
      members.length > MAX_LINES ? members.slice(0, MAX_LINES - 1) : members;
    const rest = members.filter((m) => !top.includes(m));
    const total = (fy: number, fp: string) =>
      members.reduce((s, m) => s + (val(m, fy, fp) ?? 0), 0);
    const prior = (fy: number, fp: string) => [fy - 1, fp] as const; // same quarter (or year) a year earlier
    const table = members.map((m) => {
      const now = val(m, lfy, lfp);
      const before = val(m, ...prior(lfy, lfp));
      const oi = val(m, lfy, lfp, "operating_income");
      return {
        member: m,
        label: labels.get(m) ?? m,
        now,
        share:
          now != null && total(lfy, lfp) > 0 ? now / total(lfy, lfp) : null,
        growth:
          now != null && before != null && before > 0 ? now / before - 1 : null,
        margin: oi != null && now ? oi / now : null,
      };
    });
    const addsUp = rev.find((r) => r.adds_up != null)?.adds_up ?? null;
    const derived = rev.some((r) => r.source === "derived" && want(r));
    return {
      periods,
      top,
      rest,
      val,
      table,
      addsUp,
      derived,
      latest: freq === "annual" ? `FY${lfy}` : `${lfp} FY${lfy}`,
    };
  }, [rows, active, freq]);

  if (!active || !view) {
    return null; // nothing broken out (or only one line): the section stays hidden
  }

  const x = view.periods.map(([fy, fp]) =>
    fp === "FY" ? `FY${String(fy).slice(2)}` : `${fp} '${String(fy).slice(2)}`,
  );
  const series = [
    ...view.top.map((m, i) => ({
      name: view.table.find((r) => r.member === m)?.label ?? m,
      data: view.periods.map(([fy, fp]) => view.val(m, fy, fp)),
      color: PALETTE[i % PALETTE.length],
    })),
    ...(view.rest.length
      ? [
          {
            name: `Other (${view.rest.length})`,
            data: view.periods.map(([fy, fp]) =>
              view.rest.reduce((s, m) => s + (view.val(m, fy, fp) ?? 0), 0),
            ),
            color: t.muted,
          },
        ]
      : []),
  ];
  const option = {
    animation: false,
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    legend: { top: 0, type: "scroll", textStyle: { color: t.muted } },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      valueFormatter: (v: number) => (v == null ? "—" : money(v)),
    },
    xAxis: {
      type: "category",
      data: x,
      axisLabel: { color: t.muted },
      axisLine: { lineStyle: { color: t.grid } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: t.muted, formatter: (v: number) => money(v) },
      splitLine: { lineStyle: { color: t.grid } },
    },
    series: series.map((s) => ({
      type: "bar",
      stack: "rev",
      name: s.name,
      data: s.data,
      itemStyle: { color: s.color },
      barMaxWidth: 36,
    })),
  };
  const hasMargin = view.table.some((r) => r.margin != null);
  // headline: the biggest line, and the fastest grower among lines worth at least 5% of revenue
  const big = view.table[0];
  const fast = [...view.table]
    .filter((r) => r.growth != null && (r.share ?? 0) >= 0.05)
    .sort((a, b) => (b.growth ?? 0) - (a.growth ?? 0))[0];
  const headline =
    big?.share != null
      ? `${big.label} is ${(big.share * 100).toFixed(0)}% of revenue${fast && fast.member !== big.member && fast.growth != null ? `; fastest growing: ${fast.label} (${fast.growth >= 0 ? "+" : "−"}${Math.abs(fast.growth * 100).toFixed(0)}%)` : fast?.growth != null ? ` and ${fast.growth >= 0 ? "grew" : "shrank"} ${Math.abs(fast.growth * 100).toFixed(0)}%` : ""}.`
      : null;

  return (
    <section aria-label="Revenue breakdown">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <h2 className="text-xl font-semibold tracking-tight">
          <Term k="segments" quiet>
            Where the revenue comes from
          </Term>
        </h2>
        <div
          className="flex gap-1"
          role="tablist"
          aria-label="Annual or quarterly"
        >
          {(["annual", "quarterly"] as const).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={freq === f}
              onClick={() => setFreq(f)}
              className={`rounded-full px-3 py-1 text-sm font-semibold ${freq === f ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
            >
              {f === "annual" ? "Annual" : "Quarterly"}
            </button>
          ))}
        </div>
      </div>
      {headline && <p className="mt-2 text-[15px]">{headline}</p>}
      {axes.length > 1 && (
        <div
          className="mt-3 flex flex-wrap gap-1"
          role="tablist"
          aria-label="Breakdown"
        >
          {axes.map((a) => (
            <button
              key={a}
              role="tab"
              aria-selected={active === a}
              onClick={() => setAxis(a)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${active === a ? "bg-card text-foreground" : "text-muted hover:text-foreground"}`}
            >
              {AXIS_LABEL[a]}
            </button>
          ))}
        </div>
      )}

      <EChart
        option={option}
        className="mt-4 h-72 w-full"
        ariaLabel={`Revenue by ${AXIS_LABEL[active].toLowerCase()}`}
      />

      <ShowNumbers>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm tabular-nums">
            <thead className="text-xs text-muted">
              <tr className="border-b border-border">
                <th scope="col" className="py-2 text-left font-medium">
                  {view.latest}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Revenue
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Share
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  <Term k="revenue_growth_yoy" quiet>
                    vs a year ago
                  </Term>
                </th>
                {hasMargin && (
                  <th scope="col" className="py-2 text-right font-medium">
                    <Term k="segment_margin" quiet>
                      Op. margin
                    </Term>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {view.table.map((r) => (
                <tr key={r.member}>
                  <td className="max-w-[16rem] truncate py-2 pr-3">
                    {r.label}
                  </td>
                  <td className="py-2 text-right">
                    {r.now != null ? money(r.now) : "—"}
                  </td>
                  <td className="py-2 text-right text-muted">
                    {r.share != null ? `${(r.share * 100).toFixed(0)}%` : "—"}
                  </td>
                  <td
                    className={`py-2 text-right ${r.growth == null ? "text-muted" : r.growth >= 0 ? "text-up" : "text-down"}`}
                  >
                    {r.growth == null
                      ? "—"
                      : `${r.growth >= 0 ? "▲" : "▼"} ${Math.abs(r.growth * 100).toFixed(1)}%`}
                  </td>
                  {hasMargin && (
                    <td className="py-2 text-right">
                      {r.margin != null
                        ? `${(r.margin * 100).toFixed(1)}%`
                        : "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ShowNumbers>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          From each 10-K and 10-Q&apos;s XBRL data (SEC), in the company&apos;s
          own categories.
          {view.addsUp === false &&
            " These lines don't cover all revenue; the company doesn't break out the rest."}
          {view.derived && " Q4 = full year minus the first three quarters."}
        </span>
        <AboutNumbers
          title="About the revenue breakdown"
          keys={["segments", ...(hasMargin ? ["segment_margin"] : [])]}
        />
      </div>
    </section>
  );
}
