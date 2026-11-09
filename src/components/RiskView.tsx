"use client";

import Term, { AboutNumbers } from "@/components/Term";
import { useState } from "react";
import EChart from "@/components/EChart";
import { useThemeColors } from "@/components/useThemeColors";
import type { Risk } from "@/lib/riskopts";

type N = number | null | undefined;
const pct = (v: N, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const spct = (v: N, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`);
const x2 = (v: N) => (v == null ? "—" : v.toFixed(2));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Stat({ label, value, sub, info }: { label: string; value: string; sub?: React.ReactNode; info?: string }) {
  return (
    <div>
      <dt className="flex items-center text-xs text-muted">
        <Term k={info} value={value}>{label}</Term>
      </dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
      {sub && <dd className="text-xs text-muted">{sub}</dd>}
    </div>
  );
}

function Section({ id, title, note, info, children }: { id: string; title: string; note?: string; info?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-32">
      <h2 className="flex items-center border-b border-border pb-3 text-xl font-semibold tracking-tight">
        <Term k={info} quiet>{title}</Term>
      </h2>
      {note && <p className="mt-2 text-sm text-muted">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function summary(t: string, r: Risk): string {
  const parts: string[] = [];
  const b = r.beta.y1;
  if (b != null) parts.push(`${t} has moved about ${b.toFixed(1)}× as much as the S&P 500 over the past year (beta ${b.toFixed(2)}).`);
  const v = r.volatility.y1;
  if (v != null) parts.push(`A typical day's move is about ±${((v / Math.sqrt(252)) * 100).toFixed(1)}%.`);
  if (r.var95 != null) parts.push(`On roughly 1 day in 20 it fell ${pct(r.var95)} or more.`);
  parts.push(`Its worst fall in the last 5 years was ${pct(Math.abs(r.drawdown.y5.max), 0)} from peak to bottom${r.drawdown.y5.peak ? ` (${r.drawdown.y5.peak.slice(0, 7)} → ${r.drawdown.y5.trough?.slice(0, 7)})` : ""}.`);
  if (r.avg_earnings_move != null) parts.push(`On earnings days it has moved ±${pct(r.avg_earnings_move)} on average.`);
  return parts.join(" ");
}

export default function RiskView({ ticker, r, sector }: { ticker: string; r: Risk; sector: string | null }) {
  const theme = useThemeColors();
  const [chart, setChart] = useState<"drawdown" | "vol" | "hist">("drawdown");
  const f = r.fundamental;
  const blue = theme.dark ? "#5b9dff" : "#2563eb";

  const charts = {
    drawdown: {
      animation: false,
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => pct(v) },
      xAxis: { type: "time", axisLabel: { color: theme.muted }, splitLine: { show: false } },
      yAxis: { type: "value", max: 0, axisLabel: { color: theme.muted, formatter: (v: number) => `${Math.round(v * 100)}%` }, splitLine: { lineStyle: { color: theme.grid } } },
      series: [{ type: "line", name: "Below previous high", data: r.drawdown.series, showSymbol: false, lineStyle: { width: 1.5, color: theme.down }, areaStyle: { color: theme.down, opacity: 0.15 } }],
    },
    vol: {
      animation: false,
      grid: { left: 8, right: 56, top: 16, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => pct(v, 0) },
      xAxis: { type: "time", axisLabel: { color: theme.muted }, splitLine: { show: false } },
      yAxis: { type: "value", axisLabel: { color: theme.muted, formatter: (v: number) => `${Math.round(v * 100)}%` }, splitLine: { lineStyle: { color: theme.grid } } },
      series: [
        { type: "line", name: ticker, data: r.volatility.rolling, showSymbol: false, lineStyle: { width: 2, color: theme.fg }, itemStyle: { color: theme.fg }, endLabel: { show: true, formatter: "{a}", color: theme.fg } },
        { type: "line", name: "S&P 500", data: r.market_rolling, showSymbol: false, lineStyle: { width: 1.5, color: blue }, itemStyle: { color: blue }, endLabel: { show: true, formatter: "{a}", color: blue } },
      ],
    },
    hist: {
      animation: false,
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", formatter: (p: { name: string; value: number }[]) => `${p[0].name}: ${p[0].value} days` },
      xAxis: { type: "category", data: r.histogram.map(([b]) => `${(b * 100).toFixed(1)}%`), axisLabel: { color: theme.muted, interval: 3 }, axisTick: { show: false } },
      yAxis: { type: "value", axisLabel: { color: theme.muted }, splitLine: { lineStyle: { color: theme.grid } } },
      series: [{ type: "bar", data: r.histogram.map(([b, c]) => ({ value: c, itemStyle: { color: b < 0 ? theme.down : theme.up } })), barCategoryGap: "10%" }],
    },
  };

  const season = {
    animation: false,
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      formatter: (p: { dataIndex: number }[]) => {
        const s = r.seasonality[p[0].dataIndex];
        return `${MONTHS[s.month - 1]}: avg ${spct(s.avg)} · up in ${pct(s.pct_up, 0)} of ${s.years} years`;
      },
    },
    xAxis: { type: "category", data: r.seasonality.map((s) => MONTHS[s.month - 1]), axisLabel: { color: theme.muted }, axisTick: { show: false } },
    yAxis: { type: "value", axisLabel: { color: theme.muted, formatter: (v: number) => `${(v * 100).toFixed(0)}%` }, splitLine: { lineStyle: { color: theme.grid } } },
    series: [{ type: "bar", data: r.seasonality.map((s) => ({ value: s.avg, itemStyle: { color: s.avg >= 0 ? theme.up : theme.down } })), barMaxWidth: 28 }],
  };

  const em = [...r.earnings_moves].reverse();
  const earnChart = {
    animation: false,
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", valueFormatter: (v: number) => spct(v) },
    xAxis: { type: "category", data: em.map((e) => e.quarter), axisLabel: { color: theme.muted }, axisTick: { show: false } },
    yAxis: { type: "value", axisLabel: { color: theme.muted, formatter: (v: number) => `${(v * 100).toFixed(0)}%` }, splitLine: { lineStyle: { color: theme.grid } } },
    series: [{ type: "bar", data: em.map((e) => ({ value: e.move, itemStyle: { color: e.move >= 0 ? theme.up : theme.down } })), barMaxWidth: 28 }],
  };

  return (
    <div className="space-y-12">
      <nav className="flex flex-wrap gap-4 text-sm text-muted" aria-label="Sections">
        {[
          ["rk-profile", "Risk profile"],
          ["rk-charts", "Charts"],
          ["rk-earnings", "Earnings moves"],
          ["rk-season", "Seasonality"],
          ["rk-fund", "Balance-sheet risk"],
        ].map(([id, l]) => (
          <a key={id} href={`#${id}`} className="hover:text-foreground">
            {l}
          </a>
        ))}
      </nav>

      <Section id="rk-profile" title="Risk profile" note={`From ${r.years_of_history} years of daily prices (adjusted for splits and dividends) through ${r.as_of}. Market = S&P 500 (SPY)${sector ? `; sector = ${sector}` : ""}.`}>
        <p className="rounded-xl bg-card px-4 py-3 text-sm leading-relaxed">{summary(ticker, r)}</p>
        <div className="mt-2 text-right">
          <AboutNumbers
            title="About stats & risk"
            keys={["volatility", "beta", "correlation", "max_drawdown", "below_high", "sharpe", "sortino", "var95", "capture", "skew_kurt", "up_days", "earnings_moves", "seasonality", "piotroski", "interest_coverage", "net_debt_to_ebitda", "sbc_pct"]}
          />
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <Stat label="Volatility (1 yr)" info="volatility" value={pct(r.volatility.y1, 0)} sub={`S&P 500: ${pct(r.volatility.market_y1, 0)} · last 30 days: ${pct(r.volatility.d30, 0)}`} />
          <Stat label="Beta (1 yr / 3 yr)" info="beta" value={`${x2(r.beta.y1)} / ${x2(r.beta.y3)}`} sub={`Correlation with market ${x2(r.beta.corr_y1)}${r.beta.sector_y1 != null ? ` · vs sector ${x2(r.beta.sector_y1)}` : ""}`} />
          <Stat label="Max drawdown" info="max_drawdown" value={pct(r.drawdown.y5.max, 0)} sub={`1 yr: ${pct(r.drawdown.y1.max, 0)} · all history: ${pct(r.drawdown.all.max, 0)}`} />
          <Stat label="Below 52-week high" info="below_high" value={pct(r.drawdown.current, 1)} />
          <Stat label="Sharpe ratio (1 yr / 3 yr)" info="sharpe" value={`${x2(r.sharpe.y1)} / ${x2(r.sharpe.y3)}`} sub={`S&P 500 (1 yr): ${x2(r.sharpe.market_y1)}`} />
          <Stat label="Sortino ratio (1 yr / 3 yr)" info="sortino" value={`${x2(r.sortino.y1)} / ${x2(r.sortino.y3)}`} />
          <Stat label="1-day value at risk (95%)" info="var95" value={pct(r.var95)} sub={`Average on those bad days: ${pct(r.cvar95)}`} />
          <Stat
            label="Up / down capture (3 yr)" info="capture"
            value={`${pct(r.capture.up, 0)} / ${pct(r.capture.down, 0)}`}
          />
          <Stat label="Return (1 yr)" info="vs_benchmark" value={spct(r.returns.y1, 0)} sub={`S&P 500: ${spct(r.returns.market_y1, 0)}`} />
          <Stat label="Up days (1 yr)" info="up_days" value={pct(r.up_days_pct, 0)} />
          <Stat label="Skew / fat tails" info="skew_kurt" value={`${x2(r.skew)} / ${x2(r.excess_kurtosis)}`} />
        </dl>
      </Section>

      <Section id="rk-charts" title="Charts">
        <div className="flex flex-wrap gap-1" role="tablist">
          {(
            [
              ["drawdown", "Drawdowns (5 yr)"],
              ["vol", "Rolling 3-month volatility vs S&P 500"],
              ["hist", "Distribution of daily returns (1 yr)"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={chart === k}
              onClick={() => setChart(k)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${chart === k ? "border-foreground bg-foreground text-background" : "border-border text-muted hover:text-foreground"}`}
            >
              {l}
            </button>
          ))}
        </div>
        {chart === "hist" && (
          <div className="mt-3 flex gap-4 text-xs text-muted">
            <span>
              <span className="text-up">▲</span> Up days
            </span>
            <span>
              <span className="text-down">▼</span> Down days
            </span>
          </div>
        )}
        <p className="mt-3 flex items-center text-xs text-muted">
          <Term k={chart === "drawdown" ? "drawdown_chart" : chart === "vol" ? "rolling_vol" : "return_distribution"}>About this chart</Term>
        </p>
        <EChart option={charts[chart]} className="mt-3 h-72 w-full" ariaLabel={`${ticker} ${chart} chart`} />
        <div className="mt-6 grid gap-8 sm:grid-cols-2">
          {(
            [
              ["Best days (1 yr)", r.best_days],
              ["Worst days (1 yr)", r.worst_days],
            ] as const
          ).map(([t, rows]) => (
            <div key={t}>
              <h3 className="font-semibold">{t}</h3>
              <ul className="mt-2 divide-y divide-border text-sm">
                {rows.map(([d, v]) => (
                  <li key={d} className="flex justify-between py-2">
                    <span className="text-muted">{d}</span>
                    <span className={v >= 0 ? "text-up" : "text-down"}>
                      {v >= 0 ? "▲" : "▼"} {pct(Math.abs(v))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="rk-earnings"
        info="earnings_moves"
        title="Earnings-day moves"
        note={
          em.length
            ? `Move from the close before each report to the first close after it. Average size over the last ${Math.min(8, em.length)} reports: ±${pct(r.avg_earnings_move)}. Compare with what options expect in the Options tab.`
            : "Earnings report dates aren't loaded for this stock yet (they arrive with Street data, biggest companies first)."
        }
      >
        {em.length > 0 && (
          <>
            <div className="flex gap-4 text-xs text-muted">
              <span>
                <span className="text-up">▲</span> Rose
              </span>
              <span>
                <span className="text-down">▼</span> Fell
              </span>
            </div>
            <EChart option={earnChart} className="mt-2 h-56 w-full" ariaLabel={`${ticker} stock moves on earnings days`} />
          </>
        )}
      </Section>

      <Section id="rk-season" info="seasonality" title="Seasonality" note="Average return by calendar month over the full price history. Patterns like these are often noise — treat them as context, not a forecast.">
        <div className="flex gap-4 text-xs text-muted">
          <span>
            <span className="text-up">▲</span> Up on average
          </span>
          <span>
            <span className="text-down">▼</span> Down on average
          </span>
        </div>
        <EChart option={season} className="mt-2 h-56 w-full" ariaLabel={`${ticker} average return by month`} />
      </Section>

      <Section id="rk-fund" info="piotroski" title="Balance-sheet risk" note="From SEC filings (latest fiscal year).">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <Stat label="Piotroski F-score" info="piotroski" value={f.piotroski ? `${f.piotroski.score} / ${f.piotroski.out_of}` : "—"} sub={f.piotroski ? (f.piotroski.score >= 7 ? "Strong" : f.piotroski.score <= 3 ? "Weak" : "Middling") + ` · FY${f.piotroski.fiscal_year}` : "Not enough data"} />
          <Stat label="Interest coverage" info="interest_coverage" value={f.interest_coverage == null ? "—" : `${f.interest_coverage.toFixed(1)}×`} sub="Operating income ÷ interest expense" />
          <Stat label="Net debt / EBITDA" info="net_debt_to_ebitda" value={f.net_debt_to_ebitda == null ? "—" : `${f.net_debt_to_ebitda.toFixed(1)}×`} sub="Below 0 = more cash than debt" />
          <Stat label="Stock comp / revenue" info="sbc_pct" value={pct(f.sbc_pct_revenue)} sub={`Share count ${spct(f.share_change_1y)} (1 yr) · ${spct(f.share_change_3y)}/yr (3 yr)`} />
        </dl>
        {f.piotroski && (
          <ul className="mt-5 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            {f.piotroski.checks.map((c) => (
              <li key={c.label} className="flex items-baseline gap-2 py-1">
                {c.pass == null ? <span className="text-muted">–</span> : c.pass ? <span className="text-up">▲</span> : <span className="text-down">▼</span>}
                <span className={c.pass == null ? "text-muted" : ""}>{c.label}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <p className="text-xs text-muted">Past volatility and returns don&apos;t predict future results. Research, not investment advice.</p>
    </div>
  );
}
