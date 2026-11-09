"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AnalyzePanel from "@/components/AnalyzePanel";
import EChart from "@/components/EChart";
import SearchBox from "@/components/SearchBox";
import { useThemeColors } from "@/components/useThemeColors";
import type { CompareSide } from "@/lib/compare";

type Ok = Extract<CompareSide, { status: "ok" }>;
type Fmt = "money" | "pct" | "x" | "usd";
type Better = "high" | "low" | null;

const BLUE = { dark: "#5b9dff", light: "#2563eb" };

function fmt(v: number | null | undefined, f: Fmt): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (f === "pct") return `${(v * 100).toFixed(1)}%`;
  if (f === "x") return `${v.toFixed(1)}×`;
  if (f === "usd") return `$${v.toFixed(2)}`;
  const a = Math.abs(v);
  const s = a >= 1e12 ? `${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(0)}M` : a.toFixed(0);
  return `${v < 0 ? "−" : ""}$${s}`;
}

const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(0)}%`;

export default function CompareView({ a, b }: { a: CompareSide; b: CompareSide }) {
  const router = useRouter();
  const tk = (s: CompareSide) => (s.status === "empty" ? "" : s.ticker);
  const go = (na: string, nb: string) => {
    const q = new URLSearchParams();
    if (na) q.set("a", na);
    if (nb) q.set("b", nb);
    router.push(`/compare?${q.toString()}`);
  };

  return (
    <div className="mt-6 space-y-10">
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
        <Slot side={a} onPick={(t) => go(t, tk(b))} label="First stock" />
        <button
          type="button"
          onClick={() => go(tk(b), tk(a))}
          disabled={a.status === "empty" && b.status === "empty"}
          aria-label="Swap sides"
          title="Swap sides"
          className="mt-2 rounded-full border border-border p-2 text-muted transition hover:text-foreground disabled:opacity-40"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />
          </svg>
        </button>
        <Slot side={b} onPick={(t) => go(tk(a), t)} label="Second stock" />
      </div>

      {a.status === "ok" && b.status === "ok" ? (
        a.ticker === b.ticker ? (
          <p className="rounded-xl bg-card px-4 py-3 text-sm text-muted">Pick two different stocks.</p>
        ) : (
          <Comparison a={a} b={b} />
        )
      ) : (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted">
          {a.status === "empty" || b.status === "empty"
            ? "Pick two stocks above to see them side by side."
            : "Both stocks need to be loaded before they can be compared. Loading uses only free data — no AI budget."}
        </p>
      )}
    </div>
  );
}

function Slot({ side, onPick, label }: { side: CompareSide; onPick: (t: string) => void; label: string }) {
  const [editing, setEditing] = useState(false);
  if (side.status === "empty" || editing) {
    return (
      <div>
        <p className="mb-2 text-xs text-muted">{label}</p>
        <SearchBox
          autoFocus={editing}
          placeholder="Ticker or company"
          onPick={(t) => {
            setEditing(false);
            onPick(t);
          }}
          onEscape={() => setEditing(false)}
        />
      </div>
    );
  }
  const change = (
    <button type="button" onClick={() => setEditing(true)} className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline">
      Change
    </button>
  );
  if (side.status === "not_found") {
    return (
      <div>
        <p className="text-lg font-semibold">{side.ticker}</p>
        <p className="text-sm text-muted">Not in the SEC&apos;s list of US-listed companies.</p>
        {change}
      </div>
    );
  }
  if (side.status === "not_loaded") {
    return (
      <div className="min-w-0">
        <p className="text-sm text-muted">
          {side.hit.ticker} · {side.hit.exchange} · {change}
        </p>
        <p className="mt-0.5 truncate text-lg font-semibold">{side.hit.name}</p>
        <div className="mt-3">
          <AnalyzePanel ticker={side.ticker} initialJob={side.job} mode="load" />
        </div>
      </div>
    );
  }
  const v = side.company.valuation;
  const p = side.prices;
  const day = p.length >= 2 ? p[p.length - 1][1] / p[p.length - 2][1] - 1 : null;
  return (
    <div className="min-w-0">
      <p className="text-sm text-muted">
        {side.ticker} · {side.company.sector_etf ?? side.company.exchange ?? "US"} · {change}
      </p>
      <Link href={`/c/${side.ticker}`} className="mt-0.5 block truncate text-lg font-semibold hover:underline sm:text-xl">
        {side.company.name}
      </Link>
      {v?.price != null && (
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          ${v.price.toFixed(2)}
          {day != null && (
            <span className={`ml-2 text-sm font-medium ${day >= 0 ? "text-up" : "text-down"}`}>
              {day >= 0 ? "▲" : "▼"} {Math.abs(day * 100).toFixed(2)}%
            </span>
          )}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- comparison body

type Row = { label: string; a: number | null | undefined; b: number | null | undefined; f: Fmt; better: Better; sub?: [string | null, string | null] };

function Comparison({ a, b }: { a: Ok; b: Ok }) {
  const theme = useThemeColors();
  const colors = { a: theme.fg, b: theme.dark ? BLUE.dark : BLUE.light };
  const va = a.company.valuation ?? null;
  const vb = b.company.valuation ?? null;
  const latest = (s: Ok, k: string) => s.fy[k]?.at(-1)?.[1] ?? null;
  const fyOf = (s: Ok) => s.fy.revenue?.at(-1)?.[0];

  const valuation: Row[] = [
    { label: "Market cap", a: va?.market_cap, b: vb?.market_cap, f: "money", better: null },
    { label: "P/E (TTM)", a: va?.pe, b: vb?.pe, f: "x", better: "low" },
    { label: "Forward P/E (next 12 mo.)", a: va?.pe_fwd_ntm, b: vb?.pe_fwd_ntm, f: "x", better: "low" },
    { label: "EV / EBITDA (TTM)", a: va?.ev_ebitda, b: vb?.ev_ebitda, f: "x", better: "low" },
    { label: "EV / Revenue (TTM)", a: va?.ev_revenue, b: vb?.ev_revenue, f: "x", better: "low" },
    { label: "Free-cash-flow yield (TTM)", a: va?.fcf_yield, b: vb?.fcf_yield, f: "pct", better: "high" },
  ];

  const vs = (value: number | null | undefined, price: number | null | undefined) =>
    value != null && price ? value / price - 1 : null;
  const street: Row[] = [
    {
      label: "DCF value per share",
      a: a.dcf?.per_share,
      b: b.dcf?.per_share,
      f: "usd",
      better: null,
      sub: [a.dcf?.upside != null ? `${signed(a.dcf.upside)} vs price` : a.dcf?.note ? "Not applicable" : null, b.dcf?.upside != null ? `${signed(b.dcf.upside)} vs price` : b.dcf?.note ? "Not applicable" : null],
    },
    { label: "DCF upside", a: a.dcf?.upside, b: b.dcf?.upside, f: "pct", better: "high" },
    { label: "Base case (12 mo.)", a: a.cases?.base, b: b.cases?.base, f: "usd", better: null, sub: [caseSub(a), caseSub(b)] },
    { label: "Base case upside", a: vs(a.cases?.base, a.cases?.price), b: vs(b.cases?.base, b.cases?.price), f: "pct", better: "high" },
    { label: "Bear case downside", a: vs(a.cases?.bear, a.cases?.price), b: vs(b.cases?.bear, b.cases?.price), f: "pct", better: "high" },
  ];

  const fundamentals: Row[] = [
    { label: "Revenue", a: latest(a, "revenue"), b: latest(b, "revenue"), f: "money", better: null },
    { label: "Revenue growth", a: latest(a, "revenue_growth_yoy"), b: latest(b, "revenue_growth_yoy"), f: "pct", better: "high" },
    { label: "EPS growth", a: latest(a, "eps_growth_yoy"), b: latest(b, "eps_growth_yoy"), f: "pct", better: "high" },
    { label: "Gross margin", a: latest(a, "gross_margin"), b: latest(b, "gross_margin"), f: "pct", better: "high" },
    { label: "Operating margin", a: latest(a, "operating_margin"), b: latest(b, "operating_margin"), f: "pct", better: "high" },
    { label: "Free-cash-flow margin", a: latest(a, "fcf_margin"), b: latest(b, "fcf_margin"), f: "pct", better: "high" },
    { label: "Return on invested capital", a: latest(a, "roic"), b: latest(b, "roic"), f: "pct", better: "high" },
    { label: "Return on equity", a: latest(a, "roe"), b: latest(b, "roe"), f: "pct", better: "high" },
    { label: "Net debt / EBITDA", a: latest(a, "net_debt_to_ebitda"), b: latest(b, "net_debt_to_ebitda"), f: "x", better: "low" },
    { label: "Current ratio", a: latest(a, "current_ratio"), b: latest(b, "current_ratio"), f: "x", better: "high" },
  ];

  const tally = (rows: Row[]) => {
    let ca = 0;
    let cb = 0;
    for (const r of rows) {
      const w = winner(r);
      if (w === "a") ca++;
      if (w === "b") cb++;
    }
    return { ca, cb };
  };
  const tv = tally(valuation);
  const ts = tally(street);
  const tf = tally(fundamentals);
  const lead = (t: { ca: number; cb: number }, what: string) =>
    t.ca === t.cb ? `Even on ${what} (${t.ca}–${t.cb})` : `${t.ca > t.cb ? a.ticker : b.ticker} ${what} ${Math.max(t.ca, t.cb)} of ${t.ca + t.cb}`;

  return (
    <>
      <section aria-label="Scorecard" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Score title="Valuation" text={lead(tv, "is cheaper on")} t={tv} a={a.ticker} b={b.ticker} colors={colors} />
        <Score title="Street & models" text={lead(ts, "has more upside on")} t={ts} a={a.ticker} b={b.ticker} colors={colors} />
        <Score title="Fundamentals" text={lead(tf, "is stronger on")} t={tf} a={a.ticker} b={b.ticker} colors={colors} />
      </section>

      <Performance a={a} b={b} colors={colors} />

      <Table title="Valuation" note="Lower multiples and a higher cash-flow yield mean you pay less for each dollar of earnings or cash. Cheaper isn't always better — fast growers usually cost more." rows={valuation} a={a.ticker} b={b.ticker} winLabel="cheaper" />
      <Table title="Street & models" note="DCF = this app's 10-year discounted-cash-flow model from SEC financials. Cases = analysts' low / consensus / high EPS × the stock's own forward P/E history." rows={street} a={a.ticker} b={b.ticker} winLabel="more upside" />
      <Table
        title="Fundamentals"
        note={`Latest fiscal year from SEC filings (${a.ticker} FY${fyOf(a) ?? "—"}, ${b.ticker} FY${fyOf(b) ?? "—"}). Fiscal years can end in different months.`}
        rows={fundamentals}
        a={a.ticker}
        b={b.ticker}
        winLabel="stronger"
      />

      <Trends a={a} b={b} colors={colors} />

      <p className="text-xs text-muted">
        Not investment advice. Every number links back through each company&apos;s page:{" "}
        <Link href={`/c/${a.ticker}`} className="underline">
          {a.ticker}
        </Link>{" "}
        ·{" "}
        <Link href={`/c/${b.ticker}`} className="underline">
          {b.ticker}
        </Link>
        .
      </p>
    </>
  );
}

function caseSub(s: Ok): string | null {
  if (!s.cases) return null;
  const { bear, bull, analysts } = s.cases;
  if (bear == null || bull == null) return null;
  return `range $${bear.toFixed(0)}–$${bull.toFixed(0)} · ${analysts} analysts`;
}

function winner(r: Row): "a" | "b" | null {
  if (!r.better || r.a == null || r.b == null || r.a === r.b) return null;
  if (r.f === "x" && r.better === "low") {
    // a negative P/E or EV/EBITDA means losses — never "cheaper"
    if (r.a <= 0 && r.b <= 0) return null;
    if (r.a <= 0) return "b";
    if (r.b <= 0) return "a";
  }
  return (r.better === "high" ? r.a > r.b : r.a < r.b) ? "a" : "b";
}

function Score({ title, text, t, a, b, colors }: { title: string; text: string; t: { ca: number; cb: number }; a: string; b: string; colors: { a: string; b: string } }) {
  const n = t.ca + t.cb;
  return (
    <div className="rounded-2xl border border-border p-4">
      <p className="text-xs text-muted">{title}</p>
      <p className="mt-1 font-semibold">{n ? text : "Not enough data"}</p>
      {n > 0 && (
        <>
          <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-card" aria-hidden>
            <div style={{ width: `${(t.ca / n) * 100}%`, background: colors.a }} />
            <div style={{ width: `${(t.cb / n) * 100}%`, background: colors.b }} />
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-muted">
            <span>
              {a} {t.ca}
            </span>
            <span>
              {t.cb} {b}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function Table({ title, note, rows, a, b, winLabel }: { title: string; note: string; rows: Row[]; a: string; b: string; winLabel: string }) {
  return (
    <section>
      <h2 className="border-b border-border pb-3 text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 text-sm text-muted">{note}</p>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-2 pr-3 font-normal">Measure</th>
            <th className="w-[30%] py-2 pr-3 text-right font-semibold text-foreground">{a}</th>
            <th className="w-[30%] py-2 text-right font-semibold text-foreground">{b}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const w = winner(r);
            const cell = (v: number | null | undefined, mine: "a" | "b", sub: string | null | undefined) => {
              const text = fmt(v, r.f);
              return (
                <td className={`py-2.5 text-right tabular-nums ${mine === "a" ? "pr-3" : ""}`}>
                  <span className={text == null ? "text-muted" : w === mine ? "font-semibold" : w ? "text-muted" : ""}>
                    {text ?? "Not reported"}
                  </span>
                  {w === mine && <span className="ml-1.5 rounded-full bg-card px-1.5 py-0.5 text-[10px] font-medium text-foreground">{winLabel}</span>}
                  {sub && <span className="block text-xs text-muted">{sub}</span>}
                </td>
              );
            };
            return (
              <tr key={r.label}>
                <td className="py-2.5 pr-3 text-muted">{r.label}</td>
                {cell(r.a, "a", r.sub?.[0])}
                {cell(r.b, "b", r.sub?.[1])}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------- charts

const RANGES = [
  ["1M", 1 / 12],
  ["6M", 0.5],
  ["1Y", 1],
  ["3Y", 3],
  ["5Y", 5],
] as const;

function Performance({ a, b, colors }: { a: Ok; b: Ok; colors: { a: string; b: string } }) {
  const theme = useThemeColors();
  const [range, setRange] = useState<(typeof RANGES)[number][0]>("1Y");
  const series = useMemo(() => {
    const years = RANGES.find((r) => r[0] === range)![1];
    const end = [a.prices.at(-1)?.[0], b.prices.at(-1)?.[0]].filter(Boolean).sort().at(-1);
    if (!end) return null;
    const d = new Date(`${end}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - Math.round(years * 365.25));
    // start both on the first date both have prices, so they're rebased to the same day
    const startA = a.prices.find((p) => p[0] >= d.toISOString().slice(0, 10))?.[0];
    const startB = b.prices.find((p) => p[0] >= d.toISOString().slice(0, 10))?.[0];
    if (!startA || !startB) return null;
    const start = startA > startB ? startA : startB;
    const rebase = (p: [string, number][]) => {
      const pts = p.filter((x) => x[0] >= start);
      if (!pts.length) return [];
      const base = pts[0][1];
      return pts.map(([dt, v]) => [dt, (v / base - 1) * 100] as [string, number]);
    };
    return { start, a: rebase(a.prices), b: rebase(b.prices) };
  }, [a.prices, b.prices, range]);

  const option = useMemo(
    () =>
      series && {
        animation: false,
        grid: { left: 8, right: 56, top: 16, bottom: 8, containLabel: true },
        tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` },
        xAxis: { type: "time", axisLabel: { color: theme.muted }, splitLine: { show: false } },
        yAxis: { type: "value", scale: true, axisLabel: { color: theme.muted, formatter: (v: number) => `${v > 0 ? "+" : ""}${v}%` }, splitLine: { lineStyle: { color: theme.grid } } },
        series: (
          [
            [a.ticker, series.a, colors.a],
            [b.ticker, series.b, colors.b],
          ] as const
        ).map(([name, data, color]) => ({
          type: "line",
          name,
          data,
          showSymbol: false,
          lineStyle: { width: 2, color },
          itemStyle: { color },
          endLabel: { show: true, formatter: "{a}", color, fontWeight: 600 },
        })),
      },
    [series, theme, colors, a.ticker, b.ticker],
  );
  const ret = (pts: [string, number][] | undefined) => (pts?.length ? pts[pts.length - 1][1] : null);
  const ra = ret(series?.a);
  const rb = ret(series?.b);

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <h2 className="text-xl font-semibold tracking-tight">Performance</h2>
        <div className="flex gap-1" role="tablist" aria-label="Time range">
          {RANGES.map(([r]) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={range === r}
              onClick={() => setRange(r)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${range === r ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      {series && option ? (
        <>
          <p className="mt-2 text-sm text-muted">
            Total return including dividends since {series.start}:{" "}
            {[
              [a.ticker, ra],
              [b.ticker, rb],
            ].map(([t, r], i) => (
              <span key={String(t)}>
                {i > 0 && " · "}
                <b className="text-foreground">{t}</b>{" "}
                {r != null && (
                  <span className={(r as number) >= 0 ? "text-up" : "text-down"}>
                    {(r as number) >= 0 ? "▲" : "▼"} {Math.abs(r as number).toFixed(1)}%
                  </span>
                )}
              </span>
            ))}
          </p>
          <EChart option={option} className="mt-3 h-72 w-full" ariaLabel={`Return of ${a.ticker} versus ${b.ticker}`} />
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">Not enough price history for this range.</p>
      )}
    </section>
  );
}

const TREND_METRICS: { key: string; label: string; f: Fmt }[] = [
  { key: "revenue_growth_yoy", label: "Revenue growth", f: "pct" },
  { key: "operating_margin", label: "Operating margin", f: "pct" },
  { key: "fcf_margin", label: "FCF margin", f: "pct" },
  { key: "roic", label: "ROIC", f: "pct" },
  { key: "gross_margin", label: "Gross margin", f: "pct" },
  { key: "revenue", label: "Revenue", f: "money" },
];

function Trends({ a, b, colors }: { a: Ok; b: Ok; colors: { a: string; b: string } }) {
  const theme = useThemeColors();
  const available = TREND_METRICS.filter((m) => (a.fy[m.key]?.length ?? 0) >= 2 || (b.fy[m.key]?.length ?? 0) >= 2);
  const [key, setKey] = useState(available[0]?.key ?? "");
  const m = available.find((x) => x.key === key) ?? available[0];
  const option = (() => {
    if (!m) return null;
    const sa = (a.fy[m.key] ?? []).slice(-10);
    const sb = (b.fy[m.key] ?? []).slice(-10);
    const years = [...new Set([...sa, ...sb].map((x) => x[0]))].sort((x, y) => x - y);
    const val = (s: [number, number][], y: number) => s.find((x) => x[0] === y)?.[1] ?? null;
    return {
      animation: false,
      grid: { left: 8, right: 56, top: 16, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", valueFormatter: (v: number | null) => fmt(v, m.f) ?? "Not reported" },
      xAxis: { type: "category", data: years.map((y) => `FY${y}`), axisLabel: { color: theme.muted }, axisTick: { show: false } },
      yAxis: { type: "value", scale: m.f !== "money", axisLabel: { color: theme.muted, formatter: (v: number) => fmt(v, m.f) }, splitLine: { lineStyle: { color: theme.grid } } },
      series: (
        [
          [a.ticker, sa, colors.a],
          [b.ticker, sb, colors.b],
        ] as const
      ).map(([name, s, color]) => ({
        type: "line",
        name,
        data: years.map((y) => val(s, y)),
        connectNulls: true,
        symbolSize: 6,
        lineStyle: { width: 2, color },
        itemStyle: { color },
        endLabel: { show: true, formatter: "{a}", color, fontWeight: 600 },
      })),
    };
  })();
  if (!m || !option) return null;
  return (
    <section>
      <h2 className="border-b border-border pb-3 text-xl font-semibold tracking-tight">10-year trends</h2>
      <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Metric">
        {available.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={x.key === m.key}
            onClick={() => setKey(x.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${x.key === m.key ? "border-foreground bg-foreground text-background" : "border-border text-muted hover:text-foreground"}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-muted">Fiscal years from SEC filings. Each company&apos;s fiscal year may end in a different month.</p>
      <EChart option={option} className="mt-3 h-72 w-full" ariaLabel={`${m.label} of ${a.ticker} versus ${b.ticker} by fiscal year`} />
    </section>
  );
}
