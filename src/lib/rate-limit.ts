import "server-only";
import { dbConfigured, insert, select } from "@/lib/db";

// Login attempts: at most 5 failures per IP per 15 minutes. Stored in Supabase so the limit
// holds across Vercel server instances; falls back to memory if the database isn't configured.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const memory = new Map<string, number[]>();

export async function isBlocked(ip: string): Promise<boolean> {
  const since = Date.now() - WINDOW_MS;
  if (!dbConfigured()) return (memory.get(ip) ?? []).filter((t) => t > since).length >= MAX_FAILURES;
  try {
    const rows = await select<{ id: number }>("login_attempts", {
      ip: `eq.${ip}`,
      attempted_at: `gte.${new Date(since).toISOString()}`,
      select: "id",
      limit: String(MAX_FAILURES),
    });
    return rows.length >= MAX_FAILURES;
  } catch {
    return false; // never lock the owner out because the database hiccuped
  }
}

export async function recordFailure(ip: string): Promise<void> {
  if (!dbConfigured()) {
    memory.set(ip, [...(memory.get(ip) ?? []), Date.now()]);
    return;
  }
  try {
    await insert("login_attempts", { ip });
  } catch {
    memory.set(ip, [...(memory.get(ip) ?? []), Date.now()]);
  }
}
