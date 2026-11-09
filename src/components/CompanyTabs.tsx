"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

export const TABS = [
  { key: "brief", label: "Brief" },
  { key: "street", label: "StreetView" },
  { key: "historical", label: "Historical" },
  { key: "call", label: "Call" },
  { key: "filings", label: "Filings" },
  { key: "peers", label: "Peers" },
  { key: "sources", label: "Sources" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];
const ALIASES: Record<string, TabKey> = { financials: "historical", streetview: "street" };
export const normalizeTab = (t: string | null | undefined, fallback: TabKey): TabKey =>
  (t && (ALIASES[t] ?? (TABS.some((x) => x.key === t) ? (t as TabKey) : undefined))) || fallback;

/** One sticky tab bar at the top on every screen size; scrolls sideways on phones. */
export default function CompanyTabs({ defaultTab }: { defaultTab: TabKey }) {
  const path = usePathname();
  const params = useSearchParams();
  const current = normalizeTab(params.get("tab"), defaultTab);
  const active = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [current]);
  return (
    <nav className="sticky top-14 z-20 -mx-4 border-b border-border bg-background/90 px-4 backdrop-blur" aria-label="Company sections">
      <ul className="-mb-px flex gap-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => (
          <li key={t.key} className="shrink-0">
            <Link
              ref={current === t.key ? active : undefined}
              href={`${path}?tab=${t.key}`}
              scroll={false}
              aria-current={current === t.key ? "page" : undefined}
              className={`inline-block border-b-2 py-3 text-[15px] font-semibold transition ${
                current === t.key ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
