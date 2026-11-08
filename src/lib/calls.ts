import "server-only";
import { select, selectAll } from "@/lib/db";
import type { CallAnalysis, CallComparison, EarningsEvent, Job } from "@/lib/types";

/** Must match ANALYSIS_VERSION in pipeline/ei/calls/extract.py */
export const CALLS_VERSION = "calls-v4";

export const qLabel = (fy: number, fq: number) => `FY${fy}Q${fq}`;

export function parseQ(p: string | undefined | null): [number, number] | null {
  const m = /^FY(\d{4})Q([1-4])$/.exec((p ?? "").toUpperCase());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export async function getEvents(cik: number): Promise<EarningsEvent[]> {
  return selectAll<EarningsEvent>("earnings_events", {
    cik: `eq.${cik}`,
    select: "fiscal_year,fiscal_quarter,period_end,report_date,report_time,eps_reported,eps_estimated",
    order: "report_date.desc",
  });
}

export async function getComparison(cik: number, a: string, b: string): Promise<CallComparison | null> {
  const rows = await select<{ result: CallComparison }>("call_comparisons", {
    cik: `eq.${cik}`,
    period_a: `eq.${a}`,
    period_b: `eq.${b}`,
    analysis_version: `eq.${CALLS_VERSION}`,
    select: "result",
  });
  return rows[0]?.result ?? null;
}

export async function getAnalysis(cik: number, fy: number, fq: number): Promise<CallAnalysis | null> {
  const rows = await select<CallAnalysis>("call_analysis", {
    cik: `eq.${cik}`,
    fiscal_year: `eq.${fy}`,
    fiscal_quarter: `eq.${fq}`,
    analysis_version: `eq.${CALLS_VERSION}`,
    select: "*",
  });
  return rows[0] ?? null;
}

export type TonePoint = {
  fiscal_year: number;
  fiscal_quarter: number;
  executives: CallAnalysis["tone"]["executives"];
  avg_evasiveness: number | null;
};

/** Tone across every analyzed quarter (for trend charts). */
export async function getToneTrend(cik: number): Promise<TonePoint[]> {
  const rows = await select<{ fiscal_year: number; fiscal_quarter: number; tone: CallAnalysis["tone"]; evasiveness: CallAnalysis["evasiveness"] }>(
    "call_analysis",
    {
      cik: `eq.${cik}`,
      analysis_version: `eq.${CALLS_VERSION}`,
      select: "fiscal_year,fiscal_quarter,tone,evasiveness",
      order: "fiscal_year.asc,fiscal_quarter.asc",
    },
  );
  return rows.map((r) => ({
    fiscal_year: r.fiscal_year,
    fiscal_quarter: r.fiscal_quarter,
    executives: r.tone.executives,
    avg_evasiveness: r.evasiveness?.length ? r.evasiveness.reduce((s, e) => s + e.evasiveness, 0) / r.evasiveness.length : null,
  }));
}

export async function getLatestCallsJob(ticker: string, a: string, b: string): Promise<Job | null> {
  const rows = await select<Job>("jobs", {
    ticker: `eq.${ticker}`,
    kind: "eq.calls",
    "params->>period_a": `eq.${a}`,
    "params->>period_b": `eq.${b}`,
    order: "created_at.desc",
    limit: "1",
  });
  return rows[0] ?? null;
}
