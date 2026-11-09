import "server-only";
import type { NextRequest } from "next/server";
import { dbConfigured, insert, select } from "@/lib/db";

// The site is public, so anything that starts background work (and spends AI budget or free data
// allowances) is limited per visitor. Counts are kept in Supabase so they hold across server instances.

const WINDOW_MS = 60 * 60 * 1000;
const LIMITS: Record<string, number> = { job: 8, take: 30 };
const memory = new Map<string, number[]>();

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Records the attempt and returns false if this visitor has hit the hourly limit for `kind`. */
export async function allow(req: NextRequest, kind: keyof typeof LIMITS): Promise<boolean> {
  const key = `${kind}:${clientIp(req)}`;
  const since = Date.now() - WINDOW_MS;
  const max = LIMITS[kind];
  if (dbConfigured()) {
    try {
      const rows = await select<{ id: number }>("login_attempts", { ip: `eq.${key}`, attempted_at: `gte.${new Date(since).toISOString()}`, select: "id", limit: String(max) });
      if (rows.length >= max) return false;
      await insert("login_attempts", { ip: key });
      return true;
    } catch {
      /* fall through to memory */
    }
  }
  const hits = (memory.get(key) ?? []).filter((t) => t > since);
  if (hits.length >= max) return false;
  memory.set(key, [...hits, Date.now()]);
  return true;
}

export const tooMany = () => Response.json({ error: "Too many requests from this connection — try again in an hour." }, { status: 429 });
