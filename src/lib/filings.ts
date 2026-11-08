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
