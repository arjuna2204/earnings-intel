import "server-only";
import { select } from "@/lib/db";
import { prettyName } from "@/lib/names";
import type { Job } from "@/lib/types";

export const PEERS_VERSION = "peers-v1"; // must match VERSION in pipeline/ei/peers.py

export type Peer = { cik: number; ticker: string; name: string; source: string; reason: string; quote?: string };
export type PeerSet = { peers: Peer[]; candidates: Peer[] | null; edited: boolean; updated_at: string };
export type PeerColumn = { key: string; label: string; fmt: "money" | "x" | "pct" | "ratio"; group: string };
export type PeerRow = { cik: number; ticker: string; name: string; m: Record<string, number | string | null> };
export type PeerFact = { type: string; group: string; metric: string; text: string };
export type PeerComparison = {
  result: {
    columns: PeerColumn[];
    rows: PeerRow[];
    ranks: Record<string, Record<string, number>>;
    medians: Record<string, number | null>;
    facts: Record<string, PeerFact>;
  };
  claims: { section: string; text: string; refs: string[] }[] | null;
  dropped: unknown[] | null;
  created_at: string;
  version: string;
};

export async function getPeerSet(cik: number): Promise<PeerSet | null> {
  const rows = await select<PeerSet>("peer_sets", { cik: `eq.${cik}`, select: "peers,candidates,edited,updated_at" });
  const s = rows[0];
  if (!s) return null;
  const fix = (list: Peer[] | null) => list?.map((p) => ({ ...p, name: prettyName(p.name) })) ?? null;
  return { ...s, peers: fix(s.peers) ?? [], candidates: fix(s.candidates) };
}

export async function getPeerComparison(cik: number): Promise<PeerComparison | null> {
  const rows = await select<PeerComparison>("peer_comparisons", { cik: `eq.${cik}`, version: `eq.${PEERS_VERSION}`, select: "result,claims,dropped,created_at,version" });
  const c = rows[0];
  if (!c) return null;
  return { ...c, result: { ...c.result, rows: c.result.rows.map((r) => ({ ...r, name: prettyName(r.name) })) } };
}

export async function getLatestPeersJob(ticker: string): Promise<Job | null> {
  const rows = await select<Job>("jobs", { ticker: `eq.${ticker}`, kind: "eq.peers", order: "created_at.desc", limit: "1" });
  return rows[0] ?? null;
}
