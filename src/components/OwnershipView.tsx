"use client";

import ShowNumbers from "@/components/ShowNumbers";
import Term, { AboutNumbers } from "@/components/Term";
import { useState } from "react";
import EChart from "@/components/EChart";
import { useThemeColors } from "@/components/useThemeColors";
import type {
  Holders,
  HolderRow,
  InsiderSummary,
  InsiderTrade,
} from "@/lib/ownership";

const CODE: Record<string, string> = {
  P: "Bought",
  S: "Sold",
  A: "Award",
  M: "Option exercise",
  X: "Option exercise",
  F: "Tax withholding",
  G: "Gift",
  D: "Returned to company",
  C: "Conversion",
  J: "Other",
  W: "Inheritance",
};

function money(v: number | null | undefined): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  const s =
    a >= 1e9
      ? `${(a / 1e9).toFixed(2)}B`
      : a >= 1e6
        ? `${(a / 1e6).toFixed(1)}M`
        : a >= 1e3
          ? `${(a / 1e3).toFixed(0)}K`
          : a.toFixed(0);
  return `$${s}`;
}
function num(v: number | null | undefined): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  return a >= 1e9
    ? `${(a / 1e9).toFixed(2)}B`
    : a >= 1e6
      ? `${(a / 1e6).toFixed(1)}M`
      : a >= 1e3
        ? `${(a / 1e3).toFixed(1)}K`
        : a.toFixed(0);
}
const pct = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : `${(v * 100).toFixed(d)}%`;

function Delta({
  v,
  fmt,
}: {
  v: number | null | undefined;
  fmt: (x: number) => string;
}) {
  if (v == null || v === 0)
    return <span className="text-muted">{v === 0 ? "No change" : "—"}</span>;
  return (
    <span className={v > 0 ? "text-up" : "text-down"}>
      {v > 0 ? "▲" : "▼"} {fmt(Math.abs(v))}
    </span>
  );
}

export default function OwnershipView({
  ticker,
  trades,
  summary,
  holders,
  asOf,
}: {
  ticker: string;
  trades: InsiderTrade[];
  summary: InsiderSummary;
  holders: Holders | null;
  asOf: string;
}) {
  return (
    <div className="space-y-12">
      <nav
        className="flex flex-wrap items-center gap-4 text-sm text-muted"
        aria-label="Sections"
      >
        <a href="#insiders" className="hover:text-foreground">
          Insider trades
        </a>
        <a href="#institutions" className="hover:text-foreground">
          Institutions (13F)
        </a>
        <span className="ml-auto">
          <AboutNumbers
            title="About ownership data"
            keys={[
              "insider_trades",
              "open_market",
              "plan_10b5_1",
              "institutions_13f",
              "funds_holding",
              "pct_held",
              "holdings_change",
              "largest_holders",
              "fund_movers",
            ]}
          />
        </span>
      </nav>
      <Insiders ticker={ticker} trades={trades} s={summary} asOf={asOf} />
      <Institutions ticker={ticker} h={holders} />
    </div>
  );
}

// ---------------------------------------------------------------- insiders

function insiderVerdict(s: InsiderSummary): string {
  if (!s.buys && !s.sells)
    return `No open-market buying or selling by insiders in the last ${s.months} months.`;
  if (s.buys > s.sells)
    return `Insiders were net buyers: ${money(s.buys)} bought vs ${money(s.sells)} sold. Insiders buy with their own money for one reason — they expect the stock to rise — so buying is the rarer, stronger signal.`;
  const planned =
    s.plannedSellPct != null && s.plannedSellPct >= 0.5
      ? ` ${pct(s.plannedSellPct, 0)} of sales were pre-scheduled (10b5-1 plans), which usually say little about the outlook.`
      : "";
  return `Insiders were net sellers: ${money(s.sells)} sold vs ${money(s.buys)} bought.${planned} Executives sell for many reasons (taxes, diversifying, buying a house); selling is common and a weaker signal than buying.`;
}

