import type { NextRequest } from "next/server";
import { upsert } from "@/lib/db";

const Q = /^FY\d{4}Q[1-4]$/;
const VERDICTS = new Set(["better", "same", "worse"]);

/** Save "your take" on a quarter: {cik, period_a, period_b, verdict, note?}. */
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as { cik?: number; period_a?: string; period_b?: string; verdict?: string; note?: string };
  const cik = Number(b.cik);
  if (!Number.isInteger(cik) || cik <= 0 || !Q.test(b.period_a ?? "") || !Q.test(b.period_b ?? "") || !VERDICTS.has(b.verdict ?? "")) {
    return Response.json({ error: "Invalid take" }, { status: 400 });
  }
  const note = (b.note ?? "").trim().slice(0, 600) || null;
  try {
    const take = await upsert("takes", { cik, period_a: b.period_a, period_b: b.period_b, verdict: b.verdict, note, created_at: new Date().toISOString() }, "cik,period_a,period_b");
    return Response.json({ take });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
