"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TickerHit } from "@/lib/types";

export default function SearchBox({ autoFocus = false, large = false }: { autoFocus?: boolean; large?: boolean }) {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<TickerHit[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const visible = q.trim() ? hits : [];

  const go = (hit?: TickerHit) => {
    const ticker = hit?.ticker ?? q.trim().toUpperCase();
    if (!ticker) return;
    setOpen(false);
    router.push(`/c/${encodeURIComponent(ticker)}`);
  };

  return (
    <div className="relative w-full">
      <input
        type="search"
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => visible.length > 0 && setOpen(true)}
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
          } else if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search any US-listed ticker or company"
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
        <ul id={listId} role="listbox" className="absolute z-40 mt-2 w-full overflow-hidden rounded-2xl border border-border bg-background shadow-xl">
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
              <span className="ml-auto shrink-0 text-xs text-muted">{h.exchange}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
