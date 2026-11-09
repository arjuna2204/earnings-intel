"use client";

import { useSyncExternalStore } from "react";

// The watchlist lives in this browser (no accounts). Changes broadcast to every component on the page.
const KEY = "ei.watchlist";
const SEEN = "ei.watchlist.seen";
const EVENT = "ei-watchlist";
const EMPTY: string[] = [];
let cache: { raw: string | null; list: string[] } = { raw: null, list: EMPTY };

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== cache.raw) cache = { raw, list: raw ? (JSON.parse(raw) as string[]).filter((t) => typeof t === "string") : EMPTY };
    return cache.list;
  } catch {
    return EMPTY;
  }
}

function subscribe(cb: () => void) {
  const on = (e: Event) => (e.type === "storage" ? (e as StorageEvent).key === KEY && cb() : cb());
  window.addEventListener(EVENT, on);
  window.addEventListener("storage", on);
  return () => {
    window.removeEventListener(EVENT, on);
    window.removeEventListener("storage", on);
  };
}

export function useWatchlist(): string[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function setWatched(ticker: string, on: boolean) {
  const cur = read();
  const next = on ? [ticker, ...cur.filter((t) => t !== ticker)].slice(0, 30) : cur.filter((t) => t !== ticker);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: nothing to do */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Report dates the visitor has already seen an alert for, keyed by ticker. */
export function getSeen(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SEEN) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function markSeen(items: { ticker: string; date: string }[]) {
  const s = getSeen();
  for (const i of items) s[i.ticker] = i.date;
  try {
    localStorage.setItem(SEEN, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
