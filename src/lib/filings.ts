import "server-only";
import { select } from "@/lib/db";
import type { Job } from "@/lib/types";

/** Must match VERSION in pipeline/ei/filings/brief.py and risk.py */
export const BRIEF_VERSION = "brief-v1";

export type Fact = {
  type: string;
  text: string;
  quote?: string | null;
  link?: string | null;
  link_label?: string;
  period?: string;
  metric?: string;
};
export type Claim = { section: string; text: string; refs: string[] };

export type ReleaseFigure = {
  kind: string;
  label: string;
  current: number;
  prior: number | null;
  value: number;
  prior_value: number | null;
  unit: "USD" | "USD per share" | "percent";
  scale: string;
  basis: string;
  quote: string;
  para: number;
};
export type Release = {
  reports_non_gaap: boolean;
  non_gaap_definition: string | null;
  figures: ReleaseFigure[];
  adjustments: { label: string; current: number | null; applies_to: string; scale: string; quote: string; para: number }[];
};
export type Driver = { metric: string; direction: string; change_text: string | null; driver: string; offset: boolean; quote: string; para: number };
export type Mdna = {
  drivers: Driver[];
  capital: { label: string; summary: string; quote: string; para: number }[];
  competitors: { name: string; quote: string; para: number }[];
  outlook: { metric: string; statement: string; quote: string; para: number }[];
};
export type FilingRef = { accession: string; form: string; filed_date: string; report_date: string | null; url: string } | null;
export type BriefInputs = {
  facts: Record<string, Fact>;
  notes: string[];
  filings: Record<string, { end: string; periodic: FilingRef; risk: FilingRef; release: FilingRef }>;
  results: Record<string, { release?: Release | null; mdna?: Mdna | null }>;
  risk: {
    summary: { counts: Record<string, number>; escalated: number; factors_new: number; factors_old: number; words_new: number; words_old: number; report_new: string; report_old: string };
    accession_new: string;
    accession_old: string;
  } | null;
};
export type Brief = { inputs: BriefInputs; claims: Claim[]; dropped: (Claim & { reason: string })[] | null; cost_usd: number; created_at: string };

export type RiskChange = {
  status: "added" | "removed" | "modified" | "unchanged";
  similarity: number;
  headline: string;
  old_headline: string | null;
  category: string;
  words_added: number;
  words_removed: number;
  escalations: string[];
  redline: [string, string][];
};

export async function getBrief(cik: number, a: string, b: string): Promise<Brief | null> {
  const rows = await select<Brief>("briefs", {
    cik: `eq.${cik}`,
    period_a: `eq.${a}`,
    period_b: `eq.${b}`,
    version: `eq.${BRIEF_VERSION}`,
    select: "inputs,claims,dropped,cost_usd,created_at",
  });
  return rows[0] ?? null;
}

export async function getRiskChanges(cik: number, accNew: string, accOld: string): Promise<RiskChange[]> {
  const rows = await select<{ changes: RiskChange[] }>("risk_comparisons", {
    cik: `eq.${cik}`,
    accession_new: `eq.${accNew}`,
    accession_old: `eq.${accOld}`,
    select: "changes",
    order: "created_at.desc",
    limit: "1",
  });
  return rows[0]?.changes ?? [];
}

export async function getLatestBriefJob(ticker: string, a: string, b: string): Promise<Job | null> {
  const rows = await select<Job>("jobs", {
    ticker: `eq.${ticker}`,
    kind: "eq.brief",
    "params->>period_a": `eq.${a}`,
    "params->>period_b": `eq.${b}`,
    order: "created_at.desc",
    limit: "1",
  });
  return rows[0] ?? null;
}

export type Take = { period_a: string; period_b: string; verdict: "better" | "same" | "worse"; note: string | null; created_at: string };

/** The take for this comparison, and the most recent earlier take (shown as "last time you said"). */
export async function getTakes(cik: number, a: string, b: string): Promise<{ current: Take | null; previous: Take | null }> {
  const rows = await select<Take>("takes", { cik: `eq.${cik}`, select: "period_a,period_b,verdict,note,created_at", order: "period_b.desc", limit: "20" });
  return {
    current: rows.find((t) => t.period_a === a && t.period_b === b) ?? null,
    previous: rows.find((t) => t.period_b < b) ?? null,
  };
}

export type Dodge = { analyst: string; score: number; reason: string; question: string; answer: string; answerer: string };

/** Q&A exchanges the call analysis scored as least direct (score ≥ 0.5), with the actual words. */
export async function getDodges(cik: number, fy: number, fq: number, version: string): Promise<Dodge[]> {
  const [an, tr] = await Promise.all([
    select<{ evasiveness: { analyst: string; question_turns: number[]; answer_turns: number[]; evasiveness: number; reason: string }[] | null }>("call_analysis", {
      cik: `eq.${cik}`,
      fiscal_year: `eq.${fy}`,
      fiscal_quarter: `eq.${fq}`,
      analysis_version: `eq.${version}`,
      select: "evasiveness",
    }),
    select<{ turns: { speaker: string; title?: string | null; content: string }[] }>("transcripts", {
      cik: `eq.${cik}`,
      fiscal_year: `eq.${fy}`,
      fiscal_quarter: `eq.${fq}`,
      select: "turns",
    }),
  ]);
  const ev = an[0]?.evasiveness ?? [];
  const turns = tr[0]?.turns ?? [];
  if (!turns.length) return [];
  const text = (ids: number[]) => ids.map((i) => turns[i]?.content ?? "").join(" ").trim();
  return ev
    .filter((e) => e.evasiveness >= 0.5)
    .sort((x, y) => y.evasiveness - x.evasiveness)
    .slice(0, 3)
    .map((e) => ({
      analyst: e.analyst,
      score: e.evasiveness,
      reason: e.reason,
      question: text(e.question_turns),
      answer: text(e.answer_turns),
      answerer: [...new Set(e.answer_turns.map((i) => turns[i]?.speaker).filter(Boolean))].join(", "),
    }));
}

export type Scenario = { eps: number; pe: number; value: number; vs_price: number } | null;
export type StockCases = {
  numbers: {
    price: number;
    price_date: string | null;
    eps: { eps_low: number | null; eps_avg: number | null; eps_high: number | null };
    eps_method: string;
    analysts: number;
    pe?: { p20: number; p50: number; p80: number };
    pe_samples: number;
    pe_series?: [string, number][];
    scenarios: { bear: Scenario; base: Scenario; bull: Scenario } | null;
  };
  facts: Record<string, Fact>;
  claims: Claim[];
  created_at: string;
};

export async function getCases(cik: number): Promise<StockCases | null> {
  const rows = await select<StockCases>("stock_cases", { cik: `eq.${cik}`, select: "numbers,facts,claims,created_at" });
  return rows[0] ?? null;
}
