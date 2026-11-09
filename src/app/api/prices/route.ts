import type { NextRequest } from "next/server";
import { selectAll } from "@/lib/db";

const T = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/** Adjusted daily closes for one ticker already in the database (loaded stocks and comparison ETFs). */
export async function GET(req: NextRequest) {
  const t = (req.nextUrl.searchParams.get("t") ?? "").toUpperCase();
  if (!T.test(t)) return Response.json({ error: "bad ticker" }, { status: 400 });
  const rows = await selectAll<{ date: string; close: number; adj_close: number }>("prices", { ticker: `eq.${t}`, select: "date,close,adj_close", order: "date" });
  return Response.json({ ticker: t, prices: rows }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
