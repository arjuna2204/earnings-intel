import "server-only";
import { select } from "@/lib/db";

/** 8-K Items in plain English, with how much they usually matter. */
export const ITEMS: Record<string, { label: string; weight: "high" | "medium" | "routine" }> = {
  "1.01": { label: "Signed a major agreement", weight: "medium" },
  "1.02": { label: "Ended a major agreement", weight: "medium" },
  "1.03": { label: "Bankruptcy or receivership", weight: "high" },
  "1.05": { label: "Cybersecurity incident", weight: "high" },
  "2.01": { label: "Completed an acquisition or sale", weight: "medium" },
  "2.02": { label: "Earnings results", weight: "routine" },
  "2.03": { label: "Took on new debt", weight: "medium" },
  "2.04": { label: "Debt repayment triggered early", weight: "high" },
  "2.05": { label: "Restructuring or layoffs", weight: "high" },
  "2.06": { label: "Wrote down assets (impairment)", weight: "high" },
  "3.01": { label: "Delisting or listing-rule notice", weight: "high" },
  "3.02": { label: "Sold shares privately", weight: "medium" },
  "3.03": { label: "Changed shareholder rights", weight: "medium" },
  "4.01": { label: "Changed auditor", weight: "high" },
  "4.02": { label: "Past financials can't be relied on (restatement)", weight: "high" },
  "5.01": { label: "Change in control", weight: "high" },
  "5.02": { label: "Executive or board change", weight: "medium" },
  "5.03": { label: "Changed bylaws or charter", weight: "routine" },
  "5.05": { label: "Changed code of ethics", weight: "routine" },
  "5.07": { label: "Shareholder vote results", weight: "routine" },
  "7.01": { label: "Investor presentation or announcement", weight: "routine" },
  "8.01": { label: "Other announcement", weight: "routine" },
};

export type CompanyEvent = { accession: string; date: string; url: string; items: string[]; summary: string | null; weight: "high" | "medium" | "routine" };

const RANK = { high: 0, medium: 1, routine: 2 } as const;

export async function getEvents8k(cik: number, since: string): Promise<CompanyEvent[]> {
  const rows = await select<{ accession: string; filed_date: string; url: string; items: string | null; summary: string | null }>("filings", {
    cik: `eq.${cik}`,
    form: "eq.8-K",
    filed_date: `gte.${since}`,
    select: "accession,filed_date,url,items,summary",
    order: "filed_date.desc",
    limit: "200",
  }).catch(() => []);
  return rows.map((r) => {
    const items = (r.items ?? "").split(",").map((i) => i.trim()).filter((i) => i && i !== "9.01");
    const weight = items.map((i) => ITEMS[i]?.weight ?? "routine").sort((a, b) => RANK[a] - RANK[b])[0] ?? "routine";
    return { accession: r.accession, date: r.filed_date, url: r.url, items, summary: r.summary || null, weight };
  });
}
