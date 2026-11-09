"use client";

import { useEffect, useId, useRef, useState } from "react";
import { GLOSSARY, type GlossaryEntry } from "@/lib/glossary";

/**
 * ⓘ icon with a plain-English explanation: what it is, how it's calculated, why it matters and what
 * to look for. Opens on hover (desktop) or tap (phones), and stays inside the screen.
 * Pass a glossary key (`k`) or a one-off entry.
 */
export default function Info({ k, entry, className = "" }: { k?: string; entry?: GlossaryEntry; className?: string }) {
  const e = entry ?? (k ? GLOSSARY[k] : undefined);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (ev: Event) => {
      if (ev.type === "keydown" && (ev as KeyboardEvent).key !== "Escape") return;
      if (ev.type === "mousedown" && btn.current?.parentElement?.contains(ev.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  if (!e) return null;

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    const r = btn.current?.getBoundingClientRect();
    if (r) {
      const w = Math.min(320, window.innerWidth - 24);
      const left = Math.max(12, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 12));
      const below = r.top < 260;
      setPos({ left, top: below ? r.bottom + 8 : r.top - 8, below });
    }
    setOpen(true);
  };
  const hide = () => {
    timer.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <span className={`relative inline-flex align-middle ${className}`} onMouseEnter={show} onMouseLeave={hide}>
      <button
        ref={btn}
        type="button"
        aria-label={`What is ${e.term}?`}
        aria-describedby={open ? id : undefined}
        onClick={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (open) setOpen(false);
          else show();
        }}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[9px] font-semibold leading-none text-muted opacity-70 transition hover:opacity-100 focus:opacity-100 focus:outline-none"
      >
        i
      </button>
      {open && pos && (
        <span
          id={id}
          role="tooltip"
          onMouseEnter={show}
          onMouseLeave={hide}
          style={{ left: pos.left, top: pos.top, width: Math.min(320, typeof window === "undefined" ? 320 : window.innerWidth - 24), transform: pos.below ? undefined : "translateY(-100%)" }}
          className="fixed z-[60] block rounded-2xl border border-border bg-background p-3.5 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-foreground shadow-xl"
        >
          <span className="block text-sm font-semibold">{e.term}</span>
          <span className="mt-1 block">{e.what}</span>
          {e.how && (
            <span className="mt-2 block">
              <span className="font-semibold">How it&apos;s calculated: </span>
              <span className="text-muted">{e.how}</span>
            </span>
          )}
          {e.why && (
            <span className="mt-2 block">
              <span className="font-semibold">Why it matters: </span>
              <span className="text-muted">{e.why}</span>
            </span>
          )}
          {e.read && (
            <span className="mt-2 block">
              <span className="font-semibold">How to read it: </span>
              <span className="text-muted">{e.read}</span>
            </span>
          )}
        </span>
      )}
    </span>
  );
}
