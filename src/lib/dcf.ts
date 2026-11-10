import "server-only";
import { select } from "@/lib/db";
import { getFlags } from "@/lib/quality";

export type Assumption = { value: number; label: string; source: string; notes?: number[] };
export type Footnote = { id: number; text: string; url: string | null };
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
    footnotes?: Footnote[];
    fy_notes?: Record<string, number[]>;
    model_notes?: number[];
  } | null;
  created_at: string;
};

export async function getDcf(cik: number): Promise<DcfModel | null> {
  const [rows, flags] = await Promise.all([
    select<DcfModel>("dcf_models", { cik: `eq.${cik}`, select: "status,note,history,assumptions,result,created_at" }),
    getFlags(cik),
  ]);
  const dcf = rows[0] ?? null;
  const held = flags.find((f) => f.severity === "hide" && f.fields.includes("dcf"));
  // a model that failed the daily sanity check is shown as unavailable, with the reason
  if (dcf && held) return { ...dcf, status: "not_applicable", note: `${held.message} The model is held back until the inputs check out.` };
  return dcf;
}
