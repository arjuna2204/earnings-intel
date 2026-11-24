"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SearchBox from "@/components/SearchBox";

/**
 * The search in the top bar: a large pill in the middle of the bar on tablets and up; a magnifier that opens a
 * full-width field on phones. "/" anywhere outside a text field jumps to it.
 */
export default function HeaderSearch() {
  const [open, setOpen] = useState(false); // phone overlay
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        if (window.matchMedia("(min-width: 768px)").matches) input.current?.focus();
        else setOpen(true);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => panel.current && !panel.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const go = (t: string) => {
    setOpen(false);
    input.current?.blur();
    router.push(`/c/${encodeURIComponent(t)}`);
  };

  return (
    <>
      <div className="hidden w-full md:block">
        <SearchBox inputRef={input} placeholder="Search stocks" onPick={go} onEscape={() => input.current?.blur()} />
      </div>
      <div ref={panel} className="md:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Search stocks"
          aria-expanded={open}
          className={`flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-card ${open ? "bg-card" : ""}`}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </button>
        {open && (
          <div className="pop-in fixed inset-x-3 top-[4.5rem] z-50">
            <SearchBox autoFocus placeholder="Search a ticker or company" onEscape={() => setOpen(false)} onPick={go} />
          </div>
        )}
      </div>
    </>
  );
}
