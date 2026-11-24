"use client";

import { useMemo, useState } from "react";
import EChart from "@/components/EChart";
import Term from "@/components/Term";
import { DownloadButton, downloadCsv } from "@/components/ExportTable";
import SourcePanel from "@/components/SourcePanel";
import { useThemeColors } from "@/components/useThemeColors";
import {
  filingIndexFromDocUrl,
  fmtValue,
  periodLabel,
  secFilingIndexUrl,
  type MetricGroup,
  type MetricInfo,
} from "@/lib/metrics";

/** Compact row sent from the server: [fy, fp, value, source, tag, derivationIdx, accession, periodEnd, unit] */
export type CompactRow = [
  number,
  string,
  number,
  "reported" | "derived",
  string | null,
  number,
  string | null,
  string,
  string,
];

export type FinancialsData = {
  cik: number;
  currency: string;
  series: Record<string, CompactRow[]>;
  derivations: string[];
  unresolved: Record<string, string>;
  filings: Record<string, { form: string; filed: string; url: string }>;
};

type Mode = "FY" | "Q";
type Selected = { metric: MetricInfo; row: CompactRow } | null;

export default function FinancialsView({
  data,
  groups,
}: {
  data: FinancialsData;
  groups: MetricGroup[];
}) {
  const [mode, setMode] = useState<Mode>("FY");
  const [period, setPeriod] = useState<string | null>(null); // "2024|FY" — highlighted everywhere
  const [selected, setSelected] = useState<Selected>(null);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="inline-flex rounded-full bg-card p-1"
          role="tablist"
          aria-label="Period type"
        >
          {(["FY", "Q"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setPeriod(null);
              }}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${mode === m ? "bg-background shadow" : "text-muted"}`}
            >
              {m === "FY" ? "Annual" : "Quarterly"}
            </button>
          ))}
        </div>
        <DownloadButton
          label={`Download all ${mode === "FY" ? "annual" : "quarterly"} financials`}
          onClick={() => {
            // one row per metric, one column per period (oldest → newest), raw values from SEC
            const metrics = groups.flatMap((g) => g.metrics);
            const keyOf = (r: CompactRow) => `${r[0]}|${r[1]}`;
            const periods = new Map<string, string>();
            for (const m of metrics)
              for (const r of rowsFor(data.series[m.key] ?? [], mode)) periods.set(keyOf(r), r[7]);
            const cols = [...periods.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([k]) => k);
            const header = ["Metric", ...cols.map((k) => periodLabel(Number(k.split("|")[0]), k.split("|")[1]))];
            const body = metrics.map((m) => {
              const by = new Map((data.series[m.key] ?? []).map((r) => [keyOf(r), r[2]]));
              return [m.label, ...cols.map((k) => by.get(k) ?? null)];
            });
            downloadCsv(`financials-${mode === "FY" ? "annual" : "quarterly"}`, [header, ...body]);
          }}
        />
        <p className="text-xs text-muted">
          {data.currency !== "USD" && <>Reported in {data.currency}. </>}
          Tap a bar to see its source · selection highlights every chart
          {period && (
            <button onClick={() => setPeriod(null)} className="ml-2 underline">
              clear
            </button>
          )}
        </p>
      </div>

      {groups.map((g) => {
        const shown = g.metrics;
        return (
          <section key={g.title} className="mt-8">
            <h2 className="mb-3 text-lg font-semibold">{g.title}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((m) => (
                <MetricCard
                  key={m.key}
                  metric={m}
                  rows={data.series[m.key] ?? []}
                  unresolved={data.unresolved[m.key]}
                  mode={mode}
                  period={period}
                  onPick={(row) => {
                    setPeriod(`${row[0]}|${row[1]}`);
                    setSelected({ metric: m, row });
                  }}
                />
              ))}
            </div>
          </section>
        );
      })}

      {selected && (
        <SourcePanel
          title={`${selected.metric.label} · ${periodLabel(selected.row[0], selected.row[1])}`}
          onClose={() => setSelected(null)}
        >
          <SourceDetails
            data={data}
            metric={selected.metric}
            row={selected.row}
          />
        </SourcePanel>
      )}
    </div>
  );
}

function rowsFor(rows: CompactRow[], mode: Mode): CompactRow[] {
  const keep = rows.filter((r) =>
    mode === "FY" ? r[1] === "FY" : r[1] !== "FY",
  );
  return keep
    .sort((a, b) => (a[7] < b[7] ? -1 : a[7] > b[7] ? 1 : 0))
    .slice(mode === "FY" ? -15 : -60);
}

function MetricCard({
  metric,
  rows,
  unresolved,
  mode,
  period,
  onPick,
}: {
  metric: MetricInfo;
  rows: CompactRow[];
  unresolved?: string;
  mode: Mode;
  period: string | null;
  onPick: (row: CompactRow) => void;
}) {
  const colors = useThemeColors();
  const shown = useMemo(() => rowsFor(rows, mode), [rows, mode]);
  const last = shown[shown.length - 1];
  const highlightIdx = period
    ? shown.findIndex((r) => `${r[0]}|${r[1]}` === period)
    : -1;
  const focus = highlightIdx >= 0 ? shown[highlightIdx] : last;
  const prior = focus
    ? rows.find((r) => r[0] === focus[0] - 1 && r[1] === focus[1])
    : undefined;

  if (!shown.length) {
    return (
      <div className="rounded-2xl bg-card p-5">
        <div className="flex items-center text-sm text-muted">
          <Term k={metric.key}>{metric.label}</Term>
        </div>
        <div className="mt-2 text-2xl font-semibold text-muted">
          Not reported
        </div>
        <p className="mt-2 text-xs text-muted">
          {unresolved ??
            "This company doesn't report this item in a form we can read."}
        </p>
      </div>
    );
  }

  const unit = focus[8];
  const delta =
    prior && metric.fmt !== "pct" && prior[2] !== 0
      ? focus[2] / Math.abs(prior[2]) - Math.sign(prior[2])
      : null;
  const deltaPts =
    prior && metric.fmt === "pct" ? (focus[2] - prior[2]) * 100 : null;
  const up = (delta ?? deltaPts ?? 0) >= 0;

  const option = {
    animationDuration: 250,
    grid: { left: 2, right: 2, top: 6, bottom: 18 },
    xAxis: {
      type: "category",
      data: shown.map((r) =>
        mode === "FY"
          ? `'${String(r[0]).slice(2)}`
          : `${r[1]} ${String(r[0]).slice(2)}`,
      ),
      axisLabel: {
        color: colors.muted,
        fontSize: 10,
        interval: mode === "FY" ? 2 : 7,
      },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: { type: "value", show: false },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (ps: { dataIndex: number }[]) => {
        const r = shown[ps[0].dataIndex];
        return `${periodLabel(r[0], r[1])}<br/><b>${fmtValue(r[2], metric.fmt, r[8])}</b>${r[3] === "derived" ? " · derived" : ""}`;
      },
    },
    series: [
      {
        type: "bar",
        data: shown.map((r, i) => ({
          value: r[2],
          itemStyle: {
            color: r[2] < 0 ? colors.down : colors.up,
            opacity: highlightIdx < 0 || i === highlightIdx ? 1 : 0.3,
            borderRadius: [3, 3, 0, 0],
          },
        })),
        barMaxWidth: 18,
      },
    ],
  };

  return (
    <div className="rounded-2xl bg-card p-5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center text-sm text-muted">
          <Term k={metric.key}>{metric.label}</Term>
        </div>
        <div className="text-xs text-muted">
          {periodLabel(focus[0], focus[1])}
        </div>
      </div>
      <button className="mt-1 text-left" onClick={() => onPick(focus)}>
        <span className="text-2xl font-semibold tracking-tight">
          {fmtValue(focus[2], metric.fmt, unit)}
        </span>
        {(delta !== null || deltaPts !== null) && (
          <span
            className="ml-2 text-sm font-medium"
            style={{ color: up ? colors.up : colors.down }}
          >
            {up ? "▲" : "▼"}{" "}
            {delta !== null
              ? `${Math.abs(delta * 100).toFixed(1)}%`
              : `${Math.abs(deltaPts!).toFixed(1)} pts`}
          </span>
        )}
      </button>
      <EChart
        option={option}
        className="mt-2 h-28 w-full"
        ariaLabel={`${metric.label} by ${mode === "FY" ? "year" : "quarter"}`}
        onClick={(p) => onPick(shown[p.dataIndex])}
      />
    </div>
  );
}

