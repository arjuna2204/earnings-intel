"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TickerHit } from "@/lib/types";

// Recent searches, newest first, remembered in this browser only.
const RECENT_KEY = "ei.recentSearches";
const RECENT_MAX = 8;
type Recent = { ticker: string; name: string };

function readRecent(): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? (v as Recent[]).filter((r) => r && typeof r.ticker === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function writeRecent(list: Recent[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    /* storage blocked: nothing to remember */
  }
}

export default function SearchBox({
  autoFocus = false,
  large = false,
  placeholder = "Search a ticker or company",
  onPick,
  onEscape,
}: {
  autoFocus?: boolean;
  large?: boolean;
  placeholder?: string;
  /** Called with the chosen ticker instead of opening its page. */
  onPick?: (ticker: string) => void;
  onEscape?: () => void;
}) {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<TickerHit[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]); // read on focus, so the first render matches the server
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        const data = (await res.json()) as { results: TickerHit[]; error?: string };
        if (mine !== seq.current) return;
        setHits(data.results ?? []);
        setError(data.error ? "Search isn't available yet — the company list may still be loading." : null);
        setActive(0);
        setOpen(true);
      } catch {
        if (mine === seq.current) setError("Search failed. Check your connection.");
      }
    }, 120);
    return () => clearTimeout(t);
  }, [q]);

  const showRecent = !q.trim() && recent.length > 0;
  const visible: TickerHit[] = q.trim() ? hits : showRecent ? recent.map((r) => ({ ticker: r.ticker, name: r.name, exchange: "" }) as TickerHit) : [];

  const go = (hit?: TickerHit) => {
    const ticker = hit?.ticker ?? q.trim().toUpperCase();
    if (!ticker) return;
    setOpen(false);
    setQ("");
    const next = [{ ticker, name: hit?.name ?? ticker }, ...readRecent().filter((r) => r.ticker !== ticker)];
    writeRecent(next);
    setRecent(next.slice(0, RECENT_MAX));
    if (onPick) onPick(ticker);
    else router.push(`/c/${encodeURIComponent(ticker)}`);
  };

  return (
    <div className="relative w-full">
      <input
        type="search"
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => {
          setRecent(readRecent());
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, visible.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            go(visible[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
            onEscape?.();
          }
        }}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className={`w-full rounded-full border border-border bg-card px-5 outline-none transition focus:border-accent ${
          large ? "py-4 text-lg" : "py-2.5 text-sm"
        }`}
      />
      {error && <p className="mt-2 px-5 text-sm text-muted">{error}</p>}
      {open && visible.length > 0 && (
        <ul id={listId} role="listbox" className="pop-in absolute z-40 mt-2 w-full overflow-hidden rounded-2xl border border-border bg-background shadow-xl">
          {showRecent && (
            <li role="presentation" className="flex items-center justify-between px-5 pb-1 pt-3 text-xs text-muted">
              <span>Recent searches</span>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  writeRecent([]);
                  setRecent([]);
                }}
                className="hover:text-foreground"
              >
                Clear
              </button>
            </li>
          )}
          {visible.map((h, i) => (
            <li
              key={h.ticker}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                go(h);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-baseline gap-3 px-5 py-3 ${i === active ? "bg-card" : ""}`}
            >
              <span className="w-16 shrink-0 font-semibold">{h.ticker}</span>
              <span className="truncate text-muted">{h.name}</span>
              {showRecent ? (
                <button
                  type="button"
                  aria-label={`Remove ${h.ticker} from recent searches`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const next = readRecent().filter((r) => r.ticker !== h.ticker);
                    writeRecent(next);
                    setRecent(next);
                  }}
                  className="ml-auto shrink-0 text-xs text-muted hover:text-foreground"
                >
                  ✕
                </button>
              ) : (
                <span className="ml-auto shrink-0 text-xs text-muted">{h.exchange}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
