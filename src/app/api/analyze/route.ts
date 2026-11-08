import type { NextRequest } from "next/server";
import { insert, select, update } from "@/lib/db";
import { dispatchPipeline } from "@/lib/github";
import type { Job } from "@/lib/types";

/** Start loading a company's data. Reuses a job that's already queued/running for the same ticker. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { ticker?: string };
  const ticker = (body.ticker ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,10}$/.test(ticker)) return Response.json({ error: "Invalid ticker" }, { status: 400 });

  const known = await select<{ ticker: string }>("tickers", { ticker: `eq.${ticker}`, select: "ticker" });
  if (!known.length) return Response.json({ error: `${ticker} isn't in the US-listed company list` }, { status: 404 });

  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const active = await select<Job>("jobs", {
    ticker: `eq.${ticker}`,
    kind: "eq.analyze",
    status: "in.(queued,running)",
    created_at: `gte.${since}`,
    order: "created_at.desc",
    limit: "1",
  });
  if (active.length) return Response.json({ job: active[0] });

  const job = await insert<Job>("jobs", { kind: "analyze", ticker, status: "queued" });
  try {
    await dispatchPipeline({ command: "analyze", ticker, job_id: job.id });
  } catch (e) {
    await update("jobs", { id: job.id }, { status: "failed", message: (e as Error).message });
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
  return Response.json({ job });
}
