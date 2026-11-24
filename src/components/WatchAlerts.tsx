"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { markSeen, useWatchlist } from "@/components/watchlist-store";
import { fmtDay, useWatchData } from "@/components/useWatchData";

/** Bell in the top bar: earnings alerts for the visitor's watchlist. */
export default function WatchAlerts() {
  const list = useWatchlist();
  const { alerts } = useWatchData(list);
  const [open, setOpen] = useState(false);
  const [cleared, setCleared] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // desktop notification for new reports, if the visitor turned them on
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const fresh = alerts.filter((a) => a.kind === "reported" && a.isNew);
      const notified = JSON.parse(sessionStorage.getItem("ei.notified") ?? "[]") as string[];
      for (const a of fresh) {
        const id = `${a.ticker}:${a.date}`;
        if (notified.includes(id)) continue;
        new Notification(`${a.ticker} reported earnings`, { body: `See what changed in ${a.name}'s results.`, tag: id });
        notified.push(id);
      }
      sessionStorage.setItem("ei.notified", JSON.stringify(notified));
    }
  }, [alerts]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!list.length) return null;
  const sig = alerts.map((a) => `${a.ticker}:${a.date}`).join(",");
  const unseen = cleared === sig ? [] : alerts.filter((a) => a.isNew);
  const canNotify = typeof Notification !== "undefined" && Notification.permission === "default";

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open && alerts.length) {
            const reported = alerts.filter((a) => a.kind === "reported").map((a) => ({ ticker: a.ticker, date: a.date }));
            markSeen(reported);
            setCleared(sig);
          }
        }}
        aria-label={`Earnings alerts${unseen.length ? ` (${unseen.length} new)` : ""}`}
        aria-expanded={open}
        className="relative rounded-full p-2 text-muted transition hover:bg-card hover:text-foreground"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unseen.length > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-semibold text-background">
            {unseen.length}
          </span>
        )}
      </button>
      {open && (
        <div className="pop-in fixed inset-x-3 top-16 z-50 rounded-2xl border border-border bg-background p-2 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-80">
          <p className="px-3 pb-1 pt-2 text-xs text-muted">Earnings alerts for your watchlist</p>
          {alerts.length ? (
            <ul>
              {alerts.map((a) => (
                <li key={a.ticker}>
                  <Link
                    href={a.kind === "reported" ? `/c/${a.ticker}?tab=brief` : `/c/${a.ticker}?tab=street`}
                    onClick={() => setOpen(false)}
                    className="block rounded-xl px-3 py-2.5 hover:bg-card"
                  >
                    <span className="font-semibold">{a.ticker}</span>{" "}
                    {a.kind === "reported" ? (
                      <>
                        reported {fmtDay(a.date)}
                        {a.item.surprise != null && (
                          <span className={a.item.surprise >= 0 ? "text-up" : "text-down"}>
                            {" "}
                            {a.item.surprise >= 0 ? "▲ beat" : "▼ missed"} {Math.abs(a.item.surprise * 100).toFixed(1)}%
                          </span>
                        )}
                        <span className="block text-xs text-muted">See what changed →</span>
                      </>
                    ) : (
                      <>
                        reports {a.kind === "today" ? "today" : fmtDay(a.date)}
                        <span className="block text-xs text-muted">See what the Street expects →</span>
                      </>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-3 text-sm text-muted">Nothing new. You&apos;ll see an alert here the week a watched stock reports.</p>
          )}
          {canNotify && (
            <button
              type="button"
              onClick={() => void Notification.requestPermission()}
              className="mt-1 w-full rounded-xl px-3 py-2 text-left text-xs text-muted hover:bg-card hover:text-foreground"
            >
              Also notify me on this computer when the site is open
            </button>
          )}
          <Link href="/#watchlist" onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2 text-xs text-muted hover:bg-card hover:text-foreground">
            Manage watchlist ({list.length})
          </Link>
        </div>
      )}
    </div>
  );
}
