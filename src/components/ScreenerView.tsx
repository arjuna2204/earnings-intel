"use client";

import { useMemo, useState } from "react";
import ExportTable from "@/components/ExportTable";
import Link from "next/link";
import Term, { AboutNumbers } from "@/components/Term";
import type { ScreenRow } from "@/lib/screener";

type Key = keyof ScreenRow;
type Col = {
  key: Key;
  label: string;
  term: string;
  fmt: (v: number, r: ScreenRow) => string;
  signed?: boolean;
};

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const x = (v: number) => `${v.toFixed(1)}×`;
const cap = (v: number) =>
  v >= 1e12
    ? `$${(v / 1e12).toFixed(2)}T`
    : v >= 1e9
      ? `$${(v / 1e9).toFixed(0)}B`
      : `$${(v / 1e6).toFixed(0)}M`;

const VIEWS: Record<string, { label: string; cols: Col[] }> = {
  value: {
    label: "Valuation",
    cols: [
      { key: "marketCap", label: "Market cap", term: "market_cap", fmt: cap },
      { key: "pe", label: "P/E", term: "pe", fmt: x },
      { key: "fwdPe", label: "Fwd P/E", term: "pe_fwd_ntm", fmt: x },
      { key: "evEbitda", label: "EV/EBITDA", term: "ev_ebitda", fmt: x },
      { key: "fcfYield", label: "FCF yield", term: "fcf_yield", fmt: pct },
      {
        key: "divYield",
        label: "Div. yield",
        term: "dividend_yield",
        fmt: pct,
      },
      {
        key: "dcfUpside",
        label: "DCF vs price",
        term: "dcf",
        fmt: pct,
        signed: true,
      },
    ],
  },
  growth: {
    label: "Growth & quality",
    cols: [
      {
        key: "revGrowth",
        label: "Revenue growth",
        term: "revenue_growth_yoy",
        fmt: pct,
        signed: true,
      },
      {
        key: "opMargin",
        label: "Op. margin",
        term: "operating_margin",
        fmt: pct,
      },
      { key: "roic", label: "ROIC", term: "roic", fmt: pct },
      {
        key: "fscore",
        label: "F-score",
        term: "piotroski",
        fmt: (v) => `${v}/9`,
      },
    ],
  },
  risk: {
    label: "Price & risk",
    cols: [
      {
        key: "ret1y",
        label: "1Y return",
        term: "vs_benchmark",
        fmt: pct,
        signed: true,
      },
      { key: "beta", label: "Beta", term: "beta", fmt: (v) => v.toFixed(2) },
      { key: "vol", label: "Volatility", term: "volatility", fmt: pct },
      {
        key: "expectedMove",
        label: "Earnings move",
        term: "earnings_day_move",
        fmt: (v) => `±${(v * 100).toFixed(1)}%`,
      },
    ],
  },
};

type Preset = {
  key: string;
  label: string;
  test: (r: ScreenRow) => boolean;
  hint: string;
};
const weekAhead = () =>
  new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const PRESETS: Preset[] = [
  { key: "all", label: "All", test: () => true, hint: "" },
  {
    key: "value",
    label: "Lower P/E",
    test: (r) => r.pe != null && r.pe > 0 && r.pe < 20,
    hint: "P/E under 20",
  },
  {
    key: "growth",
    label: "Fast growers",
    test: (r) => (r.revGrowth ?? -1) >= 0.15,
    hint: "Revenue up 15%+ vs a year ago",
  },
  {
    key: "quality",
    label: "Strong financials",
    test: (r) => (r.fscore ?? 0) >= 7,
    hint: "Piotroski F-score 7 or more",
  },
  {
    key: "income",
    label: "Dividend payers",
    test: (r) => (r.divYield ?? 0) >= 0.02,
    hint: "Dividend yield 2%+",
  },
  {
    key: "dcf",
    label: "Below DCF value",
    test: (r) => (r.dcfUpside ?? -1) > 0.1,
    hint: "Our DCF is 10%+ above the price (a model, not a promise)",
  },
  {
    key: "week",
    label: "Reports this week",
    test: (r) => r.nextEarnings != null && r.nextEarnings <= weekAhead(),
    hint: "Earnings in the next 7 days",
  },
];

