import "server-only";
import { select } from "@/lib/db";

type Num = number | null;
export type Risk = {
  as_of: string;
  years_of_history: number;
  volatility: { d30: Num; y1: Num; market_y1: Num; rolling: [string, number][] };
  market_rolling: [string, number][];
  beta: { y1: Num; y3: Num; corr_y1: Num; corr_y3: Num; sector_y1: Num; sector_corr_y1: Num };
  returns: { y1: Num; market_y1: Num };
  sharpe: { y1: Num; y3: Num; market_y1: Num };
  sortino: { y1: Num; y3: Num };
  var95: Num;
  cvar95: Num;
  skew: Num;
  excess_kurtosis: Num;
  drawdown: {
    current: number;
    y1: { max: number; peak: string | null; trough: string | null };
    y5: { max: number; peak: string | null; trough: string | null };
    all: { max: number; peak: string | null; trough: string | null };
    series: [string, number][];
  };
  capture: { up: Num; down: Num };
  up_days_pct: Num;
  best_days: [string, number][];
  worst_days: [string, number][];
  histogram: [number, number][];
  seasonality: { month: number; avg: number; pct_up: number; years: number }[];
  earnings_moves: { date: string; quarter: string; move: number }[];
  avg_earnings_move: Num;
  fundamental: {
    piotroski: { score: number; out_of: number; fiscal_year: number; checks: { label: string; pass: boolean | null }[] } | null;
    interest_coverage: Num;
    net_debt_to_ebitda: Num;
    sbc_pct_revenue: Num;
    share_change_1y: Num;
    share_change_3y: Num;
  };
};

export type OptContract = { symbol: string; exp: string; cp: "C" | "P"; strike: number; volume: number; oi: number; iv: Num; mid: Num };
export type Options = {
  spot: number;
  as_of: string;
  iv30: Num;
  realized30: Num;
  iv_rank: Num;
  iv_history_days: number;
  term: { exp: string; dte: number; strike: number; straddle: number; move: number; iv: Num }[];
  earnings: { date: string; exp: string; move: number; straddle: number; strike: number } | null;
  month_exp: string;
  skew: { put_iv: number; call_iv: number; skew: number; put_strike: number; call_strike: number } | null;
  max_pain: Num;
  put_call_volume: Num;
  put_call_oi: Num;
  volume: { calls: number; puts: number };
  open_interest: { calls: number; puts: number };
  top_oi_calls: OptContract[];
  top_oi_puts: OptContract[];
  most_active: OptContract[];
  oi_by_strike: [number, number, number][];
  expirations: number;
  contracts: number;
};

export async function getRisk(cik: number): Promise<Risk | null> {
  const rows = await select<{ result: Risk }>("risk_stats", { cik: `eq.${cik}`, select: "result" });
  return rows[0]?.result ?? null;
}

export async function getOptions(cik: number): Promise<{ result: Options; as_of: string } | null> {
  const rows = await select<{ result: Options; as_of: string }>("options_snapshot", { cik: `eq.${cik}`, select: "result,as_of" });
  return rows[0] ?? null;
}
