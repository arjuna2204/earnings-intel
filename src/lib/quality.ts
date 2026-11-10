import "server-only";
import { select, selectAll } from "@/lib/db";
import type { Valuation } from "@/lib/types";

/** A failed daily data-quality check (pipeline/ei/quality.py). "hide": the listed fields are held back. */
export type QualityFlag = { cik: number; check: string; severity: "hide" | "warn"; fields: string[]; message: string };

export async function getFlags(cik: number): Promise<QualityFlag[]> {
  return select<QualityFlag>("quality_flags", { cik: `eq.${cik}`, select: "cik,check,severity,fields,message" }).catch(() => []);
}

export async function getAllFlags(): Promise<QualityFlag[]> {
  return selectAll<QualityFlag>("quality_flags", { select: "cik,check,severity,fields,message" }).catch(() => []);
}

export function hiddenFields(flags: QualityFlag[]): Set<string> {
  return new Set(flags.filter((f) => f.severity === "hide").flatMap((f) => f.fields));
}

/** Copy of the valuation with flagged numbers removed (shown as "—" with the reason underneath). */
export function sanitizeValuation(v: Valuation | null, flags: QualityFlag[]): Valuation | null {
  if (!v) return v;
  const hide = hiddenFields(flags);
  const fields = [...hide].filter((f) => f in v);
  if (!fields.length) return v;
  const out = { ...v } as Record<string, unknown>;
  for (const f of fields) out[f] = null;
  return out as Valuation;
}
