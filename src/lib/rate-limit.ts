// Simple per-IP limiter for login attempts: 5 failures per 15 minutes.
// Phase 0 note: this lives in server memory, so it resets when Vercel starts a fresh
// server instance. In Phase 1 it moves to a Supabase table so it holds across instances.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

const failures = new Map<string, number[]>();

function recent(ip: string, now: number): number[] {
  const list = (failures.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  failures.set(ip, list);
  return list;
}

export function isBlocked(ip: string, now: number = Date.now()): boolean {
  return recent(ip, now).length >= MAX_FAILURES;
}

export function recordFailure(ip: string, now: number = Date.now()): void {
  recent(ip, now).push(now);
}

export function clearFailures(ip: string): void {
  failures.delete(ip);
}
