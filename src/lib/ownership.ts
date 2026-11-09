import "server-only";
import { select, selectAll } from "@/lib/db";

export type InsiderTrade = {
  accession: string;
  seq: number;
  filed_date: string;
  trade_date: string | null;
  owner: string;
  role: string | null;
  code: string;
  acquired: boolean | null;
  shares: number | null;
  price: number | null;
  value: number | null;
  owned_after: number | null;
  plan_10b5_1: boolean;
  url: string;
};

export type HolderRow = {
  filer_cik: number;
  name: string;
  shares: number;
  value: number;
  pct_out?: number | null;
  change: number | null;
  status: "new" | "added" | "trimmed" | "unchanged" | "sold out" | null;
};

export type Holders = {
  period: string;
  prior_period: string | null;
  created_at: string;
  result: {
    holders: number;
    shares: number;
    value: number;
    pct_out: number | null;
    prior_holders: number | null;
    prior_shares: number | null;
    shares_change_pct: number | null;
    new: number;
    added: number;
    trimmed: number;
    sold_out: number;
    top: HolderRow[];
    buyers: HolderRow[];
    sellers: HolderRow[];
  };
};

export type InsiderSummary = {
  months: number;
  buys: number; // $ open-market purchases
  sells: number; // $ open-market sales
  buyers: number; // distinct people
  sellers: number;
  plannedSellPct: number | null; // share of sale $ under 10b5-1 plans
  lastTrade: string | null;
};

export async function getInsiderTrades(cik: number, since: string): Promise<InsiderTrade[]> {
  return selectAll<InsiderTrade>("insider_trades", {
    cik: `eq.${cik}`,
    trade_date: `gte.${since}`,
    select: "accession,seq,filed_date,trade_date,owner,role,code,acquired,shares,price,value,owned_after,plan_10b5_1,url",
    order: "trade_date.desc,accession.desc,seq.asc",
  });
}

export async function getHolders(cik: number): Promise<Holders | null> {
  const rows = await select<Holders>("institutional_holders", { cik: `eq.${cik}`, select: "period,prior_period,result,created_at" });
  return rows[0] ?? null;
}

/** Open-market buying vs selling over the window ending at `asOf` (ISO date). */
export function summarizeInsiders(trades: InsiderTrade[], asOf: string, months = 12): InsiderSummary {
  const d = new Date(`${asOf}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  const from = d.toISOString().slice(0, 10);
  const win = trades.filter((t) => t.trade_date && t.trade_date >= from && (t.code === "P" || t.code === "S"));
  const buys = win.filter((t) => t.code === "P");
  const sells = win.filter((t) => t.code === "S");
  const sum = (xs: InsiderTrade[]) => xs.reduce((s, t) => s + (t.value ?? 0), 0);
  const sellTotal = sum(sells);
  return {
    months,
    buys: sum(buys),
    sells: sellTotal,
    buyers: new Set(buys.map((t) => t.owner)).size,
    sellers: new Set(sells.map((t) => t.owner)).size,
    plannedSellPct: sellTotal ? sum(sells.filter((t) => t.plan_10b5_1)) / sellTotal : null,
    lastTrade: win[0]?.trade_date ?? null,
  };
}
