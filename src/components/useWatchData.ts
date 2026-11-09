"use client";

import { useEffect, useState } from "react";
import type { WatchItem } from "@/app/api/watchlist/route";
import { getSeen } from "@/components/watchlist-store";

/** `isNew`: a report the visitor hasn't opened the alerts for yet, or a stock reporting today. */
export type Alert = { ticker: string; name: string; kind: "reported" | "today" | "soon"; date: string; item: WatchItem; isNew: boolean };

/** Fetches watchlist data and works out alerts (reported in the last 7 days, or reporting within 2 days). */
export function useWatchData(tickers: string[]) {
  const key = tickers.join(",");
  const [state, setState] = useState<{ key: string; items: WatchItem[]; alerts: Alert[]; loading: boolean }>({ key: "", items: [], alerts: [], loading: false });
  useEffect(() => {
    if (!key) return;
    let live = true;
    fetch(`/api/watchlist?t=${encodeURIComponent(key)}`)
      .then((r) => r.json() as Promise<{ items: WatchItem[] }>)
      .then(({ items }) => {
        if (!live) return;
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD, US Eastern
        const days = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5);
        const alerts: Alert[] = [];
        const seen = getSeen();
        for (const it of items ?? []) {
          if (it.lastReport && days(it.lastReport) >= -7 && days(it.lastReport) <= 0)
            alerts.push({ ticker: it.ticker, name: it.name, kind: "reported", date: it.lastReport, item: it, isNew: seen[it.ticker] !== it.lastReport });
          else if (it.nextReport && days(it.nextReport) === 0) alerts.push({ ticker: it.ticker, name: it.name, kind: "today", date: it.nextReport, item: it, isNew: true });
          else if (it.nextReport && days(it.nextReport) > 0 && days(it.nextReport) <= 2)
            alerts.push({ ticker: it.ticker, name: it.name, kind: "soon", date: it.nextReport, item: it, isNew: false });
        }
        setState({ key, items: items ?? [], alerts, loading: false });
      })
      .catch(() => live && setState({ key, items: [], alerts: [], loading: false }));
    return () => {
      live = false;
    };
  }, [key]);
  const fresh = state.key === key;
  return { items: fresh ? state.items : [], alerts: fresh ? state.alerts : [], loading: !!key && !fresh };
}

export function fmtDay(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
