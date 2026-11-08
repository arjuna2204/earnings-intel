import type { NextRequest } from "next/server";
import { select } from "@/lib/db";

/** Transcript turns by index, for showing a quote in context or a full Q&A exchange. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const [cik, fy, fq] = ["cik", "fy", "fq"].map((k) => Number(sp.get(k)));
  const ids = (sp.get("turns") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 0).slice(0, 40);
  if (!cik || !fy || !fq || !ids.length) return Response.json({ error: "bad request" }, { status: 400 });
  const rows = await select<{ turns: { speaker: string; title: string; content: string }[] }>("transcripts", {
    cik: `eq.${cik}`,
    fiscal_year: `eq.${fy}`,
    fiscal_quarter: `eq.${fq}`,
    select: "turns",
  });
  if (!rows.length) return Response.json({ error: "not found" }, { status: 404 });
  const all = rows[0].turns;
  return Response.json({ turns: ids.filter((i) => i < all.length).map((i) => ({ i, ...all[i] })) });
}
