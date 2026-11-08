import type { NextRequest } from "next/server";
import { insert, select, update } from "@/lib/db";
import { dispatchPipeline } from "@/lib/github";
import type { Job } from "@/lib/types";

/** Start a peer comparison. Body: {ticker, peers?: string[]} or {ticker, auto?: number (3–7)}. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { ticker?: string; peers?: string[]; auto?: number };
  const ticker = (body.ticker ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,10}$/.test(ticker)) return Response.json({ error: "Bad ticker" }, { status: 400 });
  let peerSet: string | undefined;
  if (Array.isArray(body.peers)) {
    const list = [...new Set(body.peers.map((t) => String(t).trim().toUpperCase()))].filter((t) => /^[A-Z0-9.\-]{1,10}$/.test(t) && t !== ticker);
    if (list.length < 3 || list.length > 7) return Response.json({ error: "Pick between 3 and 7 peers" }, { status: 400 });
    peerSet = list.join(",");
  } else if (body.auto !== undefined) {
    const n = Math.round(Number(body.auto));
    if (!(n >= 3 && n <= 7)) return Response.json({ error: "Pick between 3 and 7 peers" }, { status: 400 });
    peerSet = `auto:${n}`;
  }

  const since = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  const active = await select<Job>("jobs", { ticker: `eq.${ticker}`, kind: "eq.peers", status: "in.(queued,running)", created_at: `gte.${since}`, limit: "1" });
  if (active.length) return Response.json({ job: active[0] });

  const job = await insert<Job>("jobs", { kind: "peers", ticker, status: "queued", params: peerSet ? { peer_set: peerSet } : {} });
  try {
    await dispatchPipeline({ command: "peers", ticker, job_id: job.id, peer_set: peerSet });
  } catch (e) {
    await update("jobs", { id: job.id }, { status: "failed", message: (e as Error).message });
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
  return Response.json({ job });
}
