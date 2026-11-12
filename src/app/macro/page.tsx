import { connection } from "next/server";
import { Suspense } from "react";
import type { Metadata } from "next";
import MacroChart from "@/components/MacroCharts";
import { fmtMacro, getMacro, MACRO, reading, SECTOR_MACRO } from "@/lib/macro";
import { etfName } from "@/lib/etfs";
import { CBOE_ON } from "@/lib/flags";

export const metadata: Metadata = { title: "The economy" };

const ORDER = ["DGS10", "T10Y2Y", "DFF", "CPIAUCSL", "CPILFESL", "UNRATE", "PAYEMS", "A191RL1Q225SBEA", "BAMLH0A0HYM2", "VIXCLS", "DCOILWTICO", "MORTGAGE30US", "UMCSENT", "DGS2"];

export default function MacroPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6 pb-16 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">The economy</h1>
      <p className="mt-1 text-sm text-muted">The numbers that move whole sectors at once — rates, inflation, jobs, growth — over the last five years, from official sources.</p>
      <Suspense fallback={<div className="mt-8 h-96 animate-pulse rounded-2xl bg-card" />}>
        <Macro />
      </Suspense>
    </main>
  );
}

async function Macro() {
  await connection();
  const series = await getMacro(CBOE_ON ? ORDER : ORDER.filter((id) => id !== "VIXCLS"), 5);
  const by = new Map(series.map((s) => [s.id, s]));
  return (
    <>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {series.map((s) => {
          const m = MACRO[s.id];
          const r = reading(s);
          if (!m || !r) return null;
          const up = r.change != null && r.change > 0;
          return (
            <li key={s.id} className="rounded-2xl border border-border p-4">
              <div className="text-sm text-muted">{m.name}</div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums">{fmtMacro(s.id, r.last[1])}</span>
                {r.change != null && (
                  <span className="text-sm text-muted">
                    {up ? "▲" : "▼"} {Math.abs(r.change).toFixed(m.unit === "k" ? 0 : 2)}
                    {m.unit === "%" || m.unit === "pts" ? " pts" : ""} in 3 months
                  </span>
                )}
              </div>
              <div className="text-xs text-muted">as of {r.last[0]}</div>
              <MacroChart points={s.points} label={m.name} zero={s.id === "T10Y2Y" || s.id === "PAYEMS"} />
              <p className="mt-2 text-xs leading-snug text-muted">{m.why}</p>
            </li>
          );
        })}
      </ul>

      <section className="mt-12">
        <h2 className="border-b border-border pb-3 text-xl font-semibold tracking-tight">What matters for each sector</h2>
        <ul className="divide-y divide-border">
          {Object.entries(SECTOR_MACRO)
            .filter(([k]) => k !== "QQQ")
            .map(([etf, v]) => (
              <li key={etf} className="grid gap-1 py-3 sm:grid-cols-[14rem_1fr]">
                <span className="font-semibold">{etfName(etf) ?? etf}</span>
                <span className="text-sm">
                  {v.ids
                    .map((id) => {
                      const r = by.get(id) ? reading(by.get(id)!) : null;
                      return r ? `${MACRO[id].name} ${fmtMacro(id, r.last[1])}` : MACRO[id]?.name;
                    })
                    .join(" · ")}
                  <span className="block text-xs text-muted">{v.note}</span>
                </span>
              </li>
            ))}
        </ul>
      </section>
      <p className="mt-6 text-xs text-muted">Sources: US Treasury (yields), New York Fed (fed funds), Bureau of Labor Statistics (inflation, jobs), Cboe (VIX), St. Louis Fed FRED (the rest, when connected). Updated each morning. Inflation is the change from 12 months earlier.</p>
    </>
  );
}
