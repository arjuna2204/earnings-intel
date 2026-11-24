"use client";

import Term from "@/components/Term";
import ExportTable from "@/components/ExportTable";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import EChart from "@/components/EChart";
import SourcePanel from "@/components/SourcePanel";
import { useThemeColors } from "@/components/useThemeColors";
import type { Peer, PeerColumn, PeerComparison, PeerSet } from "@/lib/peers";
import type { Job, TickerHit } from "@/lib/types";

const GROUPS: { key: string; label: string }[] = [
  { key: "valuation", label: "Valuation" },
  { key: "growth", label: "Growth" },
  { key: "profitability", label: "Profitability" },
  { key: "street", label: "Street" },
  { key: "balance_sheet", label: "Balance sheet" },
];

function fmt(
  v: number | string | null | undefined,
  kind: PeerColumn["fmt"],
): string {
  if (v === null || v === undefined || typeof v === "string") return "—";
  if (kind === "money")
    return Math.abs(v) >= 1e12
      ? `$${(v / 1e12).toFixed(2)}T`
      : Math.abs(v) >= 1e9
        ? `$${(v / 1e9).toFixed(1)}B`
        : `$${(v / 1e6).toFixed(0)}M`;
  if (kind === "x") return `${v.toFixed(1)}x`;
  if (kind === "pct") return `${(v * 100).toFixed(1)}%`;
  return v.toFixed(2);
}

