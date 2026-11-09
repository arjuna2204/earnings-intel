import Link from "next/link";
import type { Signal } from "@/lib/quicktake";

/** One-glance summary at the top of a company page. Each card links to the tab with the evidence. */
export default function QuickTake({ signals }: { signals: Signal[] }) {
  if (!signals.length) return null;
  const up = signals.filter((s) => s.tone === "up").length;
  const down = signals.filter((s) => s.tone === "down").length;
  return (
    <section aria-label="Quick take" className="mt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Quick take</h2>
        <p className="text-xs text-muted">
          <span className="text-up">▲ {up} positive</span> · <span className="text-down">▼ {down} negative</span> · {signals.length - up - down} neutral ·
          computed from the data in the tabs below, no AI
        </p>
      </div>
      <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {signals.map((s) => (
          <li key={s.key}>
            <Link href={s.href} className="block h-full rounded-xl border border-border px-3.5 py-3 transition hover:bg-card">
              <span className="text-xs text-muted">{s.title}</span>
              <span className="mt-0.5 flex items-baseline gap-1.5 text-sm font-semibold leading-snug">
                {s.tone === "up" ? (
                  <span className="text-up" aria-label="positive">
                    ▲
                  </span>
                ) : s.tone === "down" ? (
                  <span className="text-down" aria-label="negative">
                    ▼
                  </span>
                ) : (
                  <span className="text-muted" aria-label="neutral">
                    ●
                  </span>
                )}
                {s.text}
              </span>
              <span className="mt-1 block text-xs leading-snug text-muted">{s.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
