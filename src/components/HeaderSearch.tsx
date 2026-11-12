"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SearchBox from "@/components/SearchBox";

/** Magnifier button in the top bar: opens a search panel. Shortcut: "/" anywhere outside a text field. */
export default function HeaderSearch() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    if (open) document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div ref={panel} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Search stocks"
        aria-expanded={open}
        title="Search stocks ( / )"
        className={`flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-muted transition hover:text-foreground ${open ? "bg-card text-foreground" : ""}`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border border-border px-1.5 text-xs leading-4 sm:inline">/</kbd>
      </button>
      {open && (
        <div className="fixed inset-x-3 top-16 z-50 sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[26rem]">
          <SearchBox
            autoFocus
            placeholder="Search a ticker or company"
            onEscape={() => setOpen(false)}
            onPick={(t) => {
              setOpen(false);
              router.push(`/c/${encodeURIComponent(t)}`);
            }}
          />
        </div>
      )}
    </div>
  );
}
