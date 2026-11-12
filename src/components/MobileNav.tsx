"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const I = {
  earnings: "M4 5h16v15H4zM4 9h16M9 3v4M15 3v4",
  screener: "M4 6h16M7 12h10M10 18h4",
  compare: "M8 4v16M16 4v16M4 8l4-4 4 4M12 16l4 4 4-4",
  portfolio: "M4 8h16v11H4zM9 8V5h6v3",
  economy: "M4 19h16M6 16l4-5 3 3 5-7",
} as const;

const ITEMS: { href: string; label: string; icon: keyof typeof I }[] = [
  { href: "/earnings", label: "Earnings", icon: "earnings" },
  { href: "/screener", label: "Screener", icon: "screener" },
  { href: "/compare", label: "Compare", icon: "compare" },
  { href: "/portfolio", label: "Portfolio", icon: "portfolio" },
  { href: "/macro", label: "Economy", icon: "economy" },
];

/** Phones: the main sections as a tab bar at the bottom of the screen, where thumbs reach. */
export default function MobileNav() {
  const path = usePathname();
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
    >
      <ul className="grid grid-cols-5">
        {ITEMS.map((it) => {
          const on = path.startsWith(it.href);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={on ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2 text-xs font-medium ${on ? "text-foreground" : "text-muted"}`}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={I[it.icon]} />
                </svg>
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
