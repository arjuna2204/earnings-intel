"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

const LINKS = [
  { href: "/screener", label: "Screener", sub: "Filter stocks by growth, value and quality" },
  { href: "/compare", label: "Compare", sub: "Two to five stocks side by side" },
  { href: "/macro", label: "Economy", sub: "Rates, inflation and jobs" },
  { href: "/about", label: "About", sub: "How Earnings Intel works" },
];

/** "More" in the top bar: the less-used pages and the light/dark switch. On phones it also carries the main links. */
export default function MoreMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const dark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );

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

  const toggleTheme = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex items-center gap-1 rounded-full px-3 py-2 text-[15px] font-medium transition hover:bg-card ${open ? "bg-card" : ""}`}
      >
        More
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden className={open ? "rotate-180" : ""}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div role="menu" onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)} className="pop-in absolute right-0 top-12 z-50 w-72 rounded-2xl bg-background p-2 shadow-float">
          <div className="sm:hidden">
            <MenuLink href="/earnings" label="This week" sub="Who reports and who just did" />
            <MenuLink href="/my-stocks" label="My stocks" sub="Your watchlist and portfolio" />
            <div className="mx-3 my-1 h-px bg-border" />
          </div>
          {LINKS.map((l) => (
            <MenuLink key={l.href} {...l} />
          ))}
          <div className="mx-3 my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={dark}
            onClick={toggleTheme}
            className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[15px] font-medium hover:bg-card"
          >
            Dark mode
            <span aria-hidden className={`relative h-6 w-10 rounded-full transition-colors ${dark ? "bg-up" : "bg-card-strong"}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${dark ? "translate-x-[18px]" : "translate-x-0.5"}`} />
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLink({ href, label, sub }: { href: string; label: string; sub: string }) {
  return (
    <Link role="menuitem" href={href} className="block rounded-xl px-3 py-2.5 hover:bg-card">
      <span className="block text-[15px] font-medium">{label}</span>
      <span className="block text-[13px] text-muted">{sub}</span>
    </Link>
  );
}