function SourceDetails({
  data,
  metric,
  row,
}: {
  data: FinancialsData;
  metric: MetricInfo;
  row: CompactRow;
}) {
  const [fy, fp, value, source, tag, derivIdx, accession, periodEnd, unit] =
    row;
  const filing = accession ? data.filings[accession] : undefined;
  return (
    <>
      <div className="text-3xl font-semibold">
        {fmtValue(value, metric.fmt, unit)}
      </div>
      <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2">
        <dt className="text-muted">Period</dt>
        <dd>
          {periodLabel(fy, fp)} · ends {periodEnd}
        </dd>
        <dt className="text-muted">Type</dt>
        <dd>
          {source === "reported"
            ? "Reported in XBRL"
            : "Derived in code (not AI)"}
        </dd>
        {tag && (
          <>
            <dt className="text-muted">XBRL tag</dt>
            <dd className="break-all font-mono text-xs">{tag}</dd>
          </>
        )}
        {derivIdx >= 0 && (
          <>
            <dt className="text-muted">How</dt>
            <dd>{data.derivations[derivIdx]}</dd>
          </>
        )}
        {accession && (
          <>
            <dt className="text-muted">Filing</dt>
            <dd>
              {filing ? `${filing.form} filed ${filing.filed}` : accession}
              <br />
              <a
                className="text-accent-ink underline"
                href={
                  filing
                    ? filingIndexFromDocUrl(filing.url, accession)
                    : secFilingIndexUrl(data.cik, accession)
                }
                target="_blank"
                rel="noreferrer"
              >
                Open on SEC.gov ↗
              </a>
            </dd>
          </>
        )}
      </dl>
    </>
  );
}
