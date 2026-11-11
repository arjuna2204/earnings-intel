import type { NextRequest } from "next/server";
import { holdings } from "@/lib/portfolio";

/** Data for the tickers in a browser-stored portfolio. Only tickers are sent, never share counts. */
export async function GET(req: NextRequest) {
  const t = (req.nextUrl.searchParams.get("t") ?? "").split(",").filter(Boolean);
  try {
    return Response.json({ holdings: await holdings(t) }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch {
    return Response.json({ error: "failed" }, { status: 502 });
  }
}