export default function ScreenerView({ rows }: { rows: ScreenRow[] }) {
  const [view, setView] = useState<keyof typeof VIEWS>("value");
  const [preset, setPreset] = useState("all");
  const [sector, setSector] = useState("");
  const [onlyFull, setOnlyFull] = useState(false);
  const [sort, setSort] = useState<{ key: Key; desc: boolean }>({
    key: "marketCap",
    desc: true,
  });

  const sectors = useMemo(
    () =>
      [
        ...new Set(
          rows.map((r) => r.sector).filter((s): s is string => Boolean(s)),
        ),
      ].sort(),
    [rows],
  );
  const p = PRESETS.find((x) => x.key === preset)!;
  const cols = VIEWS[view].cols;

  const shown = rows
    .filter(
      (r) =>
        p.test(r) &&
        (!sector || r.sector === sector) &&
        (!onlyFull || !r.basic),
    )
    .sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // blanks always last
      if (bv == null) return -1;
      const c =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sort.desc ? -c : c;
    });

  const head = (key: Key, label: React.ReactNode, right = true) => (
    <th
      scope="col"
      className={`whitespace-nowrap px-3 py-2 font-medium ${right ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() =>
          setSort((s) => ({
            key,
            desc: s.key === key ? !s.desc : key !== "ticker",
          }))
        }
        className="inline-flex items-center gap-1 hover:text-foreground"
        aria-label={`Sort by ${typeof label === "string" ? label : String(key)}`}
      >
        {label}
        <span className="w-2 text-[10px]" aria-hidden>
          {sort.key === key ? (sort.desc ? "▼" : "▲") : ""}
        </span>
      </button>
    </th>
  );

  return (
    <div className="mt-5">
      <div
        className="flex flex-wrap gap-1.5"
        role="radiogroup"
        aria-label="Quick screens"
      >
        {PRESETS.map((x) => (
          <button
            key={x.key}
            type="button"
            role="radio"
            aria-checked={preset === x.key}
            onClick={() => setPreset(x.key)}
            title={x.hint}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${preset === x.key ? "bg-foreground text-background" : "bg-card text-muted hover:text-foreground"}`}
          >
            {x.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
        <div
          className="flex gap-1"
          role="tablist"
          aria-label="Columns"
        >
          {Object.entries(VIEWS).map(([k, v]) => (
            <button
              key={k}
              role="tab"
              aria-selected={view === k}
              onClick={() => setView(k)}
              className={`rounded-full px-3 py-1 text-sm font-semibold ${view === k ? "text-foreground" : "text-muted hover:text-foreground"}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-muted">
            <input
              type="checkbox"
              checked={onlyFull}
              onChange={(e) => setOnlyFull(e.target.checked)}
            />
            Full research only
          </label>
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            aria-label="Sector"
            className="rounded-full border border-border bg-transparent px-3 py-1 text-sm"
          >
            <option value="">All sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="mt-2 text-xs text-muted">
        {shown.length} of {rows.length} companies{p.hint ? ` · ${p.hint}` : ""}.
        Tap a column to sort.
      </p>

      <div className="mt-2 overflow-x-auto">
        <ExportTable name="screener">
          <table className="w-full min-w-[40rem] text-sm tabular-nums">
            <thead className="text-xs text-muted">
              <tr className="border-b border-border">
                {head("ticker", "Company", false)}
                {head("price", "Price")}
                {cols.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className="whitespace-nowrap px-3 py-2 text-right font-medium"
                  >
                    <span className="inline-flex items-center gap-1">
                      <Term k={c.term} quiet>
                        {c.label}
                      </Term>
                      <button
                        type="button"
                        onClick={() =>
                          setSort((s) => ({
                            key: c.key,
                            desc: s.key === c.key ? !s.desc : true,
                          }))
                        }
                        className="w-3 text-[10px] hover:text-foreground"
                        aria-label={`Sort by ${c.label}`}
                      >
                        {sort.key === c.key ? (sort.desc ? "▼" : "▲") : "↕"}
                      </button>
                    </span>
                  </th>
                ))}
                {head("nextEarnings", "Next report")}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => (
                <tr key={r.ticker} className="hover:bg-card">
                  <td className="max-w-[14rem] px-3 py-2.5">
                    <Link
                      href={`/c/${encodeURIComponent(r.ticker)}`}
                      className="block"
                    >
                      <span className="font-semibold">{r.ticker}</span>
                      {r.basic && (
                        <span
                          className="ml-1.5 rounded-full border border-border px-1.5 py-px text-[10px] text-muted"
                          title="Basic data only. Open to load full research."
                        >
                          Basic
                        </span>
                      )}
                      <span className="block truncate text-xs text-muted">
                        {r.name}
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {r.price != null ? `$${r.price.toFixed(2)}` : "—"}
                  </td>
                  {cols.map((c) => {
                    const v = r[c.key];
                    if (typeof v !== "number") {
                      return (
                        <td
                          key={c.key}
                          className="px-3 py-2.5 text-right text-muted"
                        >
                          —
                        </td>
                      );
                    }
                    const tone = c.signed
                      ? v >= 0
                        ? "text-up-ink"
                        : "text-down-ink"
                      : "";
                    return (
                      <td
                        key={c.key}
                        className={`px-3 py-2.5 text-right ${tone}`}
                      >
                        {c.signed ? (v >= 0 ? "▲ " : "▼ ") : ""}
                        {c.signed ? c.fmt(Math.abs(v), r) : c.fmt(v, r)}
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-muted">
                    {r.nextEarnings
                      ? new Date(
                          `${r.nextEarnings}T12:00:00Z`,
                        ).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          timeZone: "UTC",
                        })
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ExportTable>
      </div>
      {shown.length === 0 && (
        <p className="py-8 text-center text-sm text-muted">
          No companies match. Try another screen or sector.
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          The 500 largest US companies. &quot;Basic&quot; rows use SEC
          financials and delayed prices only; open one to load full research
          (risk, options, DCF, calls). Not investment advice.
        </span>
        <AboutNumbers
          title="About the screener numbers"
          keys={cols.map((c) => c.term)}
        />
      </div>
    </div>
  );
}
