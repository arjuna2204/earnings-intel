"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export const TABS = [
  { key: "brief", label: "Brief", icon: "◆" },
  { key: "call", label: "Call", icon: "☏" },
  { key: "filings", label: "Filings", icon: "▤" },
  { key: "financials", label: "Financials", icon: "▥" },
  { key: "peers", label: "Peers", icon: "⧉" },
  { key: "sources", label: "Sources", icon: "⛬" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

/** Top tabs on desktop, bottom tab bar on mobile. */
export default function CompanyTabs({ defaultTab }: { defaultTab: TabKey }) {
  const path = usePathname();
  const params = useSearchParams();
  const current = (params.get("tab") as TabKey) ?? defaultTab;
  const href = (k: TabKey) => `${path}?tab=${k}`;

  return (
    <>
      <nav className="sticky top-14 z-20 -mx-4 hidden border-b border-border bg-background/90 px-4 backdrop-blur sm:block" aria-label="Company sections">
        <ul className="flex gap-6">
          {TABS.map((t) => (
            <li key={t.key}>
              <Link
                href={href(t.key)}
                scroll={false}
                aria-current={current === t.key ? "page" : undefined}
                className={`inline-block border-b-2 py-3 text-sm font-semibold transition ${
                  current === t.key ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden" aria-label="Company sections">
        <ul className="grid grid-cols-6">
          {TABS.map((t) => (
            <li key={t.key}>
              <Link
                href={href(t.key)}
                scroll={false}
                aria-current={current === t.key ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${current === t.key ? "text-accent" : "text-muted"}`}
              >
                <span aria-hidden className="text-base">
                  {t.icon}
                </span>
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