/** Peers tab: who it's compared with (editable), how it stacks up, ranking table, and a scatter plot. */
export default function PeersView({
  ticker,
  peerSet,
  comparison,
  initialJob,
  perf = [],
}: {
  ticker: string;
  peerSet: PeerSet | null;
  comparison: PeerComparison | null;
  initialJob: Job | null;
  perf?: { ticker: string; points: [string, number][] }[];
}) {
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(
    initialJob && ["queued", "running"].includes(initialJob.status)
      ? initialJob
      : null,
  );
  const [error, setError] = useState<string | null>(
    initialJob?.status === "failed" ? initialJob.message : null,
  );
  const [editing, setEditing] = useState(false);
  const [openFact, setOpenFact] = useState<string | null>(null);

  useEffect(() => {
    if (!job) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/jobs/${job.id}`);
      if (!res.ok) return;
      const { job: next } = (await res.json()) as { job: Job };
      if (["done", "failed", "deferred"].includes(next.status)) {
        setJob(null);
        if (next.status === "failed") setError(next.message);
        router.refresh();
      } else setJob(next);
    }, 3000);
    return () => clearInterval(t);
  }, [job, router]);

  const start = async (payload: { peers?: string[]; auto?: number }) => {
    setError(null);
    const res = await fetch("/api/peers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, ...payload }),
    });
    const data = (await res.json()) as { job?: Job; error?: string };
    if (!res.ok || !data.job) return setError(data.error ?? "Couldn't start");
    setJob(data.job);
    setEditing(false);
  };

  const peers = peerSet?.peers ?? [];
  const facts = comparison?.result.facts ?? {};
  const order: string[] = [];
  for (const c of comparison?.claims ?? [])
    for (const r of c.refs) if (!order.includes(r)) order.push(r);

  return (
    <div className="space-y-12">
      {/* Who it's compared with */}
      <section>
        <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
          <h3 className="flex items-center text-xl font-semibold tracking-tight">
            <Term k="peer_selection" quiet>
              Compared with
            </Term>
          </h3>
          {peers.length > 0 && !job && (
            <button
              onClick={() => setEditing(!editing)}
              className="text-sm font-semibold text-accent hover:underline"
            >
              {editing ? "Cancel" : "Edit peers"}
            </button>
          )}
        </div>
        {editing ? (
          <PeerEditor
            ticker={ticker}
            peers={peers}
            candidates={peerSet?.candidates ?? []}
            onSave={(list) => start({ peers: list })}
            onAuto={(n) => start({ auto: n })}
          />
        ) : peers.length ? (
          <ul className="divide-y divide-border">
            {peers.map((p) => (
              <li
                key={p.cik}
                className="flex items-baseline justify-between gap-4 py-3"
              >
                <span className="min-w-0">
                  <Link
                    href={`/c/${p.ticker}?tab=peers`}
                    className="font-semibold hover:underline"
                  >
                    {p.ticker}
                  </Link>
                  <span className="ml-2 text-muted">{p.name}</span>
                </span>
                <span
                  className="shrink-0 text-right text-sm text-muted"
                  title={p.quote ? `“${p.quote}”` : undefined}
                >
                  {p.reason}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          !job && (
            <div className="py-6">
              <p className="mb-4 text-muted">
                Peers are the competitors named in the company&apos;s 10-K plus
                companies in the same SEC industry with similar revenue. You can
                edit the list afterwards.
              </p>
              <button
                onClick={() => start({})}
                className="rounded-full bg-accent px-6 py-3 font-semibold text-black hover:brightness-110"
              >
                Find peers
              </button>
            </div>
          )
        )}
        {job && <JobLine job={job} />}
        {error && <p className="mt-3 text-sm text-down">{error}</p>}
      </section>

      {comparison && (
        <>
          {(comparison.claims ?? []).length > 0 && (
            <section>
              <h3 className="flex items-center mb-3 border-b border-border pb-3 text-xl font-semibold tracking-tight">
                <Term k="rank_strips" quiet>
                  How it stacks up
                </Term>
              </h3>
              <ul className="divide-y divide-border">
                {comparison.claims!.map((c, i) => (
                  <li
                    key={i}
                    className="py-3 text-[15px] leading-relaxed first:pt-0"
                  >
                    {c.text}
                    <sup className="ml-0.5">
                      {c.refs.map((r, k) => (
                        <button
                          key={r}
                          onClick={() => setOpenFact(r)}
                          className="px-px text-[11px] font-semibold text-accent hover:underline"
                        >
                          {order.indexOf(r) + 1}
                          {k < c.refs.length - 1 ? "," : ""}
                        </button>
                      ))}
                    </sup>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <RankTable comparison={comparison} ticker={ticker} />
          {perf.length > 1 && <Performance perf={perf} ticker={ticker} />}
          <Scatter comparison={comparison} ticker={ticker} />
          <p className="text-xs leading-relaxed text-muted">
            All values and ranks are calculated by the app from SEC filings
            (trailing twelve months), market prices and Alpha Vantage consensus.
            The summary is written by AI from those calculated facts and checked
            by code. Updated{" "}
            {new Date(comparison.created_at).toLocaleDateString()}.
          </p>
        </>
      )}
      {openFact && facts[openFact] && (
        <SourcePanel
          title="Calculated comparison"
          onClose={() => setOpenFact(null)}
        >
          <p className="leading-relaxed">{facts[openFact].text}</p>
          <p className="text-xs text-muted">
            Calculated by the app from each company&apos;s SEC financial data
            and market prices.
          </p>
        </SourcePanel>
      )}
    </div>
  );
}

function JobLine({ job }: { job: Job }) {
  const steps = Object.entries(job.steps ?? {});
  const last = steps.sort((a, b) => a[1].at.localeCompare(b[1].at)).at(-1);
  return (
    <p className="mt-4 text-sm text-muted" aria-live="polite">
      <span className="mr-2 inline-block h-2 w-2 rounded-full bg-accent" />
      {job.status === "queued" ? "Starting…" : (last?.[1].detail ?? "Working…")}
      <span className="block pl-4 text-xs">
        Loading new peers takes a minute or two each. You can leave this page.
      </span>
    </p>
  );
}

function PeerEditor({
  ticker,
  peers,
  candidates,
  onSave,
  onAuto,
}: {
  ticker: string;
  peers: Peer[];
  candidates: Peer[];
  onSave: (list: string[]) => void;
  onAuto: (n: number) => void;
}) {
  const [list, setList] = useState<{ ticker: string; name: string }[]>(
    peers.map((p) => ({ ticker: p.ticker, name: p.name })),
  );
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<TickerHit[]>([]);
  const [n, setN] = useState(5);
  useEffect(() => {
    if (!q.trim()) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (res.ok)
        setHits(((await res.json()) as { results: TickerHit[] }).results);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const add = (t: string, name: string) => {
    if (t === ticker || list.some((x) => x.ticker === t) || list.length >= 7)
      return;
    setList([...list, { ticker: t, name }]);
    setQ("");
    setHits([]);
  };
  const suggestions = candidates
    .filter((c) => !list.some((x) => x.ticker === c.ticker))
    .slice(0, 6);
  return (
    <div className="pt-2">
      <ul className="divide-y divide-border">
        {list.map((p) => (
          <li
            key={p.ticker}
            className="flex items-center justify-between gap-4 py-3"
          >
            <span>
              <b>{p.ticker}</b> <span className="text-muted">{p.name}</span>
            </span>
            <button
              onClick={() => setList(list.filter((x) => x.ticker !== p.ticker))}
              className="text-sm font-semibold text-down hover:underline"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="relative mt-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            list.length >= 7
              ? "Maximum of 7 peers"
              : "Add a company by ticker or name"
          }
          disabled={list.length >= 7}
          className="w-full rounded-xl border border-border bg-background px-4 py-3 outline-none focus:border-foreground"
        />
        {q.trim() && hits.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-background shadow-xl">
            {hits.map((h) => (
              <li key={h.ticker}>
                <button
                  onClick={() => add(h.ticker, h.name)}
                  className="flex w-full justify-between px-4 py-2.5 text-left hover:bg-card"
                >
                  <b>{h.ticker}</b>
                  <span className="truncate pl-4 text-muted">{h.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {suggestions.length > 0 && (
        <div className="mt-4 text-sm">
          <span className="text-muted">Suggested: </span>
          {suggestions.map((c) => (
            <button
              key={c.ticker}
              onClick={() => add(c.ticker, c.name)}
              title={c.reason}
              className="mr-3 font-semibold text-accent hover:underline"
            >
              + {c.ticker}
            </button>
          ))}
        </div>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          onClick={() => onSave(list.map((x) => x.ticker))}
          disabled={list.length < 3}
          className="rounded-full bg-accent px-6 py-2.5 font-semibold text-black hover:brightness-110 disabled:opacity-40"
        >
          Save and compare
        </button>
        <span className="text-sm text-muted">
          {list.length < 3 ? "Pick at least 3" : `${list.length} of 7`}
        </span>
        <span className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-muted">Or re-pick automatically:</span>
          <select
            value={n}
            onChange={(e) => setN(Number(e.target.value))}
            className="rounded-lg border border-border bg-background px-2 py-1"
          >
            {[3, 4, 5, 6, 7].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <button
            onClick={() => onAuto(n)}
            className="font-semibold text-accent hover:underline"
          >
            Re-pick
          </button>
        </span>
      </div>
    </div>
  );
}

function RankTable({
  comparison,
  ticker,
}: {
  comparison: PeerComparison;
  ticker: string;
}) {
  const { columns, rows, ranks, medians } = comparison.result;
  const groups = GROUPS.filter((g) => columns.some((c) => c.group === g.key));
  const [group, setGroup] = useState(groups[0]?.key ?? "valuation");
  const cols = columns.filter((c) => c.group === group);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const v = (r: (typeof rows)[number]) =>
      typeof r.m[sort.key] === "number" ? (r.m[sort.key] as number) : null;
    return [...rows].sort((a, b) => {
      const [x, y] = [v(a), v(b)];
      if (x === null) return 1;
      if (y === null) return -1;
      return (x - y) * sort.dir;
    });
  }, [rows, sort]);
  const sizeCol = columns.find((c) => c.key === "market_cap");
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-3">
        <h3 className="text-xl font-semibold tracking-tight">Side by side</h3>
        <div className="flex flex-wrap gap-1 text-sm" role="tablist">
          {groups.map((g) => (
            <button
              key={g.key}
              role="tab"
              aria-selected={group === g.key}
              onClick={() => {
                setGroup(g.key);
                setSort(null);
              }}
              className={`rounded-full px-3.5 py-1.5 font-semibold ${group === g.key ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground"}`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>
      <RankStrips cols={cols} rows={rows} ticker={ticker} />
      <div className="-mx-4 mt-6 overflow-x-auto px-4">
        <ExportTable name="peers">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-muted">
                <th className="sticky left-0 bg-background py-2 pr-4 text-left font-normal">
                  Company
                </th>
                {sizeCol && (
                  <th className="py-2 pr-4 text-right font-normal">
                    {sizeCol.label}
                  </th>
                )}
                {cols.map((c) => (
                  <th key={c.key} className="py-2 pl-4 text-right font-normal">
                    <button
                      onClick={() =>
                        setSort({
                          key: c.key,
                          dir: sort?.key === c.key && sort.dir === -1 ? 1 : -1,
                        })
                      }
                      className="hover:text-foreground"
                    >
                      {c.label}
                      {sort?.key === c.key
                        ? sort.dir === -1
                          ? " ↓"
                          : " ↑"
                        : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border border-t border-border">
              {sorted.map((r) => {
                const me = r.ticker === ticker;
                return (
                  <tr key={r.ticker} className={me ? "font-semibold" : ""}>
                    <td className="sticky left-0 bg-background py-3 pr-4">
                      {me ? (
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-accent" />
                          {r.ticker}
                        </span>
                      ) : (
                        <Link
                          href={`/c/${r.ticker}?tab=peers`}
                          className="pl-4 hover:underline"
                        >
                          {r.ticker}
                        </Link>
                      )}
                    </td>
                    {sizeCol && (
                      <td className="py-3 pr-4 text-right tabular-nums text-muted">
                        {fmt(r.m.market_cap, "money")}
                      </td>
                    )}
                    {cols.map((c) => (
                      <td
                        key={c.key}
                        className="py-3 pl-4 text-right tabular-nums"
                      >
                        {fmt(r.m[c.key], c.fmt)}
                        {me &&
                          ranks[c.key]?.[r.ticker] &&
                          Object.keys(ranks[c.key]).length > 2 && (
                            <span className="block text-[11px] font-normal text-muted">
                              #{ranks[c.key][r.ticker]} of{" "}
                              {Object.keys(ranks[c.key]).length}
                            </span>
                          )}
                      </td>
                    ))}
                  </tr>
                );
              })}
              <tr className="text-muted">
                <td className="sticky left-0 bg-background py-3 pr-4 pl-4">
                  Peer median
                </td>
                {sizeCol && (
                  <td className="py-3 pr-4 text-right tabular-nums">
                    {fmt(medians.market_cap, "money")}
                  </td>
                )}
                {cols.map((c) => (
                  <td key={c.key} className="py-3 pl-4 text-right tabular-nums">
                    {fmt(medians[c.key], c.fmt)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </ExportTable>
      </div>
      <p className="mt-2 text-xs text-muted">
        Ranks count from the highest value. Tap a column to sort.
      </p>
    </section>
  );
}

/** One line per metric: every company as a dot, this company highlighted — scan rank at a glance. */
function RankStrips({
  cols,
  rows,
  ticker,
}: {
  cols: PeerColumn[];
  rows: PeerComparison["result"]["rows"];
  ticker: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const usable = cols.filter(
    (c) => rows.filter((r) => typeof r.m[c.key] === "number").length >= 3,
  );
  if (!usable.length) return null;
  return (
    <ul className="divide-y divide-border" onMouseLeave={() => setHover(null)}>
      {usable.map((c) => {
        const pts = rows
          .filter((r) => typeof r.m[c.key] === "number")
          .map((r) => ({ t: r.ticker, v: r.m[c.key] as number }));
        const lo = Math.min(...pts.map((p) => p.v));
        const hi = Math.max(...pts.map((p) => p.v));
        const pos = (v: number) =>
          hi === lo ? 50 : ((v - lo) / (hi - lo)) * 100;
        const me = pts.find((p) => p.t === ticker);
        const rank = me
          ? [...pts]
              .sort((a, b) => b.v - a.v)
              .findIndex((p) => p.t === ticker) + 1
          : null;
        return (
          <li
            key={c.key}
            className="grid items-center gap-x-4 gap-y-1 py-3 sm:grid-cols-[11rem_1fr_6rem]"
          >
            <span className="text-sm">
              {c.label}
              {rank && (
                <span className="ml-2 text-xs text-muted">
                  #{rank} of {pts.length}
                </span>
              )}
            </span>
            <div className="relative mx-2 h-6">
              <div className="absolute left-0 right-0 top-3 h-px bg-border" />
              {pts.map((p) => {
                const mine = p.t === ticker;
                return (
                  <button
                    key={p.t}
                    onMouseEnter={() => setHover(`${c.key}:${p.t}`)}
                    onFocus={() => setHover(`${c.key}:${p.t}`)}
                    aria-label={`${p.t} ${fmt(p.v, c.fmt)}`}
                    className={`absolute top-3 -translate-x-1/2 -translate-y-1/2 rounded-full ${mine ? "z-10 h-3.5 w-3.5 bg-accent ring-2 ring-background" : "h-2.5 w-2.5 bg-muted/70 hover:bg-foreground"}`}
                    style={{ left: `${pos(p.v)}%` }}
                  >
                    {hover === `${c.key}:${p.t}` && (
                      <span className="absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[11px] font-semibold text-background">
                        {p.t} {fmt(p.v, c.fmt)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <span className="text-right text-sm font-semibold tabular-nums">
              {me ? fmt(me.v, c.fmt) : "—"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Performance({
  perf,
  ticker,
}: {
  perf: { ticker: string; points: [string, number][] }[];
  ticker: string;
}) {
  const theme = useThemeColors();
  const last = (p: { points: [string, number][] }) =>
    p.points[p.points.length - 1][1];
  const sorted = [...perf].sort((a, b) => last(b) - last(a));
  const option = useMemo(
    () => ({
      animation: false,
      grid: { left: 8, right: 56, top: 16, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: number) => `${(v - 100).toFixed(1)}%`,
      },
      xAxis: {
        type: "time",
        axisLabel: { color: theme.muted },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: {
          color: theme.muted,
          formatter: (v: number) => `${v - 100 >= 0 ? "+" : ""}${v - 100}%`,
        },
        splitLine: { lineStyle: { color: theme.grid } },
      },
      series: perf.map((p) => {
        const me = p.ticker === ticker;
        return {
          type: "line",
          name: p.ticker,
          data: p.points,
          showSymbol: false,
          z: me ? 10 : 1,
          lineStyle: {
            width: me ? 3 : 1.5,
            color: me ? theme.up : theme.muted,
            opacity: me ? 1 : 0.6,
          },
          itemStyle: { color: me ? theme.up : theme.muted },
          endLabel: {
            show: true,
            formatter: "{a}",
            color: me ? theme.up : theme.muted,
            fontWeight: me ? 700 : 400,
          },
          emphasis: { focus: "series" },
        };
      }),
    }),
    [perf, ticker, theme],
  );
  return (
    <section>
      <h3 className="flex items-center mb-1 border-b border-border pb-3 text-xl font-semibold tracking-tight">
        <Term k="peer_performance" quiet>
          1-year performance
        </Term>
      </h3>
      <p className="mt-2 text-sm text-muted">
        Total return including dividends, starting from the same point.{" "}
        {sorted.map((p, i) => (
          <span
            key={p.ticker}
            className={
              p.ticker === ticker ? "font-semibold text-foreground" : ""
            }
          >
            {p.ticker} {last(p) - 100 >= 0 ? "+" : ""}
            {(last(p) - 100).toFixed(0)}%{i < sorted.length - 1 ? " · " : ""}
          </span>
        ))}
      </p>
      <EChart
        option={option}
        className="mt-3 h-72 w-full"
        ariaLabel={`One-year return of ${ticker} versus peers`}
      />
    </section>
  );
}

function Scatter({
  comparison,
  ticker,
}: {
  comparison: PeerComparison;
  ticker: string;
}) {
  const theme = useThemeColors();
  const { columns, rows, medians } = comparison.result;
  const numeric = columns.filter(
    (c) =>
      c.key !== "market_cap" &&
      rows.filter((r) => typeof r.m[c.key] === "number").length >= 3,
  );
  const has = (k: string) => numeric.some((c) => c.key === k);
  const [xKey, setX] = useState(
    has("rev_growth") ? "rev_growth" : (numeric[0]?.key ?? ""),
  );
  const [yKey, setY] = useState(
    has("pe_fwd_ntm")
      ? "pe_fwd_ntm"
      : has("pe")
        ? "pe"
        : (numeric[1]?.key ?? ""),
  );
  const xc = columns.find((c) => c.key === xKey);
  const yc = columns.find((c) => c.key === yKey);
  const option = useMemo(() => {
    if (!xc || !yc) return {};
    const pts = rows
      .filter(
        (r) => typeof r.m[xKey] === "number" && typeof r.m[yKey] === "number",
      )
      .map((r) => ({
        name: r.ticker,
        value: [r.m[xKey] as number, r.m[yKey] as number],
        me: r.ticker === ticker,
      }));
    const axis = (c: PeerColumn) => ({
      type: "value" as const,
      scale: true,
      axisLabel: {
        color: theme.muted,
        formatter: (v: number) => fmt(v, c.fmt),
      },
      splitLine: { lineStyle: { color: theme.grid } },
      axisLine: { show: false },
    });
    const median = (k: string) => medians[k];
    return {
      animation: false,
      grid: { left: 8, right: 24, top: 16, bottom: 8, containLabel: true },
      xAxis: axis(xc),
      yAxis: axis(yc),
      tooltip: {
        trigger: "item",
        formatter: (p: { name: string; value: [number, number] }) =>
          `<b>${p.name}</b><br/>${xc.label}: ${fmt(p.value[0], xc.fmt)}<br/>${yc.label}: ${fmt(p.value[1], yc.fmt)}`,
      },
      series: [
        {
          type: "scatter",
          symbolSize: (_v: unknown, p: { data: { me: boolean } }) =>
            p.data.me ? 16 : 11,
          data: pts.map((p) => ({
            ...p,
            itemStyle: {
              color: p.me ? theme.up : theme.fg,
              opacity: p.me ? 1 : 0.55,
            },
          })),
          label: {
            show: true,
            position: "right",
            formatter: "{b}",
            color: theme.fg,
            fontWeight: 600,
            fontSize: 12,
          },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: theme.muted, type: "dashed", opacity: 0.5 },
            label: { show: false },
            data: [
              ...(median(xKey) != null
                ? [{ xAxis: median(xKey) as number }]
                : []),
              ...(median(yKey) != null
                ? [{ yAxis: median(yKey) as number }]
                : []),
            ],
          },
        },
      ],
    };
  }, [rows, xKey, yKey, xc, yc, theme, ticker, medians]);
  if (numeric.length < 2 || !xc || !yc) return null;
  const pick = (v: string, set: (k: string) => void, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <select
        value={v}
        onChange={(e) => set(e.target.value)}
        className="rounded-lg border border-border bg-background px-2 py-1 font-semibold"
      >
        {numeric.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-3">
        <h3 className="flex items-center text-xl font-semibold tracking-tight">
          <Term k="peer_scatter" quiet>
            Map
          </Term>
        </h3>
        <div className="flex flex-wrap gap-4">
          {pick(xKey, setX, "Across")}
          {pick(yKey, setY, "Up")}
        </div>
      </div>
      <EChart
        option={option}
        className="h-80 w-full sm:h-96"
        ariaLabel={`${yc.label} versus ${xc.label} for ${ticker} and peers`}
      />
      <p className="mt-2 text-xs text-muted">
        Dashed lines are the peer medians. {ticker} is the green dot.
      </p>
    </section>
  );
}
