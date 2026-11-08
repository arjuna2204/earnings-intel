import type { NextRequest } from "next/server";
import { insert, select, update } from "@/lib/db";
import { dispatchPipeline } from "@/lib/github";
import type { Job } from "@/lib/types";

const Q = /^FY\d{4}Q[1-4]$/;

/** Start a two-quarter brief (filings + call + Street figures) (reuses an in-flight job for the same request). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { ticker?: string; period_a?: string; period_b?: string };
  const ticker = (body.ticker ?? "").trim().toUpperCase();
  let [a, b] = [(body.period_a ?? "").toUpperCase(), (body.period_b ?? "").toUpperCase()];
  if (!/^[A-Z0-9.\-]{1,10}$/.test(ticker) || !Q.test(a) || !Q.test(b) || a === b) {
    return Response.json({ error: "Pick a ticker and two different quarters" }, { status: 400 });
  }
  if (a > b) [a, b] = [b, a]; // earlier first

  const since = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  const active = await select<Job>("jobs", {
    ticker: `eq.${ticker}`,
    kind: "eq.brief",
    status: "in.(queued,running)",
    "params->>period_a": `eq.${a}`,
    "params->>period_b": `eq.${b}`,
    created_at: `gte.${since}`,
    limit: "1",
  });
  if (active.length) return Response.json({ job: active[0] });

  const job = await insert<Job>("jobs", { kind: "brief", ticker, status: "queued", params: { period_a: a, period_b: b } });
  try {
    await dispatchPipeline({ command: "brief", ticker, job_id: job.id, period_a: a, period_b: b });
  } catch (e) {
    await update("jobs", { id: job.id }, { status: "failed", message: (e as Error).message });
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
  return Response.json({ job });
}
