"use client";

import Term from "@/components/Term";
import ExportTable from "@/components/ExportTable";
import { useEffect, useMemo, useState } from "react";
import EChart from "@/components/EChart";
import SourcePanel from "@/components/SourcePanel";
import { useThemeColors } from "@/components/useThemeColors";
import type {
  CallAnalysis,
  CallComparison,
  GuidanceChange,
  GuidanceItem,
  PriceReaction,
  Quoted,
  TopicChange,
  ToneRates,
} from "@/lib/types";

type TonePoint = {
  fiscal_year: number;
  fiscal_quarter: number;
  executives: Partial<Record<"prepared" | "qa" | "all", ToneRates>>;
  avg_evasiveness: number | null;
};

type Panel =
  | {
      kind: "quote";
      title: string;
      period: "a" | "b";
      item: Quoted;
      extra?: React.ReactNode;
    }
  | {
      kind: "exchange";
      title: string;
      period: "a" | "b";
      turns: number[];
      extra?: React.ReactNode;
    }
  | null;

const pct = (x: number | null | undefined, d = 1) =>
  x == null ? "—" : `${(x * 100).toFixed(d)}%`;
const signed = (x: number | null | undefined, d = 1) =>
  x == null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(d)}%`;

function unitText(u: string | null): { pre: string; post: string } {
  const s = (u ?? "").toLowerCase();
  if (s.includes("%"))
    return {
      pre: "",
      post: s.includes("growth") || s.includes("y/y") ? "% y/y" : "%",
    };
  if (s.includes("bps")) return { pre: "", post: " bps" };
  if (s.includes("billion")) return { pre: "$", post: "B" };
  if (s.includes("million")) return { pre: "$", post: "M" };
  if (s.includes("usd") || s.includes("$")) return { pre: "$", post: "" };
  return { pre: "", post: u ? ` ${u}` : "" };
}

export function fmtGuide(g: GuidanceItem | null): string {
  if (!g) return "—";
  if (g.withdrawn) return "Withdrawn";
  const { pre, post } = unitText(g.unit);
  if (g.low != null && g.high != null)
    return `${pre}${g.low}–${pre}${g.high}${post}`;
  if (g.point != null) return `${pre}${g.point}${post}`;
  if (g.low != null) return `≥ ${pre}${g.low}${post}`;
  if (g.high != null) return `≤ ${pre}${g.high}${post}`;
  return "Qualitative";
}

const CHANGE_STYLE: Record<
  string,
  { icon: string; cls: string; text: string }
> = {
  raised: { icon: "▲", cls: "text-up", text: "Raised" },
  lowered: { icon: "▼", cls: "text-down", text: "Lowered" },
  maintained: { icon: "●", cls: "text-muted", text: "Maintained" },
  new: { icon: "✚", cls: "text-foreground", text: "New" },
  withdrawn: { icon: "✕", cls: "text-down", text: "Withdrawn" },
  "not repeated": { icon: "○", cls: "text-muted", text: "Not repeated" },
  "changed basis": { icon: "≠", cls: "text-muted", text: "Different basis" },
  qualitative: { icon: "~", cls: "text-muted", text: "Qualitative" },
  expanded: { icon: "▲", cls: "text-up", text: "More airtime" },
  reduced: { icon: "▼", cls: "text-down", text: "Less airtime" },
  dropped: { icon: "✕", cls: "text-down", text: "Dropped" },
  steady: { icon: "●", cls: "text-muted", text: "Steady" },
};

function Chip({ change }: { change: string }) {
  const s = CHANGE_STYLE[change] ?? {
    icon: "•",
    cls: "text-muted",
    text: change,
  };
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-card px-2.5 py-1 text-xs font-semibold ${s.cls}`}
    >
      <span aria-hidden>{s.icon}</span>
      {s.text}
    </span>
  );
}

