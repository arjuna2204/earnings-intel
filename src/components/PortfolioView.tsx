"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import ExportTable from "@/components/ExportTable";
import SearchBox from "@/components/SearchBox";
import Term from "@/components/Term";
import type { Holding } from "@/lib/portfolio";

// Holdings live only in this browser: { ticker, shares }[]
const KEY = "ei.portfolio";
type Position = { ticker: string; shares: number };
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const readRaw = () => {
  try {
    return localStorage.getItem(KEY) ?? "[]";
  } catch {
    return "[]";
  }
};
function parse(raw: string): Position[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((p) => p && typeof p.ticker === "string").map((p) => ({ ticker: p.ticker, shares: Number(p.shares) || 0 })) : [];
  } catch {
    return [];
  }
}
function save(list: Position[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage blocked */
  }
  listeners.forEach((cb) => cb());
}

const money = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const date = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** Group the many ways companies name regions into a few buckets everyone understands. */
const US = "United States";
const AMERICAS_ALL = "Americas (US not split out)";
const INTL = "International, not split further";
const ORDER = [US, AMERICAS_ALL, "Canada & Latin America", "Europe, Middle East & Africa", "China & Hong Kong", "Rest of Asia-Pacific", INTL];
function bucket(label: string): string {
  const l = label.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[“”"]/g, "").trim();
  if (/non-?\s?u\.?s|outside the u|international|foreign|rest of (the )?world|^row$|^other\b(?!.*(americ|europ|asia|pacific|african))|all other|int[’']l|emerging|developed|high-growth/.test(l)) return INTL;
  if (/china|hong kong/.test(l)) return "China & Hong Kong";
  if (/^(the )?americas$|^north america|^americas\s*\d*$|in north america|us & canada/.test(l)) return AMERICAS_ALL;
  if (/americas|canada|latin|mexico|brazil|chile|peru|caribbean|argentina|colombia/.test(l)) return "Canada & Latin America";
  if (/^(in )?(the )?(u\.?\s?s\.?a?\.?|united states|domestic)(\s|$)/.test(l)) return US;
  if (/europe|emea|eame|middle east|africa|germany|united kingdom|^u\.?k\.?$|france|ireland|netherlands|switzerland|spain|italy|norway|israel|russia|libya|guinea|sweden|denmark|belgium/.test(l)) return "Europe, Middle East & Africa";
  if (/asia|apac|pacific|japan|taiwan|korea|india|singapore|australia|indonesia|malaysia|thailand|vietnam|philippines/.test(l)) return "Rest of Asia-Pacific";
  return INTL;
}
const byOrder = (a: { label: string }, b: { label: string }) => ORDER.indexOf(a.label) - ORDER.indexOf(b.label);

function Bars({ rows }: { rows: { label: string; share: number }[] }) {
  return (
    <ul className="mt-3 space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,12rem)_1fr_3.5rem] items-center gap-3 text-sm">
          <span className="truncate">{r.label}</span>
          <span className="h-2 rounded-full bg-card">
            <span className="block h-2 rounded-full bg-accent" style={{ width: `${Math.min(100, r.share * 100)}%` }} />
          </span>
          <span className="text-right tabular-nums">{pct(r.share)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function PortfolioView() {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "[]");
  const positions = useMemo(() => parse(raw), [raw]);
  const [data, setData] = useState<Record<string, Holding>>({});
  const [loading, setLoading] = useState(false);
  const [paste, setPaste] = useState("");
  const tickers = positions.map((p) => p.ticker).sort().join(",");

  useEffect(() => {
    if (!tickers) return;
    let live = true;
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`/api/portfolio?t=${encodeURIComponent(tickers)}`)
        .then((r) => r.json())
        .then((j: { holdings?: Holding[] }) => {
          if (live) setData(Object.fromEntries((j.holdings ?? []).map((h) => [h.ticker, h])));
        })
        .catch(() => {})
        .finally(() => live && setLoading(false));
    }, 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [tickers]);

  const add = (ticker: string, shares = 0) => {
    const t = ticker.toUpperCase();
    const rest = positions.filter((p) => p.ticker !== t);
    const prev = positions.find((p) => p.ticker === t);
    save([...rest, { ticker: t, shares: shares || prev?.shares || 0 }]);
  };
  const setShares = (ticker: string, shares: number) => save(positions.map((p) => (p.ticker === ticker ? { ...p, shares } : p)));
  const remove = (ticker: string) => save(positions.filter((p) => p.ticker !== ticker));
  const importPaste = () => {
    // one holding per line: "AAPL 10", "MSFT, 5.5", "NVDA	20"
    const found = paste
      .split(/\n|;/)
      .map((l) => l.trim().match(/^([A-Za-z][A-Za-z0-9.\-]{0,9})[\s,:\t]+([\d,]*\.?\d+)/))
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .map((m) => ({ ticker: m[1].toUpperCase(), shares: Number(m[2].replace(/,/g, "")) }));
    if (!found.length) return;
    const map = new Map(positions.map((p) => [p.ticker, p]));
    for (const f of found) map.set(f.ticker, f);
    save([...map.values()]);
    setPaste("");
  };

  const rows = positions
    .map((p) => {
      const h = data[p.ticker];
      const value = h?.price != null ? h.price * p.shares : null;
      return { p, h, value };
    })
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const total = rows.reduce((a, r) => a + (r.value ?? 0), 0);
  const priced = rows.filter((r) => r.value != null && r.value > 0);
  const w = (v: number | null) => (v != null && total > 0 ? v / total : 0);

  const income = priced.reduce((a, r) => a + (r.h?.dps ?? 0) * r.p.shares, 0);
  const betaRows = priced.filter((r) => r.h?.beta != null);
  const betaW = betaRows.reduce((a, r) => a + w(r.value), 0);
  const beta = betaW > 0.5 ? betaRows.reduce((a, r) => a + w(r.value) * (r.h!.beta as number), 0) / betaW : null;
  const retRows = priced.filter((r) => r.h?.ret1y != null);
  const retW = retRows.reduce((a, r) => a + w(r.value), 0);
  const ret1y = retW > 0.5 ? retRows.reduce((a, r) => a + w(r.value) * (r.h!.ret1y as number), 0) / retW : null;

  const sectors = new Map<string, number>();
  for (const r of priced) {
    const k = (r.h?.sector ?? "Unclassified").replace(/ sector$/i, "");
    sectors.set(k, (sectors.get(k) ?? 0) + w(r.value));
  }
  const sectorRows = [...sectors.entries()].map(([label, share]) => ({ label, share })).sort((a, b) => b.share - a.share);

  const regions = new Map<string, number>();
  let regionCovered = 0;
  for (const r of priced) {
    if (!r.h?.regions.length) continue;
    regionCovered += w(r.value);
    for (const g of r.h.regions) regions.set(bucket(g.label), (regions.get(bucket(g.label)) ?? 0) + w(r.value) * g.share);
  }
  const regionRows = [...regions.entries()].map(([label, share]) => ({ label, share: regionCovered ? share / regionCovered : 0 })).sort(byOrder);
  const usShare = regionRows.find((r) => r.label === US)?.share ?? 0;
  const splitUs = !regionRows.some((r) => r.label === AMERICAS_ALL);

  const upcoming = priced
    .filter((r) => r.h?.nextEarnings)
    .sort((a, b) => (a.h!.nextEarnings as string).localeCompare(b.h!.nextEarnings as string))
    .slice(0, 10);
  const top = priced[0];
  const top3 = priced.slice(0, 3).reduce((a, r) => a + w(r.value), 0);

  return (
    <div className="mt-6 space-y-10">
      <section aria-label="Add holdings" className="rounded-2xl border border-border p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h2 className="text-sm font-semibold">Add a stock</h2>
            <div className="mt-2">
              <SearchBox onPick={(t) => add(t)} placeholder="Search a ticker or company to add" />
            </div>
          </div>
          <div>
            <h2 className="text-sm font-semibold">Or paste your holdings</h2>
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={3}
              placeholder={"AAPL 10\nMSFT 5\nNVDA 20"}
              aria-label="Paste holdings, one per line: ticker then shares"
              className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button type="button" onClick={importPaste} className="mt-1 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-black hover:brightness-110">
              Add these
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">Your holdings stay in this browser. Only the ticker symbols are sent to look up prices; share counts never leave your device.</p>
      </section>

      {positions.length === 0 ? (
        <p className="text-center text-sm text-muted">Add a few holdings to see your exposure, dividend income, risk and upcoming earnings.</p>
      ) : (
        <>
          <section aria-label="Summary">
            {top && total > 0 && (
              <p className="text-lg leading-snug">
                {money(total)} across {priced.length} {priced.length === 1 ? "stock" : "stocks"}.{" "}
                {w(top.value) > 0.25
                  ? `${top.p.ticker} alone is ${pct(w(top.value), 0)} of it — a big bet on one company.`
                  : `Your three largest holdings are ${pct(top3, 0)} of the total.`}
              </p>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted">Total value</dt>
                <dd className="mt-0.5 text-2xl font-semibold tabular-nums">{money(total)}</dd>
              </div>
              <div>
                <dt className="flex items-center text-xs text-muted">
                  <Term k="dividend_yield">Dividend income / yr</Term>
                </dt>
                <dd className="mt-0.5 text-2xl font-semibold tabular-nums">{money(income)}</dd>
                <dd className="text-xs text-muted">{total ? `${pct(income / total, 2)} yield` : ""}</dd>
              </div>
              <div>
                <dt className="flex items-center text-xs text-muted">
                  <Term k="beta">Portfolio beta</Term>
                </dt>
                <dd className="mt-0.5 text-2xl font-semibold tabular-nums">{beta != null ? beta.toFixed(2) : "—"}</dd>
                <dd className="text-xs text-muted">{beta == null ? "needs fully researched stocks" : beta > 1.15 ? "swings more than the market" : beta < 0.85 ? "calmer than the market" : "moves about with the market"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">1-year return (today&apos;s mix)</dt>
                <dd className={`mt-0.5 text-2xl font-semibold tabular-nums ${ret1y == null ? "" : ret1y >= 0 ? "text-up" : "text-down"}`}>
                  {ret1y == null ? "—" : `${ret1y >= 0 ? "▲" : "▼"} ${pct(Math.abs(ret1y))}`}
                </dd>
              </div>
            </dl>
          </section>

          <section aria-label="Holdings">
            <h2 className="border-b border-border pb-3 text-xl font-semibold tracking-tight">Holdings{loading && <span className="ml-2 text-sm font-normal text-muted">updating…</span>}</h2>
            <ExportTable name="portfolio">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm tabular-nums">
                  <thead className="text-xs text-muted">
                    <tr className="border-b border-border">
                      <th className="py-2 text-left font-medium">Stock</th>
                      <th className="py-2 text-right font-medium">Shares</th>
                      <th className="py-2 text-right font-medium">Price</th>
                      <th className="py-2 text-right font-medium">Value</th>
                      <th className="py-2 text-right font-medium">Weight</th>
                      <th className="py-2 text-right font-medium">1Y</th>
                      <th className="py-2 text-right font-medium">Div. yield</th>
                      <th className="py-2 text-right font-medium">Next report</th>
                      <th className="py-2" aria-label="Remove" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map(({ p, h, value }) => (
                      <tr key={p.ticker}>
                        <td className="max-w-[14rem] py-2 pr-2">
                          <Link href={`/c/${encodeURIComponent(p.ticker)}`} className="hover:underline">
                            <span className="font-semibold">{p.ticker}</span>
                            <span className="block truncate text-xs text-muted">{h ? (h.covered === "none" ? "Not covered yet — open to load" : h.name) : "…"}</span>
                          </Link>
                        </td>
                        <td className="py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={p.shares || ""}
                            placeholder="0"
                            onChange={(e) => setShares(p.ticker, Number(e.target.value) || 0)}
                            aria-label={`Shares of ${p.ticker}`}
                            className="w-24 rounded-lg border border-border bg-transparent px-2 py-1 text-right"
                          />
                        </td>
                        <td className="py-2 text-right">{h?.price != null ? `$${h.price.toFixed(2)}` : "—"}</td>
                        <td className="py-2 text-right">{value != null ? money(value) : "—"}</td>
                        <td className="py-2 text-right">{value != null && total ? pct(w(value)) : "—"}</td>
                        <td className={`py-2 text-right ${h?.ret1y == null ? "text-muted" : h.ret1y >= 0 ? "text-up" : "text-down"}`}>
                          {h?.ret1y == null ? "—" : `${h.ret1y >= 0 ? "▲" : "▼"} ${pct(Math.abs(h.ret1y))}`}
                        </td>
                        <td className="py-2 text-right">{h?.divYield != null ? pct(h.divYield, 2) : "—"}</td>
                        <td className="py-2 text-right text-muted">{h?.nextEarnings ? date(h.nextEarnings) : "—"}</td>
                        <td className="py-2 pl-2 text-right">
                          <button type="button" onClick={() => remove(p.ticker)} aria-label={`Remove ${p.ticker}`} className="text-muted hover:text-foreground">
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ExportTable>
          </section>

          {sectorRows.length > 0 && (
            <div className="grid gap-10 md:grid-cols-2">
              <section aria-label="Sectors">
                <h2 className="border-b border-border pb-3 text-xl font-semibold tracking-tight">By sector</h2>
                <Bars rows={sectorRows} />
              </section>
              <section aria-label="Regions">
                <h2 className="flex items-center border-b border-border pb-3 text-xl font-semibold tracking-tight">
                  <Term k="segments" quiet>Where the sales come from</Term>
                </h2>
                {regionRows.length ? (
                  <>
                    {splitUs && (
                      <p className="mt-3 text-sm">
                        About <b>{pct(usShare, 0)}</b> of the sales behind your holdings come from the US and <b>{pct(1 - usShare, 0)}</b> from abroad.
                      </p>
                    )}
                    <Bars rows={regionRows} />
                    <p className="mt-2 text-xs text-muted">
                      Revenue by region from each company&apos;s 10-K, weighted by your holdings. Covers {pct(regionCovered, 0)} of the portfolio; companies split regions
                      differently, so buckets are approximate.
                    </p>
                  </>
                ) : (
                  <p className="mt-3 text-sm text-muted">Needs fully researched companies that report revenue by region.</p>
                )}
              </section>
            </div>
          )}

          {upcoming.length > 0 && (
            <section aria-label="Upcoming earnings">
              <h2 className="border-b border-border pb-3 text-xl font-semibold tracking-tight">Upcoming earnings</h2>
              <ul className="divide-y divide-border">
                {upcoming.map((r) => (
                  <li key={r.p.ticker} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2.5 text-sm">
                    <span>
                      <span className="tabular-nums text-muted">{date(r.h!.nextEarnings as string)}</span> <span className="ml-2 font-semibold">{r.p.ticker}</span>{" "}
                      <span className="text-muted">{money(r.value as number)} held</span>
                    </span>
                    {r.h?.expectedMove != null && (
                      <span className="tabular-nums">
                        <Term k="earnings_day_move" quiet>Options expect</Term> ±{pct(r.h.expectedMove)}{" "}
                        <span className="text-muted">≈ ±{money((r.value as number) * r.h.expectedMove)}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-xs text-muted">Prices are the latest daily closes (delayed). Not investment advice.</p>
        </>
      )}
    </div>
  );
}
