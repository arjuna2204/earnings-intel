import { connection } from "next/server";
import { Suspense } from "react";
import { select } from "@/lib/db";
import type { Job } from "@/lib/types";
import { getAllFlags } from "@/lib/quality";

export default function StatusPage() {
  return (
    <main className="page-wrap flex-1 pb-16 pt-8 *:max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-tight">Status</h1>
      <Suspense fallback={<div className="skeleton mt-8 h-96" />}>
        <StatusContent />
      </Suspense>
    </main>
  );
}

const LIMITS_FALLBACK = { alpha_vantage: 25, tiingo: 1000 };
const PROVIDER_LABEL: Record<string, string> = { alpha_vantage: "Alpha Vantage (transcripts)", tiingo: "Tiingo (prices)" };

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

async function StatusContent() {
  await connection(); // always live data
  const [spend, settings, usage, jobs] = await Promise.all([
    select<{ spent_usd: string }>("ai_spend_mtd", { select: "spent_usd" }),
    select<{ key: string; value: Record<string, number> }>("app_settings", { select: "key,value" }),
    select<{ provider: string; requests: number }>("api_usage", { day: `eq.${todayEt()}`, select: "provider,requests" }),
    select<Job>("jobs", { select: "*", order: "created_at.desc", limit: "15" }),
  ]);
  const [flags, names] = await Promise.all([
    getAllFlags(),
    select<{ cik: number; ticker: string }>("companies", { select: "cik,ticker" }),
  ]);
  const tickerOf = new Map(names.map((n) => [n.cik, n.ticker]));
  const budget = settings.find((s) => s.key === "ai_budget")?.value ?? { monthly_cap_usd: 10, warn_at_usd: 8 };
  const limits = settings.find((s) => s.key === "free_tier_limits")?.value ?? LIMITS_FALLBACK;
  const spent = Number(spend[0]?.spent_usd ?? 0);
  const cap = budget.monthly_cap_usd;
  const pct = Math.min(spent / cap, 1);
  const state = spent >= cap ? "reached" : spent >= budget.warn_at_usd ? "warn" : "ok";

  return (
    <div className="mt-8 space-y-10">
      <section aria-labelledby="ai-budget">
        <h2 id="ai-budget" className="text-sm font-semibold text-muted">
          AI budget · this month
        </h2>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-4xl font-semibold">${spent.toFixed(2)}</span>
          <span className="text-muted">of ${cap.toFixed(2)}</span>
          <span className="ml-auto text-sm text-muted">${Math.max(cap - spent, 0).toFixed(2)} left</span>
        </div>
        <div
          className="mt-3 h-2.5 overflow-hidden rounded-full bg-card"
          role="progressbar"
          aria-valuenow={Math.round(pct * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="AI budget used"
        >
          <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: state === "ok" ? "var(--up)" : "var(--down)" }} />
        </div>
        {state === "warn" && <p className="mt-2 text-sm text-down">⚠ Over ${budget.warn_at_usd} — nearing the monthly cap.</p>}
        {state === "reached" && (
          <p className="mt-2 text-sm text-down">■ Monthly AI budget reached — cached results still available. Resets on the 1st.</p>
        )}
        <p className="mt-2 text-xs text-muted">Every Claude call is estimated before it runs and refused if it would cross the cap.</p>
      </section>

      <section aria-labelledby="quality">
        <h2 id="quality" className="text-sm font-semibold text-muted">
          Data-quality checks · today
        </h2>
        <p className="mt-1 text-xs text-muted">
          Every morning each company&apos;s numbers are cross-checked (market value two ways, P/E vs price ÷ EPS, dividends vs cash
          paid, segments vs revenue, DCF vs price, stale prices). &quot;Hidden&quot; numbers are held back on the site until they pass.
        </p>
        {flags.length === 0 ? (
          <p className="mt-3 text-sm">✓ All companies passed.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border text-sm">
            {[...flags]
              .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "hide" ? -1 : 1))
              .map((f) => {
                const t = tickerOf.get(f.cik) ?? String(f.cik);
                return (
                  <li key={`${f.cik}-${f.check}`} className="flex gap-3 py-2">
                    <a href={`/c/${t}`} className="w-14 shrink-0 font-semibold hover:underline">
                      {t}
                    </a>
                    <span className={`w-16 shrink-0 text-xs font-medium ${f.severity === "hide" ? "text-down" : "text-muted"}`}>
                      {f.severity === "hide" ? "■ Hidden" : "⚠︎ Flag"}
                    </span>
                    <span className="text-muted">{f.message}</span>
                  </li>
                );
              })}
          </ul>
        )}
      </section>

      <section aria-labelledby="free-tiers">
        <h2 id="free-tiers" className="text-sm font-semibold text-muted">
          Free-tier usage today (ET)
        </h2>
        <ul className="mt-3 space-y-3">
          {Object.entries(limits).map(([provider, limit]) => {
            const used = usage.find((u) => u.provider === provider)?.requests ?? 0;
            return (
              <li key={provider}>
                <div className="flex justify-between text-sm">
                  <span>{PROVIDER_LABEL[provider] ?? provider}</span>
                  <span className="text-muted">
                    {used} / {limit}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-card">
                  <div className="h-full bg-accent" style={{ width: `${Math.min(used / limit, 1) * 100}%` }} />
                </div>
              </li>
            );
          })}
          <li className="text-sm text-muted">SEC EDGAR: no daily cap (kept under 10 requests/second)</li>
        </ul>
      </section>

      <section aria-labelledby="jobs">
        <h2 id="jobs" className="text-sm font-semibold text-muted">
          Background jobs
        </h2>
        {jobs.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No jobs yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-2xl border border-border">
            {jobs.map((j) => (
              <li key={j.id} className="px-4 py-3 text-sm">
                <div className="flex items-center gap-3">
                  <span className="font-semibold">{j.kind === "analyze" ? j.ticker : j.kind}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      j.status === "done" ? "bg-card text-up" : j.status === "failed" ? "bg-card text-down" : "bg-card text-muted"
                    }`}
                  >
                    {j.status}
                  </span>
                  <span className="ml-auto text-xs text-muted">
                    {new Date(j.created_at).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </div>
                {j.message && <p className="mt-1 text-xs text-muted">{j.message}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
