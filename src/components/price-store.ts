"use client";

import { useSyncExternalStore } from "react";

/**
 * What the company header's big price shows. The price chart publishes here as the visitor scrubs, so the
 * headline price, change and date update live; when nothing is published (other tabs), the header shows the day.
 */
export type PriceView = {
  price: number;
  change: number; // absolute, in currency
  pct: number; // fraction
  /** what the change covers: "Today", "Past year", or the scrubbed date */
  label: string;
  scrubbing: boolean;
  /** the period's direction: drives the page accent, which shouldn't flicker while scrubbing */
  periodUp: boolean;
};

const views = new Map<string, PriceView>();
const listeners = new Set<() => void>();

export function publishPrice(ticker: string, v: PriceView | null) {
  const cur = views.get(ticker);
  if (v === null) {
    if (!cur) return;
    views.delete(ticker);
  } else {
    if (cur && cur.price === v.price && cur.change === v.change && cur.label === v.label && cur.scrubbing === v.scrubbing && cur.periodUp === v.periodUp) return;
    views.set(ticker, v);
  }
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The chart's current view for this ticker, or null when no chart is showing. */
export function usePriceView(ticker: string): PriceView | null {
  return useSyncExternalStore(
    subscribe,
    () => views.get(ticker) ?? null,
    () => null,
  );
}
