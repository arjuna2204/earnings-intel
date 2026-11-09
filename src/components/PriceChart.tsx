"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import EChart from "@/components/EChart";
import Term from "@/components/Term";
import { useThemeColors } from "@/components/useThemeColors";
import type { PricePoint } from "@/lib/types";

const RANGES = [
  { key: "1M", days: 31 },
  { key: "3M", days: 92 },
  { key: "1Y", days: 366 },
  { key: "5Y", days: 5 * 366 },
  { key: "15Y", days: 15 * 366 },
] as const;

// comparison lines: dashed, never green/red (those mean up/down)
const PALETTE = ["#9ca3af", "#5b9dff", "#a78bfa", "#f59e0b", "#22d3ee", "#f472b6", "#eab308", "#94a3b8"];
const STORE = "ei.chartCompare";

type Marker = { date: string; label: string; href?: string };
type Price = Pick<PricePoint, "date" | "adj_close">;
export type CompareLine = { ticker: string; label: string; prices: Price[] };
export type CompareChoice = { ticker: string; name: string; kind: "fund" | "stock" };

function readStore(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

function writeStore(list: string[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(list));
  } catch {
    /* storage blocked */
  }
}

/** A comparison's values on the stock's dates (last close on or before each day). */
function align(series: Price[], other: Price[]): (number | null)[] {
  const out: (number | null)[] = [];
  let j = 0;
  let last: number | null = null;
  for (const p of series) {
    while (j < other.length && other[j].date <= p.date) last = other[j++].adj_close;
    out.push(last);
  }
  return out;
}