export default function CallView({
  cik,
  comparison,
  a,
  b,
  trend,
}: {
  cik: number;
  comparison: CallComparison;
  a: CallAnalysis;
  b: CallAnalysis;
  trend: TonePoint[];
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const la = comparison.period_a;
  const lb = comparison.period_b;
  const per = {
    a: [a.fiscal_year, a.fiscal_quarter] as const,
    b: [b.fiscal_year, b.fiscal_quarter] as const,
  };
  const cost = Number(a.cost_usd) + Number(b.cost_usd);

  return (
    <div className="space-y-10">
      {comparison.partial && (
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
          ⚠ Part of this comparison is incomplete:{" "}
          {[a.note, b.note].filter(Boolean).join(" · ")}
        </p>
      )}

      <PriceReactions
        la={la}
        lb={lb}
        pa={a.price_reaction}
        pb={b.price_reaction}
      />

      <Section
        title="Guidance"
        info="guidance_changes"
        subtitle={`${la} → ${lb} · labels computed in code from the numbers management gave`}
      >
        <GuidanceTable
          rows={comparison.guidance}
          la={la}
          lb={lb}
          onPick={(row) => setPanel(guidancePanel(row, la, lb))}
        />
      </Section>

      <Section
        title="Topics"
        info="topics_airtime"
        subtitle="Matched across calls; airtime = share of the call's words spent on the topic"
      >
        <Topics
          rows={comparison.topics}
          onPick={(t) => setPanel(topicPanel(t))}
        />
      </Section>

      <Section
        title="Tone by executive"
        info="tone_by_exec"
        subtitle="Loughran-McDonald finance word lists — hedging, positive and negative words as a share of words (free, no AI)"
      >
        <ToneTable a={a} b={b} la={la} lb={lb} />
      </Section>

      <Section
        title="Tone over time"
        info="tone_over_time"
        subtitle="Executives, whole call. History fills in as quarters load (up to 8)."
      >
        <ToneTrend
          points={trend}
          highlight={[`FY${per.a[0]}Q${per.a[1]}`, `FY${per.b[0]}Q${per.b[1]}`]}
        />
      </Section>

      <Section
        title="Q&A evasiveness hot spots"
        info="dodged_questions"
        subtitle="How directly management answered each analyst question (0 = direct, 1 = avoided). Scored by Claude Haiku."
      >
        <Evasiveness
          la={la}
          lb={lb}
          a={a}
          b={b}
          onPick={(period, ex) =>
            setPanel({
              kind: "exchange",
              period,
              title: `${ex.analyst} · ${period === "a" ? la : lb}`,
              turns: [...ex.question_turns, ...ex.answer_turns].sort(
                (x, y) => x - y,
              ),
              extra: (
                <p>
                  <b>Evasiveness {ex.evasiveness.toFixed(1)}</b> — {ex.reason}
                </p>
              ),
            })
          }
        />
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title={`Risks mentioned · ${lb}`} info="risks_mentioned">
          <QuotedList
            items={(b.extraction?.risks ?? []).map((r) => ({
              head: r.label,
              body: r.summary,
              item: r,
            }))}
            onPick={(x) =>
              setPanel({
                kind: "quote",
                period: "b",
                title: x.head,
                item: x.item,
              })
            }
          />
        </Section>
        <Section title={`KPIs stated on the call · ${lb}`} info="kpis">
          <QuotedList
            items={(b.extraction?.kpis ?? []).map((k) => ({
              head: k.name,
              body: [
                k.value != null
                  ? `${k.value}${k.unit ? ` ${k.unit}` : ""}`
                  : null,
                k.period,
              ]
                .filter(Boolean)
                .join(" · "),
              item: k,
            }))}
            onPick={(x) =>
              setPanel({
                kind: "quote",
                period: "b",
                title: x.head,
                item: x.item,
              })
            }
          />
        </Section>
      </div>

      <p className="text-xs text-muted">
        AI cost for these two calls: ${cost.toFixed(4)} (cached — viewing again
        is free). Quotes that couldn&apos;t be found word-for-word in the
        transcript were discarded:{" "}
        {a.dropped_claims.length + b.dropped_claims.length}. Topic matching:{" "}
        {comparison.embedder}.
      </p>

      {panel && (
        <SourcePanel title={panel.title} onClose={() => setPanel(null)}>
          <PanelBody
            cik={cik}
            panel={panel}
            fyq={panel.period === "a" ? per.a : per.b}
          />
        </SourcePanel>
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  info,
  children,
}: {
  title: string;
  subtitle?: string;
  info?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="flex items-center text-lg font-semibold">
        <Term k={info} quiet>
          {title}
        </Term>
      </h2>
      {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function PriceReactions({
  la,
  lb,
  pa,
  pb,
}: {
  la: string;
  lb: string;
  pa: PriceReaction;
  pb: PriceReaction;
}) {
  const colors = useThemeColors();
  const card = (label: string, p: PriceReaction) => (
    <div key={label} className="rounded-2xl border border-border p-4">
      <div className="text-xs text-muted">
        Stock reaction after the {label} call
      </div>
      {p ? (
        <dl className="mt-2 grid grid-cols-2 gap-3">
          {(["1", "5"] as const).map((n) => {
            const r = p[`r${n}`];
            const ex = p[`excess_r${n}`];
            return (
              <div key={n}>
                <dt className="text-xs text-muted">
                  {n === "1" ? "Next day" : "5 days"}
                </dt>
                <dd
                  className="text-xl font-semibold"
                  style={{
                    color:
                      r == null ? undefined : r >= 0 ? colors.up : colors.down,
                  }}
                >
                  {r == null ? "—" : `${r >= 0 ? "▲" : "▼"} ${signed(r)}`}
                </dd>
                <dd className="text-xs text-muted">
                  {ex == null
                    ? "not enough days yet"
                    : `${signed(ex)} vs sector ETF`}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-muted">
          Not available (no report date or prices)
        </p>
      )}
      {p && (
        <p className="mt-2 text-xs text-muted">
          From close on {p.base_date} · reported {p.timing}
        </p>
      )}
    </div>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {[card(la, pa), card(lb, pb)]}
    </div>
  );
}

function GuidanceTable({
  rows,
  la,
  lb,
  onPick,
}: {
  rows: GuidanceChange[];
  la: string;
  lb: string;
  onPick: (r: GuidanceChange) => void;
}) {
  if (!rows.length)
    return <Empty text="No numeric guidance found on either call." />;
  return (
    <>
      <ul className="space-y-3 sm:hidden">
        {rows.map((r, i) => (
          <li key={i}>
            <button
              onClick={() => onPick(r)}
              className="w-full rounded-2xl border border-border p-4 text-left"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{r.metric}</div>
                  <div className="text-xs text-muted">
                    {(r.later ?? r.earlier)?.period}
                  </div>
                </div>
                <Chip change={r.change} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <div className="text-xs text-muted">{la}</div>
                  <div className="tabular-nums">{fmtGuide(r.earlier)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted">{lb}</div>
                  <div className="font-semibold tabular-nums">
                    {fmtGuide(r.later)}
                  </div>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-2xl border border-border sm:block">
        <ExportTable name="call">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 font-medium">Metric</th>
                <th className="px-4 py-2.5 font-medium">{la}</th>
                <th className="px-4 py-2.5 font-medium">{lb}</th>
                <th className="px-4 py-2.5 font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={i}
                  onClick={() => onPick(r)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-card"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.metric}</div>
                    <div className="text-xs text-muted">
                      {(r.later ?? r.earlier)?.period}
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {fmtGuide(r.earlier)}
                  </td>
                  <td className="px-4 py-3 tabular-nums font-semibold">
                    {fmtGuide(r.later)}
                  </td>
                  <td className="px-4 py-3">
                    <Chip change={r.change} />
                    {r.note && (
                      <div className="mt-1 text-xs text-muted">{r.note}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ExportTable>
      </div>
    </>
  );
}

function fmtDelta(d: number, unit: string | null | undefined): string {
  const { pre, post } = unitText(unit ?? null);
  const v = Number(Math.abs(d).toFixed(3));
  const postShort = post.replace(" y/y", "");
  return `${d >= 0 ? "+" : "−"}${pre}${v}${pre ? postShort : post.includes("%") ? " pts" : postShort}`;
}

function guidancePanel(r: GuidanceChange, la: string, lb: string): Panel {
  const item = r.later ?? r.earlier!;
  const period = r.later ? "b" : "a";
  return {
    kind: "quote",
    period,
    title: `${r.metric} guidance`,
    item,
    extra: (
      <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1">
        <dt className="text-muted">{la}</dt>
        <dd>{fmtGuide(r.earlier)}</dd>
        <dt className="text-muted">{lb}</dt>
        <dd>{fmtGuide(r.later)}</dd>
        <dt className="text-muted">Change</dt>
        <dd>
          {CHANGE_STYLE[r.change]?.text ?? r.change}
          {r.delta != null &&
            ` (${fmtDelta(r.delta, (r.later ?? r.earlier)?.unit)} at the midpoint)`}
        </dd>
        {r.earlier && r.later && (
          <>
            <dt className="text-muted">Earlier quote</dt>
            <dd className="italic">
              “{r.earlier.quote}” — {r.earlier.speaker}
            </dd>
          </>
        )}
        {item.numbers_removed && (
          <>
            <dt className="text-muted">Note</dt>
            <dd>
              The number wasn&apos;t stated in this quote, so it&apos;s shown as
              qualitative.
            </dd>
          </>
        )}
      </dl>
    ),
  };
}

function Topics({
  rows,
  onPick,
}: {
  rows: TopicChange[];
  onPick: (t: TopicChange) => void;
}) {
  if (!rows.length) return <Empty text="No topics extracted." />;
  const max = Math.max(
    ...rows.map((r) => Math.max(r.share_a, r.share_b)),
    0.01,
  );
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {rows.map((t, i) => (
        <li key={i}>
          <button
            onClick={() => onPick(t)}
            className="w-full rounded-2xl border border-border p-4 text-left hover:bg-card"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">{t.label}</span>
              <Chip change={t.change} />
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted">
              {(t.later ?? t.earlier)?.summary}
            </p>
            <div
              className="mt-3 space-y-1"
              aria-label={`Airtime ${pct(t.share_a, 0)} then ${pct(t.share_b, 0)}`}
            >
              {[t.share_a, t.share_b].map((s, k) => (
                <div
                  key={k}
                  className="flex items-center gap-2 text-[11px] text-muted"
                >
                  <span className="w-8">{k === 0 ? "then" : "now"}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-card">
                    <span
                      className="block h-full rounded-full bg-accent"
                      style={{
                        width: `${(s / max) * 100}%`,
                        opacity: k === 0 ? 0.45 : 1,
                      }}
                    />
                  </span>
                  <span className="w-9 text-right tabular-nums">
                    {pct(s, 0)}
                  </span>
                </div>
              ))}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function topicPanel(t: TopicChange): Panel {
  const item = t.later ?? t.earlier!;
  return {
    kind: "quote",
    period: t.later ? "b" : "a",
    title: t.label,
    item,
    extra: <p className="text-muted">{item.summary}</p>,
  };
}

function ToneTable({
  a,
  b,
  la,
  lb,
}: {
  a: CallAnalysis;
  b: CallAnalysis;
  la: string;
  lb: string;
}) {
  const [sec, setSec] = useState<"all" | "prepared" | "qa">("all");
  const execRoles = new Set(["ceo", "cfo", "other_exec"]);
  const names = useMemo(() => {
    const set = new Set<string>();
    for (const t of [a, b])
      for (const [n, s] of Object.entries(t.tone.speakers))
        if (execRoles.has(s.role)) set.add(n);
    return [...set];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, b]);
  const roleLabel: Record<string, string> = {
    ceo: "CEO",
    cfo: "CFO",
    other_exec: "Executive",
  };
  const rows = [
    {
      name: "All executives",
      role: "",
      ra: a.tone.executives[sec],
      rb: b.tone.executives[sec],
    },
    ...names.map((n) => ({
      name: n,
      role: roleLabel[(a.tone.speakers[n] ?? b.tone.speakers[n]).role] ?? "",
      ra: a.tone.speakers[n]?.[sec],
      rb: b.tone.speakers[n]?.[sec],
    })),
  ];
  const cell = (
    ra?: ToneRates,
    rb?: ToneRates,
    k?: keyof ToneRates,
    invert = false,
  ) => {
    if (!k) return null;
    const va = ra?.[k] as number | undefined;
    const vb = rb?.[k] as number | undefined;
    const up = va != null && vb != null ? vb > va : null;
    const good = up == null ? null : invert ? !up : up;
    return (
      <td className="px-3 py-2.5 tabular-nums">
        <span className="text-muted">
          {k === "net_tone" ? (va?.toFixed(2) ?? "—") : pct(va, 2)}
        </span>
        <span className="mx-1 text-muted">→</span>
        <span className="font-semibold">
          {k === "net_tone" ? (vb?.toFixed(2) ?? "—") : pct(vb, 2)}
        </span>
        {up != null && va !== vb && (
          <span className={`ml-1 text-xs ${good ? "text-up" : "text-down"}`}>
            {up ? "▲" : "▼"}
          </span>
        )}
      </td>
    );
  };
  return (
    <div>
      <div
        className="mb-3 inline-flex rounded-full bg-card p-1 text-sm"
        role="tablist"
        aria-label="Section of call"
      >
        {(["all", "prepared", "qa"] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={sec === s}
            onClick={() => setSec(s)}
            className={`rounded-full px-3 py-1 ${sec === s ? "bg-background font-semibold shadow" : "text-muted"}`}
          >
            {s === "all"
              ? "Whole call"
              : s === "prepared"
                ? "Prepared remarks"
                : "Q&A"}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border">
        <ExportTable name="call">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-border">
                <th className="px-3 py-2.5 font-medium">
                  Speaker ({la} → {lb})
                </th>
                <th className="px-3 py-2.5 font-medium">
                  <Term k="hedging">Hedging</Term>
                </th>
                <th className="px-3 py-2.5 font-medium">Positive</th>
                <th className="px-3 py-2.5 font-medium">Negative</th>
                <th className="px-3 py-2.5 font-medium">
                  <Term k="call_tone">Net tone</Term>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.name}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{r.name}</div>
                    {r.role && (
                      <div className="text-xs text-muted">{r.role}</div>
                    )}
                  </td>
                  {cell(r.ra, r.rb, "uncertainty_rate", true)}
                  {cell(r.ra, r.rb, "positive_rate")}
                  {cell(r.ra, r.rb, "negative_rate", true)}
                  {cell(r.ra, r.rb, "net_tone")}
                </tr>
              ))}
            </tbody>
          </table>
        </ExportTable>
      </div>
      <p className="mt-2 text-xs text-muted">
        ▲/▼ colored green when the change reads as more confident (less hedging,
        more positive, less negative).
      </p>
    </div>
  );
}

function ToneTrend({
  points,
  highlight,
}: {
  points: TonePoint[];
  highlight: string[];
}) {
  const colors = useThemeColors();
  if (points.length < 2)
    return (
      <Empty text="Trend appears once a few quarters have loaded (history loads in the background)." />
    );
  const labels = points.map(
    (p) => `Q${p.fiscal_quarter} '${String(p.fiscal_year).slice(2)}`,
  );
  const keys = points.map((p) => `FY${p.fiscal_year}Q${p.fiscal_quarter}`);
  const hedge = points.map((p) =>
    p.executives.all
      ? +(p.executives.all.uncertainty_rate * 100).toFixed(3)
      : null,
  );
  const net = points.map((p) =>
    p.executives.all ? +p.executives.all.net_tone.toFixed(3) : null,
  );
  const evas = points.map((p) =>
    p.avg_evasiveness == null ? null : +p.avg_evasiveness.toFixed(2),
  );
  const option = {
    animationDuration: 250,
    grid: { left: 40, right: 40, top: 28, bottom: 28 },
    legend: { show: false },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { color: colors.muted },
      axisLine: { lineStyle: { color: colors.grid } },
    },
    yAxis: [
      {
        type: "value",
        name: "hedging %",
        nameTextStyle: { color: colors.muted },
        axisLabel: { color: colors.muted },
        splitLine: { lineStyle: { color: colors.grid } },
      },
      {
        type: "value",
        name: "net tone",
        min: -1,
        max: 1,
        nameTextStyle: { color: colors.muted },
        axisLabel: { color: colors.muted },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "Hedging (% of words)",
        type: "line",
        data: hedge.map((v, i) => ({
          value: v,
          symbolSize: highlight.includes(keys[i]) ? 10 : 5,
        })),
        lineStyle: { color: colors.down, width: 2 },
        itemStyle: { color: colors.down },
      },
      {
        name: "Net tone (−1 to 1)",
        type: "line",
        yAxisIndex: 1,
        data: net.map((v, i) => ({
          value: v,
          symbolSize: highlight.includes(keys[i]) ? 10 : 5,
        })),
        lineStyle: { color: colors.up, width: 2 },
        itemStyle: { color: colors.up },
      },
      {
        name: "Avg evasiveness (0–1)",
        type: "line",
        yAxisIndex: 1,
        data: evas,
        connectNulls: false,
        lineStyle: { color: colors.muted, width: 1.5, type: "dashed" },
        itemStyle: { color: colors.muted },
      },
    ],
  };
  return (
    <div className="rounded-2xl border border-border p-4">
      <EChart
        option={option}
        className="h-56 w-full"
        ariaLabel="Executive tone across quarters"
      />
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
        <span>
          <span style={{ color: colors.down }}>━</span> Hedging (% of words,
          left)
        </span>
        <span>
          <span style={{ color: colors.up }}>━</span> Net tone (−1 to 1, right)
        </span>
        <span>┅ Avg evasiveness (compared quarters only)</span>
      </div>
    </div>
  );
}

function Evasiveness({
  la,
  lb,
  a,
  b,
  onPick,
}: {
  la: string;
  lb: string;
  a: CallAnalysis;
  b: CallAnalysis;
  onPick: (
    period: "a" | "b",
    ex: NonNullable<CallAnalysis["evasiveness"]>[number],
  ) => void;
}) {
  const [which, setWhich] = useState<"a" | "b">("b");
  const data = (which === "a" ? a : b).evasiveness ?? [];
  const avg = (x: CallAnalysis) =>
    x.evasiveness?.length
      ? x.evasiveness.reduce((s, e) => s + e.evasiveness, 0) /
        x.evasiveness.length
      : null;
  const colors = useThemeColors();
  if (!a.evasiveness && !b.evasiveness)
    return (
      <Empty text="Not scored (AI analysis didn't run for these calls)." />
    );
  const sorted = [...data].sort((x, y) => y.evasiveness - x.evasiveness);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-full bg-card p-1 text-sm">
          {(["a", "b"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setWhich(k)}
              className={`rounded-full px-3 py-1 ${which === k ? "bg-background font-semibold shadow" : "text-muted"}`}
            >
              {k === "a" ? la : lb}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted">
          Average: {avg(a)?.toFixed(2) ?? "—"} →{" "}
          <b className="text-foreground">{avg(b)?.toFixed(2) ?? "—"}</b>
        </span>
      </div>
      <ul className="divide-y divide-border rounded-2xl border border-border">
        {sorted.map((e) => (
          <li key={e.exchange}>
            <button
              onClick={() => onPick(which, e)}
              className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-card"
            >
              <span className="w-28 shrink-0 text-sm font-medium">
                {e.analyst}
              </span>
              <span
                className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-card"
                aria-label={`Evasiveness ${e.evasiveness}`}
              >
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${e.evasiveness * 100}%`,
                    background:
                      e.evasiveness >= 0.6
                        ? colors.down
                        : e.evasiveness >= 0.4
                          ? colors.muted
                          : colors.up,
                  }}
                />
              </span>
              <span className="w-8 shrink-0 text-sm tabular-nums">
                {e.evasiveness.toFixed(1)}
              </span>
              <span className="truncate text-sm text-muted">{e.reason}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuotedList<T extends Quoted>({
  items,
  onPick,
}: {
  items: { head: string; body: string; item: T }[];
  onPick: (x: { head: string; body: string; item: T }) => void;
}) {
  if (!items.length) return <Empty text="None extracted." />;
  return (
    <ul className="divide-y divide-border rounded-2xl border border-border">
      {items.map((x, i) => (
        <li key={i}>
          <button
            onClick={() => onPick(x)}
            className="w-full px-4 py-3 text-left hover:bg-card"
          >
            <div className="text-sm font-medium">{x.head}</div>
            {x.body && <div className="text-xs text-muted">{x.body}</div>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted">
      {text}
    </p>
  );
}

type TurnText = { i: number; speaker: string; title: string; content: string };

function PanelBody({
  cik,
  panel,
  fyq,
}: {
  cik: number;
  panel: NonNullable<Panel>;
  fyq: readonly [number, number];
}) {
  const ids =
    panel.kind === "quote"
      ? [Math.max(panel.item.turn - 1, 0), panel.item.turn]
      : panel.turns;
  const [turns, setTurns] = useState<TurnText[] | null>(null);
  const [error, setError] = useState(false);
  const key = ids.join(",");
  useEffect(() => {
    let live = true;
    fetch(`/api/turns?cik=${cik}&fy=${fyq[0]}&fq=${fyq[1]}&turns=${key}`)
      .then((r) => r.json())
      .then(
        (d: { turns?: TurnText[] }) =>
          live && (d.turns ? setTurns(d.turns) : setError(true)),
      )
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [cik, fyq, key]);

  const quote = panel.kind === "quote" ? panel.item.quote : null;
  return (
    <>
      {panel.extra}
      {panel.kind === "quote" && quote && (
        <blockquote className="border-l-2 border-accent pl-3 italic">
          “{quote}”
          <footer className="mt-1 text-xs not-italic text-muted">
            {panel.item.speaker}
            {panel.item.role
              ? ` · ${panel.item.role.toUpperCase().replace("OTHER_EXEC", "Executive")}`
              : ""}{" "}
            · turn {panel.item.turn} ·{" "}
            {panel.item.section === "qa" ? "Q&A" : "prepared remarks"} · FY
            {fyq[0]} Q{fyq[1]} call
          </footer>
        </blockquote>
      )}
      <div>
        <div className="text-xs font-semibold text-muted">
          In context (transcript)
        </div>
        {error && (
          <p className="text-muted">Couldn&apos;t load the transcript text.</p>
        )}
        {!turns && !error && <div className="skeleton mt-2 h-24" />}
        {turns?.map((t) => (
          <div key={t.i} className="mt-3">
            <div className="text-xs font-semibold">
              {t.speaker}{" "}
              <span className="font-normal text-muted">{t.title}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap leading-relaxed">
              {highlight(t.content, quote)}
            </p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">
        Transcript via Alpha Vantage. Quotes are checked word-for-word against
        this text.
      </p>
    </>
  );
}

function highlight(text: string, quote: string | null): React.ReactNode {
  if (!quote) return text;
  const norm = (s: string) =>
    s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ");
  const t = norm(text);
  const q = norm(quote)
    .trim()
    .replace(/^["']|["']$/g, "");
  const i = t.indexOf(q);
  if (i < 0) return t;
  return (
    <>
      {t.slice(0, i)}
      <mark className="rounded bg-accent/25 px-0.5 text-foreground">
        {t.slice(i, i + q.length)}
      </mark>
      {t.slice(i + q.length)}
    </>
  );
}
