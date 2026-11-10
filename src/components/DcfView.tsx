"use client";

import Term, { AboutNumbers } from "@/components/Term";
import ExportTable from "@/components/ExportTable";
import { useState } from "react";
import type { DcfModel } from "@/lib/dcf";

const pct = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : `${(v * 100).toFixed(d)}%`;
const bn = (v: number) =>
  Math.abs(v) >= 1e9
    ? `$${(v / 1e9).toFixed(1)}B`
    : `$${(v / 1e6).toFixed(0)}M`;
/** Cell tint: green above today's price, orange below, stronger the further away (capped at ±50%). */
function heat(diff: number): string {
  const a = Math.min(Math.abs(diff) / 0.5, 1) * 0.35;
  return diff >= 0 ? `rgba(0,200,5,${a})` : `rgba(255,80,0,${a})`;
}

function Bridge({
  r,
  netDebt,
  shares,
}: {
  r: NonNullable<DcfModel["result"]>;
  netDebt: number;
  shares: number;
}) {
  const steps: {
    label: string;
    from: number;
    to: number;
    kind: "add" | "sub" | "total";
  }[] = [];
  let run = 0;
  steps.push({
    label: "PV of 10 years of free cash flow",
    from: 0,
    to: r.sum_pv,
    kind: "add",
  });
  run = r.sum_pv;
  steps.push({
    label: "PV of terminal value (after year 10)",
    from: run,
    to: run + (r.pv_terminal ?? 0),
    kind: "add",
  });
  run += r.pv_terminal ?? 0;
  steps.push({ label: "Enterprise value", from: 0, to: run, kind: "total" });
  steps.push({
    label: netDebt >= 0 ? "− Net debt" : "+ Net cash",
    from: run,
    to: run - netDebt,
    kind: netDebt >= 0 ? "sub" : "add",
  });
  steps.push({
    label: "Equity value",
    from: 0,
    to: run - netDebt,
    kind: "total",
  });
  const hi = Math.max(...steps.map((x) => Math.max(x.from, x.to)), 1);
  const pos = (v: number) => (Math.max(v, 0) / hi) * 100;
  return (
    <div>
      <div className="flex items-center font-semibold">
        <Term k="value_bridge" quiet>
          Where the value comes from
        </Term>
      </div>
      <p className="mt-0.5 text-sm text-muted">
        {r.terminal_share != null &&
          `${Math.round(r.terminal_share * 100)}% of enterprise value comes after year 10 — the further out, the more the result depends on assumptions. `}
        Equity value ÷{" "}
        {(shares / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })}
        M shares = {r.per_share != null ? `$${r.per_share.toFixed(2)}` : "—"}{" "}
        per share.
      </p>
      <div className="mt-3 divide-y divide-border">
        {steps.map((x) => {
          const left = pos(Math.min(x.from, x.to));
          const width = Math.max(pos(Math.max(x.from, x.to)) - left, 0.6);
          return (
            <div
              key={x.label}
              className="grid grid-cols-[minmax(0,12rem)_1fr_5.5rem] items-center gap-4 py-2.5 text-sm sm:grid-cols-[16rem_1fr_6rem]"
            >
              <span
                className={x.kind === "total" ? "font-semibold" : "text-muted"}
              >
                {x.label}
              </span>
              <div className="relative h-2">
                <div
                  className={`absolute top-0 h-2 rounded-full ${x.kind === "total" ? "bg-foreground" : x.kind === "add" ? "bg-up" : "bg-down"}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              </div>
              <span
                className={`text-right tabular-nums ${x.kind === "total" ? "font-semibold" : ""}`}
              >
                {bn(Math.abs(x.to - (x.kind === "total" ? 0 : x.from)))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PCT_KEYS =
  /growth|margin|capex|tax|pct|risk_free|erp|cost_of_debt|weight|wacc/;

const DCF_INFO: Record<string, string> = {
  wacc: "wacc",
  terminal_growth: "terminal_growth",
  beta: "beta_dcf",
  sector_growth: "sector_growth",
  risk_free: "risk_free",
  erp: "erp",
  tax_rate: "tax_rate",
  cost_of_debt: "cost_of_debt",
  growth_1: "growth_fade",
  capex_1: "capex_fade",
};

/** DCF summary with sensitivity and assumptions; the Excel download has the same model with live formulas. */
function Notes({ ids }: { ids?: number[] }) {
  if (!ids?.length) return null;
  return (
    <sup className="ml-0.5 whitespace-nowrap">
      {ids.map((n, i) => (
        <a
          key={n}
          href={`#dcf-fn-${n}`}
          className="px-px text-[11px] font-semibold text-accent hover:underline"
        >
          {n}
          {i < ids.length - 1 ? "," : ""}
        </a>
      ))}
    </sup>
  );
}

export default function DcfView({
  ticker,
  dcf,
}: {
  ticker: string;
  dcf: DcfModel;
}) {
  const [all, setAll] = useState(false);
  if (dcf.status !== "ok" || !dcf.result) {
    return (
      <section>
        <h3 className="border-b border-border pb-3 text-xl font-semibold tracking-tight">
          DCF valuation
        </h3>
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
  const keys = Object.keys(a).filter(
    (k) => !/^(growth|margin|capex)_([2-9]|1\d)$/.test(k),
  );
  const shown = all
    ? keys
    : keys.filter((k) =>
        [
          "growth_1",
          "sector_growth",
          "margin_1",
          "capex_1",
          "wacc",
          "terminal_growth",
          "beta",
        ].includes(k),
      );
  const fmtA = (k: string, v: number) =>
    k === "price"
      ? `$${v.toFixed(2)}`
      : k === "shares"
        ? `${(v / 1e6).toFixed(0)}M`
        : k === "net_debt"
          ? bn(v)
          : k === "beta"
            ? v.toFixed(2)
            : PCT_KEYS.test(k)
              ? pct(v)
              : v.toFixed(2);
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-3">
        <h3 className="flex items-center text-xl font-semibold tracking-tight">
          <Term k="dcf" quiet>
            DCF valuation
          </Term>
        </h3>
        <div className="flex items-center gap-4">
          <AboutNumbers
            title="About the DCF"
            keys={[
              "dcf",
              "wacc",
              "beta_dcf",
              "risk_free",
              "erp",
              "cost_of_debt",
              "tax_rate",
              "growth_fade",
              "sector_growth",
              "capex_fade",
              "terminal_growth",
              "terminal_share",
              "implied_exit",
              "sensitivity",
              "value_bridge",
              "dcf_excel",
            ]}
          />
          <a
            href={`/api/dcf/${ticker}`}
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-black hover:brightness-110"
            download
          >
            Download Excel model
          </a>
        </div>
      </div>
      <div>
        <div className="text-sm text-muted">
          Value per share
          <Notes ids={r.model_notes} />
        </div>
        <div className="mt-1 text-4xl font-semibold tracking-tight tabular-nums">
          {r.per_share != null ? `$${r.per_share.toFixed(2)}` : "—"}
        </div>
        {price > 0 ? (
          <div
            className={`mt-1 font-semibold tabular-nums ${up >= 0 ? "text-up" : "text-down"}`}
          >
            {up >= 0 ? "▲" : "▼"} {Math.abs(up * 100).toFixed(1)}% vs. $
            {price.toFixed(2)} today
          </div>
        ) : (
          <div className="mt-1 text-sm text-muted">
            Share price not loaded yet — upside appears once prices arrive.
          </div>
        )}
        {dcf.note && <p className="mt-2 text-sm text-down">{dcf.note}</p>}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-border py-4 sm:grid-cols-4">
        {[
          ["Discount rate (WACC)", pct(a.wacc.value), "wacc"],
          ["Terminal growth", pct(a.terminal_growth.value), "terminal_growth"],
          ["Terminal value share", pct(r.terminal_share, 0), "terminal_share"],
          [
            "Implied exit EV/EBITDA",
            r.implied_exit_ev_ebitda
              ? `${r.implied_exit_ev_ebitda.toFixed(1)}x`
              : "—",
            "implied_exit",
          ],
        ].map(([k, v, info]) => (
          <div key={k}>
            <div className="flex items-center text-sm text-muted">
              <Term k={info} value={v}>
                {k}
              </Term>
            </div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      <div className="-mx-4 overflow-x-auto px-4">
        <ExportTable name="dcf">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="text-muted">
                <th className="sticky left-0 bg-background py-2 pr-4 text-left font-normal" />
                {r.rows.map((x) => (
                  <th key={x.year} className="py-2 pl-3 text-right font-normal">
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
                  <td className="sticky left-0 bg-background py-2.5 pr-4">
                    {label}
                  </td>
                  {r.rows.map((x) => (
                    <td
                      key={x.year}
                      className="py-2.5 pl-4 text-right tabular-nums"
                    >
                      {f(x)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ExportTable>
      </div>

      <Bridge r={r} netDebt={a.net_debt.value} shares={a.shares.value} />

      <div>
        <div className="flex items-center font-semibold">
          <Term k="sensitivity" quiet>
            Sensitivity
          </Term>
        </div>
        <p className="mt-0.5 text-sm text-muted">
          Value per share as the discount rate (down) and terminal growth
          (across) change. Green = above today&apos;s price.
        </p>
        <div className="-mx-4 mt-3 overflow-x-auto px-4">
          <ExportTable name="dcf">
            <table className="w-full min-w-[440px] text-sm tabular-nums">
              <thead>
                <tr className="text-muted">
                  <th className="py-2 pr-3 text-left font-normal">
                    WACC ↓ / growth →
                  </th>
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
                      <td
                        key={j}
                        className={`py-2.5 pl-3 pr-2 text-right ${v == null ? "text-muted" : v >= price ? "text-up" : "text-down"} ${i === 2 && j === 2 ? "font-bold outline outline-1 outline-foreground/40" : ""}`}
                        style={
                          v == null
                            ? undefined
                            : { background: heat(v / price - 1) }
                        }
                      >
                        {v == null ? "—" : `$${v.toFixed(0)}`}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ExportTable>
        </div>
      </div>

      <div>
        <div className="font-semibold">Assumptions</div>
        <ul className="mt-2 divide-y divide-border">
          {shown.map((k) => (
            <li
              key={k}
              className="flex items-baseline justify-between gap-4 py-2.5 text-sm"
            >
              <span className="min-w-0">
                <Term k={DCF_INFO[k]} value={fmtA(k, a[k].value)}>
                  {k === "growth_1"
                    ? a.sector_growth
                      ? `Revenue growth, years 1–2 (fades toward sector growth, then to ${pct(a.terminal_growth.value)} by year 10)`
                      : "Revenue growth, years 1–2 (fades to terminal by year 10)"
                    : k === "margin_1"
                      ? "Operating margin (all years)"
                      : k === "capex_1"
                        ? `Capex, % of revenue (year 1${a.capex_10 && a.capex_10.value !== a.capex_1.value ? ` → ${pct(a.capex_10.value)} by year 10` : ", all years"})`
                        : a[k].label}
                </Term>
                <Notes ids={a[k].notes} />
                <span className="mt-0.5 block text-xs text-muted">
                  {a[k].source}
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">
                {fmtA(k, a[k].value)}
              </span>
            </li>
          ))}
        </ul>
        <button
          onClick={() => setAll(!all)}
          className="mt-1 text-sm font-semibold text-accent hover:underline"
        >
          {all ? "Show fewer" : `Show all ${keys.length} assumptions`}
        </button>
      </div>
      {r.footnotes && r.footnotes.length > 0 && (
        <div>
          <div className="font-semibold">Footnotes</div>
          <ol className="mt-2 divide-y divide-border text-sm">
            {r.footnotes.map((f) => (
              <li
                key={f.id}
                id={`dcf-fn-${f.id}`}
                className="flex scroll-mt-24 gap-3 py-2.5 target:bg-accent/10"
              >
                <span className="w-5 shrink-0 font-semibold tabular-nums text-accent">
                  {f.id}
                </span>
                <span className="min-w-0 leading-relaxed">
                  {f.text}
                  {f.url && (
                    <>
                      {" "}
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        className="whitespace-nowrap font-semibold text-accent hover:underline"
                      >
                        Open on SEC.gov ↗
                      </a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
          {r.fy_notes && (
            <p className="mt-2 text-xs text-muted">
              Historical years:{" "}
              {Object.entries(r.fy_notes)
                .map(([fy, ids]) => `FY${fy} [${ids.join(", ") || "—"}]`)
                .join(" · ")}
            </p>
          )}
        </div>
      )}
      <p className="text-xs leading-relaxed text-muted">
        Built by code from SEC filings, analyst revenue consensus and market
        prices. Free cash flow = EBIT × (1 − tax) + D&amp;A − capex − increase
        in working capital, discounted at WACC; terminal value by the Gordon
        growth formula. Change any input in the Excel model — the value per
        share and sensitivity table recalculate. A model, not a forecast or
        advice. Updated {new Date(dcf.created_at).toLocaleDateString()}.
      </p>
    </section>
  );
}
