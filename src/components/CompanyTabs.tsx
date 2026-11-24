"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";

import { resolveTab, TABS, VIEWS, viewHref } from "@/lib/tabs";

/** Six tabs with one underline that slides between them; the current tab's views as pills underneath. */
export default function CompanyTabs({ hide = [] }: { hide?: string[] }) {
  const path = usePathname();
  const params = useSearchParams();
  const { tab, view } = resolveTab(params.get("tab"), params.get("view"));
  const list = useRef<HTMLUListElement>(null);
  const links = useRef<Map<string, HTMLAnchorElement>>(new Map());
  const [ink, setInk] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const el = links.current.get(tab);
    const ul = list.current;
    if (!el || !ul) return;
    const place = () => setInk({ x: el.offsetLeft, w: el.offsetWidth });
    place();
    // bring the active tab into view sideways only (scrollIntoView would also scroll the page)
    if (ul.scrollWidth > ul.clientWidth) ul.scrollLeft = el.offsetLeft - (ul.clientWidth - el.offsetWidth) / 2;
    const ro = new ResizeObserver(place);
    ro.observe(ul);
    return () => ro.disconnect();
  }, [tab]);

  const views = VIEWS[tab].filter((v) => !hide.includes(v.key));
  return (
    <nav className="bg-background" aria-label="Company sections">
      <div className="relative border-b border-border">
        <ul ref={list} className="scroll-fade relative flex gap-7 overflow-x-auto pr-8 [scrollbar-width:none] sm:pr-0 [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => {
            const on = tab === t.key;
            return (
              <li key={t.key} className="shrink-0">
                <Link
                  ref={(a) => {
                    if (a) links.current.set(t.key, a);
                    else links.current.delete(t.key);
                  }}
                  href={`${path}?tab=${t.key}`}
                  scroll={false}
                  aria-current={on ? "page" : undefined}
                  className={`relative inline-block py-3.5 text-[15px] font-semibold transition-colors ${on ? "text-foreground" : "text-muted hover:text-foreground"}`}
                >
                  {t.label}
                  {/* static underline until the sliding one is measured (first paint, no JS) */}
                  {on && !ink && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent" />}
                </Link>
              </li>
            );
          })}
          {ink && (
            <span
              aria-hidden
              className="tab-ink pointer-events-none absolute bottom-0 left-0 h-0.5 w-px origin-left rounded-full bg-accent"
              style={{ transform: `translateX(${ink.x}px) scaleX(${ink.w})` }}
            />
          )}
        </ul>
      </div>
      {views.length > 1 && (
        <ul className="scroll-fade flex gap-2 overflow-x-auto pb-1 pr-8 pt-4 [scrollbar-width:none] sm:pr-0" aria-label="Views">
          {views.map((v) => {
            const on = view === v.key;
            return (
              <li key={v.key} className="shrink-0">
                <Link
                  href={viewHref(path, v.key)}
                  scroll={false}
                  aria-current={on ? "page" : undefined}
                  className={`inline-block rounded-full px-4 py-2 text-sm font-semibold ${on ? "bg-foreground text-background" : "bg-card text-foreground hover:bg-card-strong"}`}
                >
                  {v.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