function Insiders({
  ticker,
  trades,
  s,
  asOf,
}: {
  ticker: string;
  trades: InsiderTrade[];
  s: InsiderSummary;
  asOf: string;
}) {
  const theme = useThemeColors();
  const [all, setAll] = useState(false);
  const [more, setMore] = useState(false);
  // monthly open-market buys (+) and sells (−), last 24 months
  const end = new Date(`${asOf}T00:00:00Z`);
  const months: string[] = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1),
    );
    months.push(d.toISOString().slice(0, 7));
  }
  const buys = months.map(() => 0);
  const sells = months.map(() => 0);
  for (const t of trades) {
    if (!t.trade_date || (t.code !== "P" && t.code !== "S")) continue;
    const i = months.indexOf(t.trade_date.slice(0, 7));
    if (i < 0) continue;
    if (t.code === "P") buys[i] += t.value ?? 0;
    else sells[i] -= t.value ?? 0;
  }
  const option = {
    animation: false,
    grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      valueFormatter: (v: number) => money(Math.abs(v)),
    },
    xAxis: {
      type: "category",
      data: months.map((m) =>
        new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
          timeZone: "UTC",
        }),
      ),
      axisLabel: { color: theme.muted },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: theme.muted,
        formatter: (v: number) => money(Math.abs(v)),
      },
      splitLine: { lineStyle: { color: theme.grid } },
    },
    series: [
      {
        type: "bar",
        name: "▲ Bought",
        stack: "x",
        data: buys,
        itemStyle: { color: theme.up },
        barMaxWidth: 18,
      },
      {
        type: "bar",
        name: "▼ Sold",
        stack: "x",
        data: sells,
        itemStyle: { color: theme.down },
        barMaxWidth: 18,
      },
    ],
  };
  const shown = trades.filter((t) => all || t.code === "P" || t.code === "S");
  const rows = more ? shown.slice(0, 200) : shown.slice(0, 25);

  return (
    <section id="insiders" className="scroll-mt-32">
      <h2 className="flex items-center border-b border-border pb-3 text-xl font-semibold tracking-tight">
        <Term k="insider_trades" quiet>
          Insider trades
        </Term>
      </h2>
      <p className="mt-2 text-sm text-muted">
        Officers, directors and 10%+ owners must report trades in {ticker} stock
        to the SEC within two business days (Form 4).
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Stat
          label={`Bought (${s.months} mo.)`}
          info="open_market"
          value={money(s.buys)}
          sub={`${s.buyers} ${s.buyers === 1 ? "insider" : "insiders"} · open market`}
        />
        <Stat
          label={`Sold (${s.months} mo.)`}
          info="open_market"
          value={money(s.sells)}
          sub={`${s.sellers} ${s.sellers === 1 ? "insider" : "insiders"} · open market`}
        />
        <Stat
          label="Pre-scheduled sales"
          info="plan_10b5_1"
          value={pct(s.plannedSellPct, 0)}
          sub="Share of sales under 10b5-1 plans"
        />
        <Stat label="Latest buy or sale" value={s.lastTrade ?? "—"} />
      </dl>
      <p className="mt-4 rounded-xl bg-card px-4 py-3 text-sm">
        {insiderVerdict(s)}
      </p>
      <div className="mt-4 flex items-center gap-4 text-xs text-muted">
        <span>
          <span className="text-up">▲</span> Bought
        </span>
        <span>
          <span className="text-down">▼</span> Sold
        </span>
        <span>Open-market trades by month, last 24 months</span>
      </div>
      <EChart
        option={option}
        className="mt-2 h-56 w-full"
        ariaLabel={`Monthly insider buying and selling of ${ticker}`}
      />

      <ShowNumbers label="Show every transaction">
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Transactions</h3>
          <div className="flex gap-1" role="tablist">
            {[
              [false, "Buys & sells"],
              [true, "All activity"],
            ].map(([v, label]) => (
              <button
                key={String(label)}
                type="button"
                role="tab"
                aria-selected={all === v}
                onClick={() => setAll(v as boolean)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${all === v ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
              >
                {label as string}
              </button>
            ))}
          </div>
        </div>
        {all && (
          <p className="mt-1 text-xs text-muted">
            Awards, option exercises and tax withholding are routine pay
            mechanics, not buy/sell decisions.
          </p>
        )}
        {rows.length ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-2 pr-3 font-normal">Date</th>
                  <th className="py-2 pr-3 font-normal">Insider</th>
                  <th className="py-2 pr-3 font-normal">Type</th>
                  <th className="py-2 pr-3 text-right font-normal">Shares</th>
                  <th className="py-2 pr-3 text-right font-normal">Price</th>
                  <th className="py-2 pr-3 text-right font-normal">Value</th>
                  <th className="py-2 font-normal" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((t) => (
                  <tr key={`${t.accession}-${t.seq}`}>
                    <td className="py-2.5 pr-3 tabular-nums text-muted">
                      {t.trade_date}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className="block">{titleCase(t.owner)}</span>
                      <span className="text-xs text-muted">{t.role}</span>
                    </td>
                    <td className="py-2.5 pr-3">
                      {t.code === "P" ? (
                        <span className="text-up">▲ Bought</span>
                      ) : t.code === "S" ? (
                        <span className="text-down">▼ Sold</span>
                      ) : (
                        <span className="text-muted">
                          {CODE[t.code] ?? t.code}
                        </span>
                      )}
                      {t.plan_10b5_1 && t.code === "S" && (
                        <span className="ml-1.5 rounded-full bg-card px-1.5 py-0.5 text-[10px] text-muted">
                          plan
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {num(t.shares)}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {t.price ? `$${t.price.toFixed(2)}` : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {t.value ? money(t.value) : "—"}
                    </td>
                    <td className="py-2.5 text-right">
                      <a
                        href={t.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline"
                      >
                        Form 4 ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">
            {trades.length
              ? "No open-market buys or sales in the last two years — switch to All activity to see awards and exercises."
              : "No Form 4 filings loaded yet. They are read every morning."}
          </p>
        )}
        {shown.length > 25 && (
          <button
            type="button"
            onClick={() => setMore((m) => !m)}
            className="mt-3 text-sm text-muted underline-offset-2 hover:text-foreground hover:underline"
          >
            {more
              ? "Show fewer"
              : `Show ${Math.min(shown.length, 200) - 25} more`}
          </button>
        )}
      </ShowNumbers>
    </section>
  );
}

function titleCase(s: string): string {
  // SEC names are "LAST FIRST MIDDLE" in capitals
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------- institutions

function Institutions({ ticker, h }: { ticker: string; h: Holders | null }) {
  if (!h) {
    return (
      <section id="institutions" className="scroll-mt-32">
        <h2 className="flex items-center border-b border-border pb-3 text-xl font-semibold tracking-tight">
          <Term k="institutions_13f" quiet>
            Institutions (13F)
          </Term>
        </h2>
        <p className="mt-3 text-sm text-muted">
          Not loaded yet — institutional holdings are refreshed every morning
          from the SEC&apos;s quarterly 13F data.
        </p>
      </section>
    );
  }
  const r = h.result;
  const qLabel = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
  };
  const verdict =
    r.shares_change_pct == null
      ? null
      : `Funds that reported both quarters ${r.shares_change_pct >= 0 ? "added to" : "cut"} their ${ticker} holdings by ${pct(Math.abs(r.shares_change_pct))} in ${qLabel(h.period)}. Overall, ${r.new} opened new positions and ${r.added} added, while ${r.trimmed} trimmed and ${r.sold_out} sold out.`;
  return (
    <section id="institutions" className="scroll-mt-32">
      <h2 className="flex items-center border-b border-border pb-3 text-xl font-semibold tracking-tight">
        <Term k="institutions_13f" quiet>
          Institutions (13F)
        </Term>
      </h2>
      <p className="mt-2 text-sm text-muted">
        Funds managing $100M+ report their US stock holdings every quarter, up
        to 45 days after it ends. Holdings as of {h.period}
        {h.prior_period ? `, compared with ${h.prior_period}` : ""}. Shares only
        — options excluded.
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Stat
          label="Funds holding"
          info="funds_holding"
          value={r.holders.toLocaleString()}
          sub={
            r.prior_holders != null ? (
              <Delta
                v={r.holders - r.prior_holders}
                fmt={(x) => `${x.toLocaleString()} funds`}
              />
            ) : undefined
          }
        />
        <Stat
          label="Share of company held"
          info="pct_held"
          value={pct(r.pct_out, 0)}
          sub="By 13F filers"
        />
        <Stat
          label="Holdings change"
          info="holdings_change"
          value={r.shares_change_pct == null ? "—" : ""}
          sub={<Delta v={r.shares_change_pct} fmt={(x) => pct(x)} />}
        />
        <Stat
          label="Value held"
          info="institutions_13f"
          value={money(r.value)}
        />
      </dl>
      {verdict && (
        <p className="mt-4 rounded-xl bg-card px-4 py-3 text-sm">{verdict}</p>
      )}

      <ShowNumbers label="Show the largest holders and biggest buyers and sellers">
        <h3 className="mt-6 flex items-center font-semibold">
          <Term k="largest_holders" quiet>
            Largest holders
          </Term>
        </h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2 pr-3 font-normal">Fund</th>
                <th className="py-2 pr-3 text-right font-normal">Shares</th>
                <th className="py-2 pr-3 text-right font-normal">
                  % of company
                </th>
                <th className="py-2 text-right font-normal">
                  Change vs prior quarter
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {r.top.map((x) => (
                <tr key={x.filer_cik}>
                  <td className="py-2.5 pr-3">{fundName(x.name)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">
                    {num(x.shares)}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">
                    {pct(x.pct_out, 2)}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">
                    {x.status === "new" ? (
                      <span className="text-up">▲ New position</span>
                    ) : (
                      <Delta v={x.change} fmt={num} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-8 grid gap-8 sm:grid-cols-2">
          <Movers title="Biggest buyers" rows={r.buyers} />
          <Movers title="Biggest sellers" rows={r.sellers} />
        </div>
      </ShowNumbers>
      <p className="mt-4 text-xs text-muted">
        Source: SEC Form 13F data sets. Managers are listed as they file; one
        firm can file under several entities.
      </p>
    </section>
  );
}

function Movers({ title, rows }: { title: string; rows: HolderRow[] }) {
  return (
    <div>
      <h3 className="flex items-center font-semibold">
        <Term k="fund_movers" quiet>
          {title}
        </Term>
      </h3>
      <ul className="mt-2 divide-y divide-border text-sm">
        {rows.map((x) => (
          <li
            key={x.filer_cik}
            className="flex items-baseline justify-between gap-3 py-2"
          >
            <span className="min-w-0 truncate">
              {fundName(x.name)}
              {(x.status === "new" || x.status === "sold out") && (
                <span className="ml-1.5 text-xs text-muted">
                  {x.status === "new" ? "new" : "sold out"}
                </span>
              )}
            </span>
            <span className="shrink-0 tabular-nums">
              <Delta v={x.change} fmt={(v) => `${num(v)} sh`} />
            </span>
          </li>
        ))}
        {!rows.length && <li className="py-2 text-muted">None</li>}
      </ul>
    </div>
  );
}

function fundName(s: string): string {
  return s.replace(/\b([A-Z])([A-Z]+)\b/g, (_, a: string, b: string) =>
    [
      "LLC",
      "LP",
      "LTD",
      "INC",
      "PLC",
      "AG",
      "NA",
      "SA",
      "UK",
      "US",
      "JPMORGAN",
    ].includes(a + b)
      ? a + b
      : a + b.toLowerCase(),
  );
}

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
        <Term k={info} value={value || undefined}>
          {label}
        </Term>
      </dt>
      {value && (
        <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
      )}
      {sub && (
        <dd
          className={`text-xs text-muted ${value ? "" : "mt-0.5 text-lg font-semibold"}`}
        >
          {sub}
        </dd>
      )}
    </div>
  );
}
