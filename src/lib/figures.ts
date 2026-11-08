// Shared formatting helpers (usable on the server and in the browser).
import type { Release, ReleaseFigure } from "@/lib/filings";

export type StreetRow = { label: string; a: string; b: string; note?: string; tone?: "up" | "down" | null; ref?: string };

export function figureText(f: ReleaseFigure | undefined, which: "current" | "prior" = "current"): string {
  if (!f) return "—";
  const v = which === "current" ? f.current : f.prior;
  if (v === null || v === undefined) return "—";
  if (f.unit === "percent") return `${v}%`;
  if (f.unit === "USD per share") return `$${v.toFixed(2)}`;
  const abs = which === "current" ? f.value : (f.prior_value ?? 0);
  return abs >= 1e9 ? `$${(abs / 1e9).toFixed(1)}B` : `$${(abs / 1e6).toFixed(0)}M`;
}

export function releaseFigure(r: Release | null | undefined, kind: string): ReleaseFigure | undefined {
  return r?.figures.find((f) => f.kind === kind);
}
