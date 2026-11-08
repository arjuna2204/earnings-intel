"use client";

import { useState } from "react";
import type { DcfModel } from "@/lib/dcf";

const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const bn = (v: number) => (Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`);
const PCT_KEYS = /growth|margin|capex|tax|pct|risk_free|erp|cost_of_debt|weight|wacc/;

/** DCF summary with sensitivity and assumptions; the Excel download has the same model with live formulas. */
export default function DcfView({ ticker, dcf }: { ticker: string; dcf: DcfModel }) {
  const [all, setAll] = useState(false);
  if (dcf.status !== "ok" || !dcf.result) {
    return (
      <section>
        <h3 className="border-b border-border pb-3 text-xl font-semibold tracking-tight">DCF valuation</h3>
        <p className="mt-3 text-sm text-muted">{dcf.note}</p>
      </section>
    );
  }
  const r = dcf.result;
  const a = dcf.assumptions;
  const price = a.price.value;
  const up = r.upside ?? 0;
  const fy0 = Number(dcf.history[dcf.history.length - 1].fiscal_year);
  const s = r.sensitivity;
  const keys = Object.keys(a).filter((k) => !/^(growth|margin|capex)_[2-5]$/.test(k));
  const shown = all ? keys : keys.filter((k) => ["growth_1", "margin_1", "capex_1", "wacc", "terminal_growth", "beta"].includes(k));
  const fmtA = (k: string, v: number) =>
    k === "price" ? `$${v.toFixed(2)}` : k === "shares" ? `${(v / 1e6).toFixed(0)}M` : k === "net_debt" ? bn(v) : k === "beta" ? v.toFixed(2) : PCT_KEYS.test(k) ? pct(v) : v.toFixed(2);
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-3">
        <h3 className="text-xl font-semibold tracking-tight">DCF valuation</h3>
        <a href={`/api/dcf/${ticker}`} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-black hover:brightness-110" download>
          Download Excel model
        </a>
      </div>
      <div>
        <div className="text-sm text-muted">Value per share</div>
        <div className="mt-1 text-4xl font-semibold tracking-tight tabular-nums">{r.per_share != null ? `$${r.per_share.toFixed(2)}` : "—"}</div>
        <div className={`mt-1 font-semibold tabular-nums ${up >= 0 ? "text-up" : "text-down"}`}>
          {up >= 0 ? "▲" : "▼"} {Math.abs(up * 100).toFixed(1)}% vs. ${price.toFixed(2)} today
        </div>
        {dcf.note && <p className="mt-2 text-sm text-down">{dcf.note}</p>}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-border py-4 sm:grid-cols-4">
        {[
          ["Discount rate (WACC)", pct(a.wacc.value)],
          ["Terminal growth", pct(a.terminal_growth.value)],
          ["Terminal value share", pct(r.terminal_share, 0)],
          ["Implied exit EV/EBITDA", r.implied_exit_ev_ebitda ? `${r.implied_exit_ev_ebitda.toFixed(1)}x` : "—"],
        ].map(([k, v]) => (
          <div key={k}>
            <div className="text-sm text-muted">{k}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="text-muted">
              <th className="py-2 pr-4 text-left font-normal" />
              {r.rows.map((x) => (
                <th key={x.year} className="py-2 pl-4 text-right font-normal">
                  FY{fy0 + x.year}E
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border border-t border-border">
            {(
              [
                ["Revenue", (x) => bn(x.revenue)],
                ["Growth", (x) => pct(x.growth)],
                ["EBIT margin", (x) => pct(x.margin)],
                ["Free cash flow", (x) => bn(x.fcf)],
                ["Present value", (x) => bn(x.pv)],
              ] as [string, (x: (typeof r.rows)[number]) => string][]
            ).map(([label, f]) => (
              <tr key={label}>
                <td className="py-2.5 pr-4">{label}</td>
                {r.rows.map((x) => (
                  <td key={x.year} className="py-2.5 pl-4 text-right tabular-nums">
                    {f(x)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <div className="font-semibold">Sensitivity</div>
        <p className="mt-0.5 text-sm text-muted">Value per share as the discount rate (down) and terminal growth (across) change. Green = above today&apos;s price.</p>
        <div className="-mx-4 mt-3 overflow-x-auto px-4">
          <table className="w-full min-w-[440px] text-sm tabular-nums">
            <thead>
              <tr className="text-muted">
                <th className="py-2 pr-3 text-left font-normal">WACC ↓ / growth →</th>
                {s.growths.map((g) => (
                  <th key={g} className="py-2 pl-3 text-right font-normal">
                    {pct(g)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border border-t border-border">
              {s.waccs.map((w, i) => (
                <tr key={w}>
                  <td className="py-2.5 pr-3 text-muted">{pct(w)}</td>
                  {s.values[i].map((v, j) => (
                    <td key={j} className={`py-2.5 pl-3 text-right ${v == null ? "text-muted" : v >= price ? "text-up" : "text-down"} ${i === 2 && j === 2 ? "font-bold" : ""}`}>
                      {v == null ? "—" : `$${v.toFixed(0)}`}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="font-semibold">Assumptions</div>
        <ul className="mt-2 divide-y divide-border">
          {shown.map((k) => (
            <li key={k} className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
              <span className="min-w-0">
                {k === "growth_1"
                  ? "Revenue growth, year 1 (fades to terminal by year 5)"
                  : k === "margin_1"
                    ? "Operating margin (all years)"
                    : k === "capex_1"
                      ? `Capex, % of revenue (year 1${a.capex_5 && a.capex_5.value !== a.capex_1.value ? ` → ${pct(a.capex_5.value)} by year 5` : ", all years"})`
                      : a[k].label}
                <span className="mt-0.5 block text-xs text-muted">{a[k].source}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{fmtA(k, a[k].value)}</span>
            </li>
          ))}
        </ul>
        <button onClick={() => setAll(!all)} className="mt-1 text-sm font-semibold text-accent hover:underline">
          {all ? "Show fewer" : `Show all ${keys.length} assumptions`}
        </button>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        Built by code from SEC filings, analyst revenue consensus and market prices. Free cash flow = EBIT × (1 − tax) + D&amp;A − capex − increase in
        working capital, discounted at WACC; terminal value by the Gordon growth formula. Change any input in the Excel model — the value per share
        and sensitivity table recalculate. A model, not a forecast or advice. Updated {new Date(dcf.created_at).toLocaleDateString()}.
      </p>
    </section>
  );
}
