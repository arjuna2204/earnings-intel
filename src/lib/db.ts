import "server-only";

/**
 * Minimal Supabase (PostgREST) client for server code only. Uses the secret key from
 * Vercel env vars; the browser never sees it. Every table has RLS on with no public policies.
 */

import { prettyName } from "@/lib/names";

// Tables whose `name` column is an SEC registrant name: shown as people write it.
const NAME_TABLES = new Set(["companies", "lite_companies", "tickers", "universe", "earnings_recaps"]);
function tidy<T>(table: string, rows: T[]): T[] {
  if (!NAME_TABLES.has(table)) return rows;
  for (const r of rows as Record<string, unknown>[]) if (r && typeof r.name === "string") r.name = prettyName(r.name);
  return rows;
}

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY are not set");
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`; // legacy service_role JWT
  return { base: `${url.replace(/\/$/, "")}/rest/v1`, headers };
}

export function dbConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

async function check(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res;
}

/** GET rows. `params` are PostgREST query params, e.g. { cik: "eq.320193", select: "*" }. */
export async function select<T>(table: string, params: Record<string, string>): Promise<T[]> {
  const { base, headers } = config();
  const res = await fetch(`${base}/${table}?${new URLSearchParams(params)}`, { headers, cache: "no-store" });
  return tidy(table, (await (await check(res, `select ${table}`)).json()) as T[]);
}

/** GET all rows, paging past PostgREST's 1,000-row response limit. */
export async function selectAll<T>(table: string, params: Record<string, string>, pageSize = 1000): Promise<T[]> {
  const { base, headers } = config();
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const res = await fetch(`${base}/${table}?${new URLSearchParams(params)}`, {
      headers: { ...headers, Range: `${from}-${from + pageSize - 1}`, "Range-Unit": "items" },
      cache: "no-store",
    });
    const rows = (await (await check(res, `select ${table}`)).json()) as T[];
    out.push(...tidy(table, rows));
    if (rows.length < pageSize) return out;
  }
}

export async function insert<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const { base, headers } = config();
  const res = await fetch(`${base}/${table}`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(row),
    cache: "no-store",
  });
  const rows = (await (await check(res, `insert ${table}`)).json()) as T[];
  return rows[0];
}

export async function upsert<T>(table: string, row: Record<string, unknown>, onConflict: string): Promise<T> {
  const { base, headers } = config();
  const res = await fetch(`${base}/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify(row),
    cache: "no-store",
  });
  const rows = (await (await check(res, `upsert ${table}`)).json()) as T[];
  return rows[0];
}

export async function update(table: string, match: Record<string, string | number>, values: Record<string, unknown>) {
  const { base, headers } = config();
  const params = new URLSearchParams(Object.entries(match).map(([k, v]) => [k, `eq.${v}`]));
  await check(
    await fetch(`${base}/${table}?${params}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(values),
      cache: "no-store",
    }),
    `update ${table}`,
  );
}

export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { base, headers } = config();
  const res = await fetch(`${base}/rpc/${fn}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
    cache: "no-store",
  });
  return (await check(res, `rpc ${fn}`)).json() as Promise<T>;
}
