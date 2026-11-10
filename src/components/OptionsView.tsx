"use client";

import Term, { AboutNumbers } from "@/components/Term";
import ExportTable from "@/components/ExportTable";
import EChart from "@/components/EChart";
import { useThemeColors } from "@/components/useThemeColors";
import type { OptContract, Options } from "@/lib/riskopts";

type N = number | null | undefined;
const pct = (v: N, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const usd = (v: N) => (v == null ? "—" : `$${v.toFixed(2)}`);
const k = (v: number) =>
  v >= 1e6
    ? `${(v / 1e6).toFixed(1)}M`
    : v >= 1e3
      ? `${(v / 1e3).toFixed(1)}K`
      : `${v}`;
const day = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

function Stat({
  label,
  value,
  sub,
  info,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  info?: string;
}) {
  return (
    <div>
      <dt className="flex items-center text-xs text-muted">
        <Term k={info} value={value}>
          {label}
        </Term>
      </dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
      {sub && <dd className="text-xs text-muted">{sub}</dd>}
    </div>
  );
}

function reading(t: string, o: Options, avgEarn: N): string[] {
  const out: string[] = [];
  const near = o.term.find((x) => x.dte >= 20) ?? o.term[0];
  if (near)
    out.push(
      `Options are pricing roughly a ±${pct(near.move)} move in ${t} by ${day(near.exp)} (${near.dte} days), based on the at-the-money straddle.`,
    );
  if (o.earnings) {
    const dm = o.earnings.day_move;
    if (dm != null) {
      const cmp =
        avgEarn != null
          ? ` The stock has actually moved ±${pct(avgEarn)} on an average earnings day, so options expect ${dm > avgEarn * 1.15 ? "a bigger" : dm < avgEarn * 0.85 ? "a smaller" : "a similar"} reaction than usual.`
          : "";
      out.push(
        `Earnings are expected ${day(o.earnings.date)}. Separating out ordinary day-to-day movement, options imply about a ±${pct(dm)} move on the report itself.${cmp}`,
      );
    } else {
      out.push(
        `Earnings are expected ${day(o.earnings.date)}. The ${day(o.earnings.exp)} straddle prices a ±${pct(o.earnings.move)} move through the report (including the ordinary days before it).`,
      );
    }
  }
  if (o.iv30 != null && o.realized30 != null && o.realized30 > 0) {
    const r = o.iv30 / o.realized30;
    out.push(
      `Implied volatility (${pct(o.iv30, 0)}) is ${r > 1.2 ? "well above" : r < 0.85 ? "below" : "close to"} how much the stock has actually moved over the last 30 days (${pct(o.realized30, 0)}) — options are ${r > 1.2 ? "relatively expensive" : r < 0.85 ? "relatively cheap" : "fairly priced"} versus recent movement.`,
    );
  }
  if (o.skew && o.skew.skew > 0.05)
    out.push(
      `Downside puts cost noticeably more than upside calls (skew ${pct(o.skew.skew)}): traders are paying up for crash protection.`,
    );
  if (o.put_call_volume != null)
    out.push(
      `Put/call volume today is ${o.put_call_volume.toFixed(2)} (${o.put_call_volume > 1 ? "more puts than calls traded" : "more calls than puts traded"}).`,
    );
  return out;
}

function Contracts({ rows, title }: { rows: OptContract[]; title: string }) {
  if (!rows.length) return null;
  return (
    <div>
      <h3 className="flex items-center font-semibold">
        <Term k="most_active" quiet>
          {title}
        </Term>
      </h3>
      <ExportTable name="options">
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1.5 pr-2 font-normal">Contract</th>
              <th className="py-1.5 pr-2 text-right font-normal">Volume</th>
              <th className="py-1.5 pr-2 text-right font-normal">Open int.</th>
              <th className="py-1.5 pr-2 text-right font-normal">IV</th>
              <th className="py-1.5 text-right font-normal">Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((c) => (
              <tr key={c.symbol}>
                <td className="py-2 pr-2">
                  ${c.strike} {c.cp === "C" ? "call" : "put"}{" "}
                  <span className="text-xs text-muted">{day(c.exp)}</span>
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {k(c.volume)}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">{k(c.oi)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {pct(c.iv, 0)}
                </td>
                <td className="py-2 text-right tabular-nums">{usd(c.mid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ExportTable>
    </div>
  );
}

export default function OptionsView({
  ticker,
  o,
  asOf,
  avgEarningsMove,
}: {
  ticker: string;
  o: Options;
  asOf: string;
  avgEarningsMove: N;
}) {
  const theme = useThemeColors();
  const blue = theme.dark ? "#5b9dff" : "#2563eb";
  const term = {
    animation: false,
    grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", valueFormatter: (v: number) => pct(v) },
    legend: {
      data: ["Expected move (±)", "At-the-money IV"],
      textStyle: { color: theme.muted },
      top: 0,
    },
    xAxis: {
      type: "category",
      data: o.term.map(
        (t) => `${day(t.exp).replace(/, \d{4}$/, "")} (${t.dte}d)`,
      ),
      axisLabel: { color: theme.muted },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: "value",
        axisLabel: {
          color: theme.muted,
          formatter: (v: number) => `±${(v * 100).toFixed(0)}%`,
        },
        splitLine: { lineStyle: { color: theme.grid } },
      },
      {
        type: "value",
        axisLabel: {
          color: theme.muted,
          formatter: (v: number) => `${(v * 100).toFixed(0)}%`,
        },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        type: "bar",
        name: "Expected move (±)",
        data: o.term.map((t) => t.move),
        itemStyle: { color: theme.fg, opacity: 0.75 },
        barMaxWidth: 26,
      },
      {
        type: "line",
        name: "At-the-money IV",
        yAxisIndex: 1,
        data: o.term.map((t) => t.iv),
        itemStyle: { color: blue },
        lineStyle: { color: blue, width: 2 },
      },
    ],
  };
  const oi = {
    animation: false,
    grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis" },
    legend: {
      data: ["Calls", "Puts"],
      textStyle: { color: theme.muted },
      top: 0,
    },
    xAxis: {
      type: "category",
      data: o.oi_by_strike.map(([s]) => `$${s}`),
      axisLabel: { color: theme.muted },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: theme.muted, formatter: (v: number) => k(v) },
      splitLine: { lineStyle: { color: theme.grid } },
    },
    series: [
      {
        type: "bar",
        name: "Calls",
        data: o.oi_by_strike.map(([, c]) => c),
        itemStyle: { color: theme.fg, opacity: 0.75 },
        markLine: {
          symbol: "none",
          label: {
            formatter: "Stock $" + o.spot.toFixed(0),
            color: theme.muted,
          },
          lineStyle: { color: theme.muted, type: "dashed" },
          data: [
            {
              xAxis: closest(
                o.oi_by_strike.map(([s]) => s),
                o.spot,
              ),
            },
          ],
        },
      },
      {
        type: "bar",
        name: "Puts",
        data: o.oi_by_strike.map(([, , p]) => p),
        itemStyle: { color: blue, opacity: 0.8 },
      },
    ],
  };
  const lines = reading(ticker, o, avgEarningsMove);

  return (
    <div className="space-y-12">
      <section>
        <h2 className="flex items-center border-b border-border pb-3 text-xl font-semibold tracking-tight">
          <Term k="options_overview" quiet>
            What options are pricing
          </Term>
        </h2>
        <p className="mt-2 text-sm text-muted">
          From {k(o.contracts)} listed contracts across {o.expirations}{" "}
          expirations. Cboe delayed quotes (15 minutes) as of{" "}
          {asOf.slice(0, 10)}; stock ${o.spot.toFixed(2)}.
        </p>
        {o.earnings && (
          <div className="mt-4 rounded-2xl border border-border p-4">
            <p className="flex items-center text-xs text-muted">
              <Term k="earnings_day_move">Earnings {day(o.earnings.date)}</Term>
            </p>
            {o.earnings.day_move != null ? (
              <>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  ±{pct(o.earnings.day_move)}
                </p>
                <p className="text-sm text-muted">
                  earnings-day move options imply — the {day(o.earnings.exp)}{" "}
                  straddle (±{pct(o.earnings.move)}) minus the ordinary movement
                  priced by the {day(o.earnings.before_exp ?? o.earnings.exp)}{" "}
                  expiry
                  {avgEarningsMove != null &&
                    ` · past earnings days averaged ±${pct(avgEarningsMove)}`}
                </p>
              </>
            ) : (
              <>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  ±{pct(o.earnings.move)}
                </p>
                <p className="text-sm text-muted">
                  move priced through {day(o.earnings.exp)} by the $
                  {o.earnings.strike} straddle ($
                  {o.earnings.straddle.toFixed(2)}), including the ordinary days
                  before the report
                  {avgEarningsMove != null &&
                    ` · past earnings days averaged ±${pct(avgEarningsMove)}`}
                </p>
              </>
            )}
          </div>
        )}
        <div className="mt-3 text-right">
          <AboutNumbers
            title="About options data"
            keys={[
              "options_overview",
              "expected_move",
              "earnings_day_move",
              "iv30",
              "iv_rank",
              "skew25",
              "max_pain",
              "put_call_volume",
              "put_call_oi",
              "open_interest",
              "most_active",
            ]}
          />
        </div>
        <ul className="mt-2 space-y-2 rounded-xl bg-card px-4 py-3 text-sm leading-relaxed">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <Stat
            label="Implied volatility (30 day)"
            info="iv30"
            value={pct(o.iv30, 0)}
            sub={`Actual last 30 days: ${pct(o.realized30, 0)}`}
          />
          <Stat
            label="IV rank (1 yr)"
            info="iv_rank"
            value={o.iv_rank == null ? "Building" : pct(o.iv_rank, 0)}
            sub={
              o.iv_rank == null
                ? `${o.iv_history_days} of 60 days of history so far`
                : "0% = lowest IV of the year, 100% = highest"
            }
          />
          <Stat
            label="Skew (25-delta)"
            info="skew25"
            value={o.skew ? pct(o.skew.skew) : "—"}
            sub={
              o.skew
                ? `Put IV ${pct(o.skew.put_iv, 0)} vs call IV ${pct(o.skew.call_iv, 0)}`
                : undefined
            }
          />
          <Stat
            label="Max pain"
            info="max_pain"
            value={o.max_pain == null ? "—" : `$${o.max_pain}`}
            sub={`${day(o.month_exp)} expiry`}
          />
          <Stat
            label="Put/call ratio (volume)"
            info="put_call_volume"
            value={
              o.put_call_volume == null ? "—" : o.put_call_volume.toFixed(2)
            }
            sub={`${k(o.volume.puts)} puts · ${k(o.volume.calls)} calls today`}
          />
          <Stat
            label="Put/call ratio (open interest)"
            info="put_call_oi"
            value={o.put_call_oi == null ? "—" : o.put_call_oi.toFixed(2)}
            sub={`${k(o.open_interest.puts)} puts · ${k(o.open_interest.calls)} calls open`}
          />
        </dl>
      </section>

      <section>
        <h2 className="flex items-center border-b border-border pb-3 text-xl font-semibold tracking-tight">
          <Term k="expected_move" quiet>
            Expected move by expiration
          </Term>
        </h2>
        <p className="mt-2 text-sm text-muted">
          At-the-money straddle price ÷ stock price: roughly how far options
          expect the stock could move by each date, in either direction.
        </p>
        <EChart
          option={term}
          className="mt-3 h-64 w-full"
          ariaLabel={`${ticker} expected move and implied volatility by expiration`}
        />
        <ExportTable name="options">
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2 pr-3 font-normal">Expiration</th>
                <th className="py-2 pr-3 text-right font-normal">
                  Expected move
                </th>
                <th className="py-2 pr-3 text-right font-normal">Range</th>
                <th className="py-2 text-right font-normal">ATM IV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {o.term.slice(0, 8).map((t) => (
                <tr key={t.exp}>
                  <td className="py-2 pr-3">
                    {day(t.exp)}{" "}
                    <span className="text-xs text-muted">{t.dte}d</span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    ±{pct(t.move)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted">
                    ${(o.spot * (1 - t.move)).toFixed(0)}–$
                    {(o.spot * (1 + t.move)).toFixed(0)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {pct(t.iv, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ExportTable>
      </section>

      <section>
        <h2 className="flex items-center border-b border-border pb-3 text-xl font-semibold tracking-tight">
          <Term k="open_interest" quiet>
            Where the open positions are
          </Term>
        </h2>
        <p className="mt-2 text-sm text-muted">
          Open interest by strike for the {day(o.month_exp)} expiration (strikes
          within 30% of the stock price).
        </p>
        <EChart
          option={oi}
          className="mt-3 h-64 w-full"
          ariaLabel={`${ticker} open interest by strike`}
        />
        <div className="mt-6 grid gap-8 lg:grid-cols-2">
          <Contracts title="Most active contracts today" rows={o.most_active} />
          <Contracts
            title={`Largest open interest, ${day(o.month_exp)}`}
            rows={[...o.top_oi_calls, ...o.top_oi_puts].sort(
              (a, b) => b.oi - a.oi,
            )}
          />
        </div>
      </section>
      <p className="text-xs text-muted">
        Options involve substantial risk and aren&apos;t suitable for every
        investor. Expected moves are a rough market-implied range, not a
        prediction. Data: Cboe delayed quotes. Research, not investment advice.
      </p>
    </div>
  );
}

function closest(xs: number[], v: number): string | undefined {
  if (!xs.length) return undefined;
  const best = xs.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  return `$${best}`;
}
