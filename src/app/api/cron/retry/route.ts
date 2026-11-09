import type { NextRequest } from "next/server";
import { dispatchPipeline } from "@/lib/github";

/**
 * Backup trigger for the price catch-up / paused-load retry. GitHub's scheduler sometimes stops firing,
 * so Vercel's cron calls this a couple of hours after the daily run (the free price source allows 50
 * requests an hour, so the morning run can leave some stocks behind).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const ok = secret ? req.headers.get("authorization") === `Bearer ${secret}` : (req.headers.get("user-agent") ?? "").includes("vercel-cron");
  if (!ok) return new Response("Forbidden", { status: 403 });
  await dispatchPipeline({ command: "retry-deferred" });
  return Response.json({ started: true });
}
