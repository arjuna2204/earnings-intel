import type { NextRequest } from "next/server";
import { select } from "@/lib/db";
import type { Job } from "@/lib/types";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "Bad id" }, { status: 400 });
  const rows = await select<Job>("jobs", { id: `eq.${id}`, select: "*" });
  if (!rows.length) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ job: rows[0] });
}
