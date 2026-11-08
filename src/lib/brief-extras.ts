// Code-computed visuals for the brief (no AI): verdict chips, beat/miss streak, GAAP→adjusted bridge.
import type { Brief, Release } from "@/lib/filings";
import type { CallComparison, EarningsEvent, GuidanceChange } from "@/lib/types";

export type Tone = "up" | "down" | "neutral" | "warn";
export type VerdictChip = { label: string; tone: Tone; target: string };
export type StreakItem = { label: string; reported: number; estimated: number; surprisePct: number };
export type BridgeStep = { label: string; value: number; computed?: boolean; quote?: string };
export type Bridge = { basis: string; unit: "per share" | "USD"; start: number; startLabel: string; steps: BridgeStep[]; end: number; endLabel: string };
export type Tile = { label: string; value: string; sub: string; tone: Tone };
export type BriefExtras = {
  verdict: VerdictChip[];
  tiles: Tile[];
  streak: StreakItem[];
  bridge: Bridge | null;
  guidance: GuidanceChange[];
  counts: { raised: number; lowered: number; dropped: number; added: number; escalated: number; riskAdded: number; riskRemoved: number };
};

const SCALE: Record<string, number> = { units: 1, thousands: 1e3, millions: 1e6, billions: 1e9 };
const pct = (x: number, d = 1) => `${x >= 0 ? "+" : ""}${x.toFixed(d)}%`;
const money = (v: number) => (Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v.toFixed(2)}`);

const evLabel = (e: EarningsEvent) => `FY${e.fiscal_year}Q${e.fiscal_quarter}`;

export function buildBridge(rel: Release | null | undefined): Bridge | null {
  if (!rel?.reports_non_gaap) return null;
  const pairs: [string, string, string, RegExp, Bridge["unit"]][] = [
    ["eps_gaap", "eps_adjusted", "Diluted EPS", /eps|per share/i, "per share"],
    ["net_income_gaap", "net_income_adjusted", "Net income", /net income/i, "USD"],
    ["operating_income_gaap", "operating_income_adjusted", "Operating income", /operating income/i, "USD"],
  ];
  for (const [g, a, basis, re, unit] of pairs) {
    const fg = rel.figures.find((f) => f.kind === g);
    const fa = rel.figures.find((f) => f.kind === a);
    if (!fg || !fa) continue;
    const start = unit === "USD" ? fg.value : fg.current;
    const end = unit === "USD" ? fa.value : fa.current;
    let steps: BridgeStep[] = rel.adjustments
      .filter((x) => re.test(x.applies_to) && x.current !== null)
      .map((x) => ({ label: x.label, value: (x.current as number) * (unit === "USD" ? (SCALE[x.scale] ?? 1) : 1), quote: x.quote }));
    const sum = steps.reduce((s, x) => s + x.value, 0);
    const tol = Math.max(Math.abs(end) * 0.005, unit === "USD" ? 1e6 : 0.005);
    if (Math.abs(start + sum - end) > tol && Math.abs(start - sum - end) <= tol) steps = steps.map((x) => ({ ...x, value: -x.value }));
    const residual = end - (start + steps.reduce((s, x) => s + x.value, 0));
    if (Math.abs(residual) > tol) steps.push({ label: steps.length ? "Other items & rounding" : "Total adjustments", value: residual, computed: true });
    if (!steps.length) continue;
    return { basis, unit, start, startLabel: `GAAP ${basis.toLowerCase()}`, steps, end, endLabel: fa.label };
  }
  return null;
}

export function buildExtras(opts: {
  brief: Brief;
  events: EarningsEvent[];
  comparison: CallComparison | null;
  la: string;
  lb: string;
  revenue: { a?: number; b?: number };
  margin: { a?: number; b?: number };
}): BriefExtras {
  const { brief, events, comparison, la, lb, revenue, margin } = opts;
  const verdict: VerdictChip[] = [];
  const tiles: Tile[] = [];
  const evB = events.find((e) => evLabel(e) === lb);

  if (evB?.eps_reported != null && evB.eps_estimated != null && evB.eps_estimated !== 0) {
    const s = (evB.eps_reported / evB.eps_estimated - 1) * 100;
    const beat = evB.eps_reported >= evB.eps_estimated;
    verdict.push({ label: `EPS ${beat ? "beat" : "miss"} ${pct(s)}`, tone: beat ? "up" : "down", target: "street" });
    tiles.push({ label: "Street EPS", value: `$${evB.eps_reported.toFixed(2)}`, sub: `vs $${evB.eps_estimated.toFixed(2)} consensus · ${pct(s)}`, tone: beat ? "up" : "down" });
  }
  const relB = brief.inputs.results[lb]?.release;
  const adj = relB?.figures.find((f) => f.kind === "eps_adjusted");
  if (adj) {
    const prior = brief.inputs.results[la]?.release?.figures.find((f) => f.kind === "eps_adjusted")?.current ?? adj.prior;
    tiles.push({
      label: "Company adjusted EPS",
      value: `$${adj.current.toFixed(2)}`,
      sub: prior ? `${pct((adj.current / prior - 1) * 100)} vs year ago ($${prior.toFixed(2)})` : adj.label,
      tone: prior ? (adj.current >= prior ? "up" : "down") : "neutral",
    });
  }
  if (revenue.a && revenue.b) {
    const g = (revenue.b / revenue.a - 1) * 100;
    verdict.push({ label: `Revenue ${pct(g)}`, tone: g >= 0 ? "up" : "down", target: "results" });
    tiles.push({ label: "Revenue", value: money(revenue.b), sub: `${pct(g)} vs ${money(revenue.a)}`, tone: g >= 0 ? "up" : "down" });
  }
  if (margin.a != null && margin.b != null) {
    const d = (margin.b - margin.a) * 100;
    tiles.push({ label: "Operating margin", value: `${(margin.b * 100).toFixed(1)}%`, sub: `${d >= 0 ? "+" : ""}${d.toFixed(1)} pp vs ${(margin.a * 100).toFixed(1)}%`, tone: d >= 0 ? "up" : "down" });
  }

  const g = comparison?.guidance ?? [];
  const counts = {
    raised: g.filter((x) => x.change === "raised").length,
    lowered: g.filter((x) => x.change === "lowered").length,
    dropped: g.filter((x) => x.change === "not repeated" || x.change === "withdrawn").length,
    added: g.filter((x) => x.change === "new").length,
    escalated: brief.inputs.risk?.summary.escalated ?? 0,
    riskAdded: brief.inputs.risk?.summary.counts.added ?? 0,
    riskRemoved: brief.inputs.risk?.summary.counts.removed ?? 0,
  };
  if (g.length) {
    const tone: Tone = counts.lowered > counts.raised ? "down" : counts.raised > counts.lowered ? "up" : "neutral";
    const parts = [counts.raised && `${counts.raised} raised`, counts.lowered && `${counts.lowered} cut`, counts.dropped && `${counts.dropped} dropped`].filter(Boolean);
    verdict.push({ label: `Guidance: ${parts.join(", ") || "steady"}`, tone, target: "guidance" });
  }
  if (counts.escalated || counts.riskAdded) {
    verdict.push({ label: `Risk language: ${[counts.riskAdded && `${counts.riskAdded} new`, counts.escalated && `${counts.escalated} escalated`].filter(Boolean).join(", ")}`, tone: "warn", target: "risks" });
  }
  const tensions = brief.claims.filter((c) => c.section === "tensions").length;
  if (tensions) verdict.push({ label: `${tensions} call-vs-filing flag${tensions > 1 ? "s" : ""}`, tone: "warn", target: "tensions" });

  const streak = [...events]
    .filter((e) => e.eps_reported != null && e.eps_estimated != null && e.eps_estimated !== 0 && evLabel(e) <= lb)
    .sort((x, y) => evLabel(y).localeCompare(evLabel(x)))
    .slice(0, 8)
    .reverse()
    .map((e) => ({
      label: evLabel(e),
      reported: e.eps_reported as number,
      estimated: e.eps_estimated as number,
      surprisePct: ((e.eps_reported as number) / (e.eps_estimated as number) - 1) * 100,
    }));

  return { verdict, tiles, streak, bridge: buildBridge(relB), guidance: g, counts };
}