export default function PriceChart({
  ticker,
  prices,
  defaults = [],
  choices = [],
  markers,
  currencySymbol = "$",
  emptyNote,
  markerNote = "○ = earnings report · tap to open that call",
}: {
  ticker: string;
  prices: PricePoint[];
  /** shown automatically: the S&P 500 and the company's sector fund */
  defaults?: CompareLine[];
  /** what the "Add" box can find: comparison funds and loaded stocks */
  choices?: CompareChoice[];
  markers: Marker[];
  currencySymbol?: string;
  emptyNote?: string;
  markerNote?: string;
}) {
  const colors = useThemeColors();
  const router = useRouter();
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("1Y");
  const [hover, setHover] = useState<number | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [added, setAdded] = useState<CompareLine[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // user-added comparisons are remembered in this browser and shown on every stock
  useEffect(() => {
    let live = true;
    const want = readStore().filter((t) => t !== ticker && !defaults.some((d) => d.ticker === t));
    Promise.all(want.map((t) => fetchLine(t, choices))).then((lines) => {
      if (live) setAdded(lines.filter((l): l is CompareLine => l !== null));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per stock
  }, [ticker]);

  const series = useMemo(() => {
    if (!prices.length) return [];
    const days = RANGES.find((r) => r.key === range)!.days;
    const last = new Date(prices[prices.length - 1].date);
    const cutoff = new Date(last.getTime() - days * 86400000).toISOString().slice(0, 10);
    return prices.filter((p) => p.date >= cutoff);
  }, [prices, range]);

  const lines = useMemo(() => {
    const all = [...defaults, ...added];
    return all.map((l, i) => ({ ...l, color: PALETTE[i % PALETTE.length], values: series.length ? align(series, l.prices) : [] }));
  }, [defaults, added, series]);

  if (!prices.length) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-2xl bg-card px-6 text-center text-muted">
        <span>No price history yet</span>
        {emptyNote && <span className="max-w-md text-sm">{emptyNote}</span>}
      </div>
    );
  }

  // Adjusted close keeps long ranges continuous across splits/dividends; the headline shows the actual close.
  const first = series[0];
  const latest = series[series.length - 1];
  const idx = hover ?? series.length - 1;
  const shown = series[idx];
  const change = shown.adj_close - first.adj_close;
  const pct = change / first.adj_close;
  const up = change >= 0;
  const color = up ? colors.up : colors.down;
  const ret = (v: (number | null)[]) => (v[0] && v[idx] != null ? (v[idx] as number) / (v[0] as number) - 1 : null);

  const inRange = markers.filter((m) => m.date >= first.date && m.date <= latest.date);
  const dateIndex = new Map(series.map((p, i) => [p.date, i]));
  const placed = inRange
    .map((m) => {
      const i = dateIndex.get(m.date) ?? series.findIndex((p) => p.date >= m.date);
      return i >= 0 ? { m, point: { coord: [i, series[i].adj_close], name: m.label, value: m.label } } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const option = {
    animationDuration: 300,
    grid: { left: 0, right: 0, top: 8, bottom: 8 },
    xAxis: { type: "category", data: series.map((p) => p.date), show: false, boundaryGap: false },
    yAxis: { type: "value", show: false, scale: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: colors.muted, width: 1 } },
      formatter: () => "",
      backgroundColor: "transparent",
      borderWidth: 0,
      extraCssText: "box-shadow:none",
    },
    series: [
      {
        type: "line",
        name: ticker,
        z: 3,
        data: series.map((p) => p.adj_close),
        showSymbol: false,
        lineStyle: { color, width: 2 },
        itemStyle: { color },
        markPoint: {
          symbol: "circle",
          symbolSize: 8,
          itemStyle: { color: colors.card, borderColor: colors.muted, borderWidth: 2 },
          label: { show: false },
          data: placed.map((x) => x.point),
        },
      },
      // each comparison is drawn on the stock's scale: where the stock would be had it matched that fund
      ...lines
        .filter((l) => !hidden.includes(l.ticker) && l.values[0])
        .map((l) => ({
          type: "line",
          name: l.ticker,
          z: 2,
          data: l.values.map((v) => (v == null ? null : (first.adj_close * v) / (l.values[0] as number))),
          showSymbol: false,
          connectNulls: true,
          lineStyle: { color: l.color, width: 1.5, type: "dashed" },
          itemStyle: { color: l.color },
        })),
    ],
  };

  const vs = lines.slice(0, 2).filter((l) => !hidden.includes(l.ticker));

  async function add(t: string) {
    setError(null);
    t = t.toUpperCase();
    if (t === ticker || lines.some((l) => l.ticker === t)) return;
    setLoading(t);
    const line = await fetchLine(t, choices);
    setLoading(null);
    if (!line) {
      setError(`${t} isn't available to chart yet — load it first (search it at the top of the page).`);
      return;
    }
    setAdded((a) => [...a, line]);
    writeStore([...readStore().filter((x) => x !== t), t]);
  }

  function remove(t: string) {
    setAdded((a) => a.filter((l) => l.ticker !== t));
    writeStore(readStore().filter((x) => x !== t));
  }

  return (
    <section aria-label="Price chart" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div>
        <div className="mb-3">
          <div className="text-4xl font-semibold tracking-tight">
            {currencySymbol}
            {shown.close.toFixed(2)}
          </div>
          <div className="mt-1 text-sm font-medium" style={{ color }}>
            {up ? "▲ +" : "▼ −"}
            {currencySymbol}
            {Math.abs(change).toFixed(2)} ({up ? "+" : "−"}
            {Math.abs(pct * 100).toFixed(2)}%){" "}
            <span className="text-muted">
              <Term k="adjusted_price">{hover !== null ? shown.date : `past ${range}`} · adjusted for splits & dividends</Term>
            </span>
          </div>
          {vs.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
              {vs.map((l) => {
                const r = ret(l.values);
                if (r == null) return null;
                const d = pct - r;
                return (
                  <span key={l.ticker}>
                    <span className={`font-medium ${d >= 0 ? "text-up" : "text-down"}`}>
                      <Term k="vs_benchmark">
                        {d >= 0 ? "▲ Beat" : "▼ Trailed"} {l.label} by {Math.abs(d * 100).toFixed(1)} pts
                      </Term>
                    </span>
                    <span className="text-muted">
                      {" "}
                      ({r >= 0 ? "+" : "−"}
                      {Math.abs(r * 100).toFixed(1)}%)
                    </span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <EChart
          onHoverIndex={setHover}
          onClick={(p) => {
            if (p.componentType === "markPoint") {
              const href = placed[p.dataIndex]?.m.href;
              if (href) router.push(href, { scroll: false });
            }
          }}
          option={option}
          className="h-64 w-full sm:h-80"
          ariaLabel={`Price over ${range}: ${up ? "up" : "down"} ${Math.abs(pct * 100).toFixed(1)} percent`}
        />
        <div className="mt-2 flex items-center justify-between border-b border-border pb-3">
          <div className="flex gap-1" role="tablist" aria-label="Chart range">
            {RANGES.map((r) => (
              <button
                key={r.key}
                role="tab"
                aria-selected={range === r.key}
                onClick={() => {
                  setRange(r.key);
                  setHover(null);
                }}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${range === r.key ? "text-background" : "text-muted hover:text-foreground"}`}
                style={range === r.key ? { background: color } : undefined}
              >
                {r.key}
              </button>
            ))}
          </div>
          <span className="hidden text-xs text-muted sm:inline">{markerNote}</span>
        </div>
      </div>

      <aside aria-label="Compare on chart" className="lg:pt-2">
        <h2 className="flex items-center text-sm font-semibold">
          <Term k="chart_compare" quiet>Compare on chart</Term>
        </h2>
        <ul className="mt-2 divide-y divide-border text-sm">
          <li className="flex items-center gap-2 py-2">
            <span className="h-0.5 w-5 shrink-0 rounded" style={{ background: color }} aria-hidden />
            <span className="font-semibold">{ticker}</span>
            <span className="ml-auto tabular-nums" style={{ color }}>
              {up ? "+" : "−"}
              {Math.abs(pct * 100).toFixed(1)}%
            </span>
            <span className="w-4" />
          </li>
          {lines.map((l) => {
            const r = ret(l.values);
            const off = hidden.includes(l.ticker);
            const isDefault = defaults.some((d) => d.ticker === l.ticker);
            return (
              <li key={l.ticker} className="flex items-center gap-2 py-2">
                <button
                  type="button"
                  onClick={() => setHidden((h) => (off ? h.filter((x) => x !== l.ticker) : [...h, l.ticker]))}
                  aria-pressed={!off}
                  title={off ? "Show on chart" : "Hide from chart"}
                  className={`flex min-w-0 flex-1 items-center gap-2 text-left ${off ? "opacity-40" : ""}`}
                >
                  <svg width="20" height="4" className="shrink-0" aria-hidden>
                    <line x1="0" y1="2" x2="20" y2="2" stroke={l.color} strokeWidth="2" strokeDasharray="4 3" />
                  </svg>
                  <span className="font-medium">{l.ticker}</span>
                  <span className="truncate text-xs text-muted">{l.label !== l.ticker ? l.label : ""}</span>
                </button>
                <span className="tabular-nums text-muted">{r == null ? "—" : `${r >= 0 ? "+" : "−"}${Math.abs(r * 100).toFixed(1)}%`}</span>
                {isDefault ? (
                  <span className="w-4" />
                ) : (
                  <button type="button" onClick={() => remove(l.ticker)} aria-label={`Remove ${l.ticker}`} className="w-4 text-xs text-muted hover:text-foreground">
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <AddBox choices={choices.filter((c) => c.ticker !== ticker && !lines.some((l) => l.ticker === c.ticker))} onAdd={add} loading={loading} />
        {error && <p className="mt-2 text-xs text-muted">{error}</p>}
        <p className="mt-3 text-xs text-muted">Returns over the selected range, dividends included. Click a line to hide it. Added comparisons are remembered in this browser.</p>
      </aside>
    </section>
  );
}

async function fetchLine(t: string, choices: CompareChoice[]): Promise<CompareLine | null> {
  try {
    const r = await fetch(`/api/prices?t=${encodeURIComponent(t)}`);
    if (!r.ok) return null;
    const j = (await r.json()) as { prices: Price[] };
    if (!j.prices?.length) return null;
    const c = choices.find((x) => x.ticker === t);
    return { ticker: t, label: c?.name ?? t, prices: j.prices };
  } catch {
    return null;
  }
}

function AddBox({ choices, onAdd, loading }: { choices: CompareChoice[]; onAdd: (t: string) => void; loading: string | null }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const query = q.trim().toUpperCase();
  const matches = (
    query
      ? choices.filter((c) => c.ticker.startsWith(query) || c.name.toUpperCase().includes(query))
      : choices.filter((c) => c.kind === "fund")
  ).slice(0, 8);
  const pick = (t: string) => {
    onAdd(t);
    setQ("");
    setOpen(false);
  };
  return (
    <div ref={box} className="relative mt-3">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, matches.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter") {
            e.preventDefault();
            if (matches[active]) pick(matches[active].ticker);
            else if (query) pick(query);
          } else if (e.key === "Escape") setOpen(false);
        }}
        placeholder={loading ? `Adding ${loading}…` : "Add an ETF or stock"}
        aria-label="Add an ETF or stock to the chart"
        className="w-full rounded-full border border-border bg-transparent px-4 py-2 text-sm outline-none placeholder:text-muted focus:border-foreground"
      />
      {open && matches.length > 0 && (
        <ul className="absolute inset-x-0 top-11 z-30 max-h-72 overflow-auto rounded-2xl border border-border bg-background p-1 shadow-xl">
          {!query && <li className="px-3 py-1.5 text-xs text-muted">Popular funds</li>}
          {matches.map((c, i) => (
            <li key={c.ticker}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c.ticker);
                }}
                className={`flex w-full items-baseline gap-2 rounded-xl px-3 py-2 text-left text-sm ${i === active ? "bg-card" : ""}`}
              >
                <span className="font-semibold">{c.ticker}</span>
                <span className="truncate text-xs text-muted">{c.name}</span>
                <span className="ml-auto text-[10px] uppercase text-muted">{c.kind === "fund" ? "ETF" : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
