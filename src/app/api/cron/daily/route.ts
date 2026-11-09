import type { NextRequest } from "next/server";
import { insert, select } from "@/lib/db";
import { dispatchPipeline } from "@/lib/github";

/**
 * Backup trigger for the daily data refresh. GitHub's own scheduler sometimes drops the 6:17am run,
 * so Vercel's cron calls this every morning; it starts the daily job unless one already ran today.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const ok = secret ? req.headers.get("authorization") === `Bearer ${secret}` : (req.headers.get("user-agent") ?? "").includes("vercel-cron");
  if (!ok) return new Response("Forbidden", { status: 403 });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const ran = await select<{ id: number }>("jobs", { kind: "eq.daily", created_at: `gte.${today}T00:00:00-05:00`, select: "id", limit: "1" });
  if (ran.length) return Response.json({ started: false, reason: "daily job already ran today" });
  const job = await insert<{ id: number }>("jobs", { kind: "daily", status: "queued" });
  await dispatchPipeline({ command: "daily", job_id: job.id });
  return Response.json({ started: true, job: job.id });
}
