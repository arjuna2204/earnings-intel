"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { resolveTab, TABS, VIEWS, viewHref } from "@/lib/tabs";

/** Five tabs in one sticky bar, with the current tab's views as pills underneath. */
export default function CompanyTabs() {
  const path = usePathname();
  const params = useSearchParams();
  const { tab, view } = resolveTab(params.get("tab"), params.get("view"));
  const active = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [tab]);
  const views = VIEWS[tab];
  return (
    <nav className="sticky top-14 z-20 -mx-4 border-b border-border bg-background/90 px-4 backdrop-blur" aria-label="Company sections">
      <ul className="-mb-px flex gap-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => (
          <li key={t.key} className="shrink-0">
            <Link
              ref={tab === t.key ? active : undefined}
              href={`${path}?tab=${t.key}`}
              scroll={false}
              aria-current={tab === t.key ? "page" : undefined}
              className={`inline-block border-b-2 py-3 text-[15px] font-semibold transition ${
                tab === t.key ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
      {views.length > 1 && (
        <ul className="flex gap-1 overflow-x-auto pb-2 pt-1 [scrollbar-width:none]" aria-label="Views">
          {views.map((v) => (
            <li key={v.key} className={`shrink-0 ${v.pro ? "pro-only" : ""}`}>
              <Link
                href={viewHref(path, v.key)}
                scroll={false}
                aria-current={view === v.key ? "page" : undefined}
                className={`inline-block rounded-full px-3 py-1 text-sm font-medium transition ${
                  view === v.key ? "bg-card text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {v.label}
                {v.pro && <span className="ml-1 text-[10px] uppercase text-muted">Pro</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
