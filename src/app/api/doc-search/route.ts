import type { NextRequest } from "next/server";
import { rpc } from "@/lib/db";

export type DocHit = { kind: "filing" | "call"; ref: string; doc_date: string | null; section: string; speaker: string | null; passage: string; rank: number };

/** Word search across one company's stored filing sections and earnings-call transcripts. */
export async function GET(req: NextRequest) {
  const cik = Number(req.nextUrl.searchParams.get("cik"));
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 120);
  if (!Number.isInteger(cik) || cik <= 0 || q.length < 2) return Response.json({ error: "bad request" }, { status: 400 });
  try {
    const hits = await rpc<DocHit[]>("search_docs", { p_cik: cik, p_q: q, p_limit: 60 });
    return Response.json({ hits }, { headers: { "Cache-Control": "public, s-maxage=600" } });
  } catch {
    return Response.json({ error: "search failed" }, { status: 502 });
  }
}
