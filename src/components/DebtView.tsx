"use client";

import EChart from "@/components/EChart";
import Term, { AboutNumbers } from "@/components/Term";
import { useThemeColors } from "@/components/useThemeColors";

export type DebtProfile = {
  as_of: string | null;
  ladder: { label: string; value: number | null }[];
  avg_rate: number | null;
  credit: { capacity: number | null; available: number | null; drawn: number | null };
};
export type DebtTotals = { total_debt: number | null; cash: number | null; net_debt: number | null; interest: number | null; net_debt_to_ebitda: number | null; fcf: number | null };

const money = (v: number | null | undefined) =>
  v == null ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(v) >= 1e9 ? `${(Math.abs(v) / 1e9).toFixed(1)}B` : `${(Math.abs(v) / 1e6).toFixed(0)}M`}`;

/** What the company owes, when it comes due, and how easily it can pay — FactSet's capital-structure view, from SEC filings. */
export default function DebtView({ p, t }: { p: DebtProfile | null; t: DebtTotals }) {
  const th = useThemeColors();
  if (!t.total_debt && !p?.ladder.some((r) => r.value)) return null;
  const ladder = (p?.ladder ?? []).filter((r) => r.value != null);
  const next12 = p?.ladder[0]?.value ?? null;
  const cover = next12 && t.cash != null ? t.cash / next12 : null;
  const headline =
    t.net_debt != null && t.net_debt < 0
      ? `More cash (${money(t.cash)}) than debt (${money(t.total_debt)}).`
      : next12 && t.cash != null
        ? `${money(next12)} of debt comes due in the next 12 months; cash on hand covers it ${cover != null && cover >= 1 ? `${cover.toFixed(1)}×` : "only partly"}.`
        : `Total debt ${money(t.total_debt)}${t.net_debt_to_ebitda != null ? `, about ${t.net_debt_to_ebitda.toFixed(1)} years of EBITDA after cash` : ""}.`;
  const option = {
    animation: false,
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", valueFormatter: (v: number) => money(v) },
    xAxis: { type: "category", data: ladder.map((r) => r.label), axisLabel: { color: th.muted }, axisTick: { show: false } },
    yAxis: { type: "value", axisLabel: { color: th.muted, formatter: (v: number) => money(v) }, splitLine: { lineStyle: { color: th.grid } } },
    series: [{ type: "bar", data: ladder.map((r) => r.value), itemStyle: { color: th.muted, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 40 }],
  };
  const tiles: [string, string, string, string?][] = [
    ["Total debt", money(t.total_debt), "total_debt"],
    ["Cash", money(t.cash), "cash"],
    ["Net debt / EBITDA", t.net_debt_to_ebitda != null ? `${t.net_debt_to_ebitda.toFixed(1)}×` : "—", "net_debt_to_ebitda", "below 0 = more cash than debt"],
    ["Average interest rate", p?.avg_rate != null ? `${(p.avg_rate * 100).toFixed(2)}%` : "—", "avg_interest_rate"],
  ];
  if (p?.credit.capacity) tiles.push(["Unused credit line", money(p.credit.available ?? p.credit.capacity), "credit_line", `of ${money(p.credit.capacity)} committed`]);
  return (
    <section aria-label="Debt">
      <h2 className="flex items-center border-b border-border pb-3 text-xl font-semibold tracking-tight">
        <Term k="debt_ladder" quiet>Debt and when it comes due</Term>
      </h2>
      <p className="mt-2 text-[15px]">{headline}</p>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5">
        {tiles.map(([l, v, k, sub]) => (
          <div key={l}>
            <dt className="flex items-center text-xs text-muted">
              <Term k={k} value={v}>{l}</Term>
            </dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{v}</dd>
            {sub && <dd className="text-xs text-muted">{sub}</dd>}
          </div>
        ))}
      </dl>
      {ladder.length > 1 && (
        <>
          <h3 className="mt-6 text-sm font-semibold">Maturity schedule{p?.as_of ? ` (as of ${p.as_of})` : ""}</h3>
          <EChart option={option} className="mt-2 h-56 w-full" ariaLabel="Debt principal due by year" />
        </>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>From the latest 10-K&apos;s tagged data (SEC). Maturities are principal amounts; leases excluded.</span>
        <AboutNumbers title="About the debt numbers" keys={["debt_ladder", "total_debt", "net_debt_to_ebitda", "avg_interest_rate", "credit_line"]} />
      </div>
    </section>
  );
}
