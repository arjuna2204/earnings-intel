import "server-only";
import { select } from "@/lib/db";

export type Assumption = { value: number; label: string; source: string };
export type DcfRow = { year: number; revenue: number; growth: number; ebit: number; margin: number; nopat: number; da: number; capex: number; d_nwc: number; fcf: number; pv: number };
export type DcfModel = {
  status: "ok" | "not_applicable" | "insufficient";
  note: string | null;
  history: Record<string, number | string>[];
  assumptions: Record<string, Assumption>;
  result: {
    rows: DcfRow[];
    sum_pv: number;
    terminal_value: number | null;
    pv_terminal: number | null;
    enterprise_value: number;
    equity_value: number;
    per_share: number | null;
    upside: number | null;
    terminal_share: number | null;
    implied_exit_ev_ebitda: number | null;
    sensitivity: { waccs: number[]; growths: number[]; values: (number | null)[][] };
  } | null;
  created_at: string;
};

export async function getDcf(cik: number): Promise<DcfModel | null> {
  const rows = await select<DcfModel>("dcf_models", { cik: `eq.${cik}`, select: "status,note,history,assumptions,result,created_at" });
  return rows[0] ?? null;
}
