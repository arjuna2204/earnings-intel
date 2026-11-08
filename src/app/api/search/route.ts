import type { NextRequest } from "next/server";
import { rpc } from "@/lib/db";
import type { TickerHit } from "@/lib/types";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 40);
  if (!q) return Response.json({ results: [] });
  try {
    const results = await rpc<TickerHit[]>("search_tickers", { q, max_results: 8 });
    return Response.json({ results });
  } catch (e) {
    return Response.json({ results: [], error: (e as Error).message }, { status: 500 });
  }
}
