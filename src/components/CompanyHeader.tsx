"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import WatchButton from "@/components/WatchButton";
import { usePriceView, type PriceView } from "@/components/price-store";
import { resolveTab, TABS } from "@/lib/tabs";

export type DayQuote = { price: number; change: number; pct: number; date: string } | null;

/**
 * The company's header: name, ticker, a huge price and its move. The price follows the chart while the visitor
 * scrubs it (Overview) and shows the day's move elsewhere. Once the header scrolls away it condenses into a
 * sticky bar with the price, the tabs (wide screens) and Watch, Compare and Download.
 */
export default function CompanyHeader({
  ticker,
  name,
  meta,
  day,
  downloadHref,
  actions,
  children,
}: {
  ticker: string;
  name: string;
  meta: string;
  day: DayQuote;
  /** the Excel DCF model, when there is one */
  downloadHref: string | null;
  /** extra controls next to Watch/Compare (e.g. an update in progress) */
  actions?: ReactNode;
  /** rendered under the header, inside the accent scope (tabs and tab content) */
  children: ReactNode;
}) {
  const chart = usePriceView(ticker);
  const v: PriceView | null = chart ?? (day ? { price: day.price, change: day.change, pct: day.pct, label: "Today", scrubbing: false, periodUp: day.change >= 0 } : null);
  const up = (v?.change ?? 0) >= 0; // this value's own move (text color)
  const trendUp = v?.periodUp ?? true; // the period's direction (accent)
  const hero = useRef<HTMLDivElement>(null);
  const [condensed, setCondensed] = useState(false);

  // condense once the big price has scrolled under the site header
  useEffect(() => {
    const el = hero.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setCondensed(!e.isIntersecting && e.boundingClientRect.top < 64), { rootMargin: "-64px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div data-trend={trendUp ? "up" : "down"}>
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
        <div ref={hero} className="min-w-0">
          <p className="text-[15px] font-medium text-muted">{meta}</p>
          <h1 className="mt-1 text-[28px] leading-tight tracking-[-0.03em] sm:text-[32px]">{name}</h1>
          {v ? (
            <>
              <CountUpPrice value={v.price} className="price-hero mt-3 block text-[44px] sm:text-[56px]" />
              <p className="mt-2 text-[15px] font-semibold tabular-nums" aria-live={v.scrubbing ? "off" : "polite"}>
                <span className={up ? "text-up-ink" : "text-down-ink"}>
                  {up ? "+" : "−"}${Math.abs(v.change).toFixed(2)} ({up ? "+" : "−"}
                  {Math.abs(v.pct * 100).toFixed(2)}%)
                </span>{" "}
                <span className="font-medium text-muted">{v.label}</span>
              </p>
            </>
          ) : (
            <p className="mt-3 text-[15px] text-muted">No price yet</p>
          )}
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <WatchButton ticker={ticker} />
            <Link href={`/compare?a=${encodeURIComponent(ticker)}`} className="rounded-full bg-card px-4 py-2 text-sm font-semibold hover:bg-card-strong">
              Compare
            </Link>
            {downloadHref && <DownloadLink href={downloadHref} />}
            {actions}
          </div>
          <FilingSearch ticker={ticker} />
        </div>
      </header>

      <StickyBar ticker={ticker} v={v} up={up} show={condensed} downloadHref={downloadHref} />
      {children}
    </div>
  );
}

function DownloadLink({ href, compact = false }: { href: string; compact?: boolean }) {
  return (
    <a
      href={href}
      download
      title="Download the DCF model as an Excel file with live formulas"
      className={`inline-flex items-center gap-1.5 rounded-full bg-card font-semibold hover:bg-card-strong ${compact ? "px-3 py-1.5 text-[13px]" : "px-4 py-2 text-sm"}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />
      </svg>
      {compact ? "Excel" : "Download"}
    </a>
  );
}

/** "Search what AAPL has said": opens the filings & calls search with the words typed here. */
function FilingSearch({ ticker }: { ticker: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("view") === "search" ? (params.get("q") ?? "") : "");
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const t = q.trim();
        if (t.length < 2) return;
        router.push(`${path}?tab=overview&view=search&q=${encodeURIComponent(t)}`, { scroll: false });
      }}
      className="relative w-full sm:w-72"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${ticker}'s filings & calls`}
        aria-label={`Search ${ticker}'s filings and earnings calls`}
        className="w-full rounded-full bg-card py-2 pl-10 pr-4 text-sm outline-none transition-shadow placeholder:text-muted focus:bg-background focus:shadow-float [&::-webkit-search-cancel-button]:hidden"
      />
    </form>
  );
}

function StickyBar({ ticker, v, up, show, downloadHref }: { ticker: string; v: PriceView | null; up: boolean; show: boolean; downloadHref: string | null }) {
  const path = usePathname();
  const params = useSearchParams();
  const { tab } = resolveTab(params.get("tab"), params.get("view"));
  return (
    <div
      data-show={show}
      aria-hidden={!show}
      inert={!show}
      data-testid="sticky-bar"
      className="sticky-bar fixed inset-x-0 top-16 z-20 bg-background/95 shadow-[0_8px_24px_-18px_rgba(0,0,0,0.45)] backdrop-blur-md"
    >
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
        <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="flex min-w-0 items-baseline gap-2.5" title="Back to top">
          <span className="text-[17px] font-bold">{ticker}</span>
          {v && (
            <>
              <span className="text-[17px] font-semibold tabular-nums">${v.price.toFixed(2)}</span>
              <span className={`text-sm font-semibold tabular-nums ${up ? "text-up-ink" : "text-down-ink"}`}>
                {up ? "+" : "−"}
                {Math.abs(v.pct * 100).toFixed(2)}%
              </span>
            </>
          )}
        </button>
        <nav aria-label="Company sections (compact)" className="hidden flex-1 justify-center gap-5 lg:flex">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`${path}?tab=${t.key}`}
              scroll={false}
              onClick={() => window.scrollTo({ top: 0 })}
              className={`text-sm font-semibold ${tab === t.key ? "text-foreground" : "text-muted hover:text-foreground"}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <WatchButton ticker={ticker} compact />
          <Link href={`/compare?a=${encodeURIComponent(ticker)}`} className="hidden rounded-full bg-card px-3 py-1.5 text-[13px] font-semibold hover:bg-card-strong sm:inline-flex">
            Compare
          </Link>
          {downloadHref && <DownloadLink href={downloadHref} compact />}
        </div>
      </div>
    </div>
  );
}

/** The big price: counts up once on first load (skipped when motion is reduced), then follows the value exactly. */
function CountUpPrice({ value, className }: { value: number; className: string }) {
  const el = useRef<HTMLSpanElement>(null);
  const done = useRef(false);
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });
  const text = `$${value.toFixed(2)}`;
  useEffect(() => {
    const node = el.current;
    if (done.current || !node) return;
    done.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const from = value * 0.92;
    const start = performance.now();
    const dur = 700;
    let raf = 0;
    const tick = (now: number) => {
      if (latest.current !== value) return; // the visitor started scrubbing: React shows the live value
      const t = Math.min(1, (now - start) / dur);
      const e = t === 1 ? 1 : 1 - Math.pow(2, -10 * t); // ease-out-expo
      node.textContent = `$${(from + (value - from) * e).toFixed(2)}`;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // only the first value counts up; later values (scrubbing) render directly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // innerHTML (not a React text child) so the count-up can write the node without confusing React's updates
  return <span ref={el} className={className} data-testid="hero-price" dangerouslySetInnerHTML={{ __html: text }} />;
}
