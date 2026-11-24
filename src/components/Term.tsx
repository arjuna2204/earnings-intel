"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GLOSSARY, isJargon, type GlossaryEntry } from "@/lib/glossary";

/**
 * A label you can tap for a plain-English explanation — no icons.
 * Jargon gets a faint dotted underline; everyday words and headings stay plain until hovered.
 * Phones: a bottom sheet. Desktop: a small popover next to the word.
 */
export default function Term({
  k,
  value,
  quiet = false,
  children,
}: {
  k?: string;
  /** this stock's figure, shown at the top of the explanation */
  value?: string | null;
  /** headings: no underline until hovered */
  quiet?: boolean;
  children: React.ReactNode;
}) {
  const e = k ? GLOSSARY[k] : undefined;
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!e) return <>{children}</>;

  const underline = !quiet && isJargon(k!);
  const openNow = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setAnchor(ref.current?.getBoundingClientRect() ?? null);
    setOpen(true);
  };
  const desktopHover = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (min-width: 640px)").matches;

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (open) setOpen(false);
          else openNow();
        }}
        onMouseEnter={() => {
          if (!desktopHover()) return;
          hoverTimer.current = setTimeout(openNow, 350);
        }}
        onMouseLeave={() => {
          if (hoverTimer.current) clearTimeout(hoverTimer.current);
          if (desktopHover()) hoverTimer.current = setTimeout(() => setOpen(false), 200);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`cursor-help text-left [font:inherit] [color:inherit] decoration-1 underline-offset-[3px] ${
          underline ? "underline decoration-dotted decoration-current/40 hover:decoration-current" : "no-underline hover:underline hover:decoration-dotted hover:decoration-current/40"
        }`}
      >
        {children}
      </button>
      {open && (
        <Explainer
          entry={e}
          value={value}
          anchor={anchor}
          onClose={() => setOpen(false)}
          onHover={(inside) => {
            if (hoverTimer.current) clearTimeout(hoverTimer.current);
            if (!inside && desktopHover()) hoverTimer.current = setTimeout(() => setOpen(false), 200);
          }}
        />
      )}
    </>
  );
}

/** Quiet "About these numbers" link that opens every explanation for a section in one sheet. */
export function AboutNumbers({ keys, title, values = {} }: { keys: string[]; title: string; values?: Record<string, string | null | undefined> }) {
  const [open, setOpen] = useState(false);
  const entries = keys.map((k) => [k, GLOSSARY[k]] as const).filter((x): x is readonly [string, GlossaryEntry] => Boolean(x[1]));
  if (!entries.length) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-muted hover:text-foreground">
        About these numbers
      </button>
      {open && (
        <Sheet title={title} onClose={() => setOpen(false)} wide>
          <div className="divide-y divide-border">
            {entries.map(([k, e]) => (
              <div key={k} className="py-4 first:pt-0">
                <Body entry={e} value={values[k]} />
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}

function Explainer({
  entry,
  value,
  anchor,
  onClose,
  onHover,
}: {
  entry: GlossaryEntry;
  value?: string | null;
  anchor: DOMRect | null;
  onClose: () => void;
  onHover: (inside: boolean) => void;
}) {
  const small = typeof window !== "undefined" && window.innerWidth < 640;
  if (small || !anchor) {
    return (
      <Sheet onClose={onClose}>
        <Body entry={entry} value={value} big />
      </Sheet>
    );
  }
  return <Popover entry={entry} value={value} anchor={anchor} onClose={onClose} onHover={onHover} />;
}

function Popover({
  entry,
  value,
  anchor,
  onClose,
  onHover,
}: {
  entry: GlossaryEntry;
  value?: string | null;
  anchor: DOMRect;
  onClose: () => void;
  onHover: (inside: boolean) => void;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const w = 340;
  const left = Math.max(12, Math.min(anchor.left, window.innerWidth - w - 12));
  const below = anchor.bottom + 300 < window.innerHeight || anchor.top < 300;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && onClose();
    const onScroll = () => onClose();
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll);
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={box}
      id={id}
      role="dialog"
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{ left, width: w, top: below ? anchor.bottom + 8 : anchor.top - 8, transform: below ? undefined : "translateY(-100%)" }}
      className="fixed z-[70] rounded-2xl bg-background p-4 text-left shadow-float"
    >
      <Body entry={entry} value={value} />
    </div>,
    document.body,
  );
}

function Sheet({ title, onClose, wide = false, children }: { title?: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
      <div
        className={`relative max-h-[82vh] w-full overflow-y-auto rounded-t-3xl bg-background px-5 pb-8 pt-3 shadow-2xl sm:rounded-3xl sm:pt-5 ${wide ? "sm:max-w-xl" : "sm:max-w-md"}`}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border sm:hidden" aria-hidden />
        <div className="mb-3 flex items-center justify-between gap-4">
          {title ? <h2 className="text-lg font-semibold">{title}</h2> : <span />}
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full bg-card px-2.5 py-1 text-sm text-muted hover:text-foreground">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function Body({ entry, value, big = false }: { entry: GlossaryEntry; value?: string | null; big?: boolean }) {
  return (
    <div className="text-sm leading-relaxed">
      <div className={`${big ? "text-xl" : "text-base"} font-semibold tracking-tight`}>{entry.term}</div>
      {value && (
        <div className="mt-1 text-sm">
          <span className="text-muted">Here: </span>
          <span className="font-semibold tabular-nums">{value}</span>
        </div>
      )}
      <p className="mt-2">{entry.what}</p>
      {(
        [
          ["How it's calculated", entry.how],
          ["Why it matters", entry.why],
          ["How to read it", entry.read],
        ] as const
      )
        .filter(([, t]) => t)
        .map(([h, t]) => (
          <div key={h} className="mt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">{h}</div>
            <p className="mt-0.5">{t}</p>
          </div>
        ))}
    </div>
  );
}
