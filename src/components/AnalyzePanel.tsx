"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Job } from "@/lib/types";

const STEP_LABELS: Record<string, string> = {
  resolve: "Find company on SEC",
  filings: "List 15 years of filings",
  financials: "Read & normalize financials",
  prices: "Download price history",
  insiders: "Read insider trades (Form 4)",
};

/** Starts (or follows) a background job that loads a company, and refreshes the page when done. */
export default function AnalyzePanel({
  ticker,
  initialJob,
  mode,
}: {
  ticker: string;
  initialJob: Job | null;
  mode: "load" | "refresh";
}) {
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(initialJob);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const active = job && (job.status === "queued" || job.status === "running");

  useEffect(() => {
    if (!job || !active) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/jobs/${job.id}`);
      if (!res.ok) return;
      const { job: next } = (await res.json()) as { job: Job };
      setJob(next);
      if (next.status === "done" || next.status === "deferred") router.refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [job, active, router]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      const data = (await res.json()) as { job?: Job; error?: string };
      if (!res.ok || !data.job) throw new Error(data.error ?? "Couldn't start");
      setJob(data.job);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  if (active || (job && job.status === "failed")) {
    return (
      <div className="rounded-2xl border border-border p-5" aria-live="polite">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{job!.status === "failed" ? "Loading failed" : `Loading ${ticker}…`}</h3>
          <span className="text-xs text-muted">usually 1–2 minutes</span>
        </div>
        <ol className="mt-4 space-y-2 text-sm">
          {Object.entries(STEP_LABELS).map(([key, label]) => {
            const s = job!.steps?.[key];
            const icon = !s ? "○" : s.status === "done" ? "✓" : s.status === "running" ? "◌" : s.status === "deferred" ? "⏸" : "•";
            return (
              <li key={key} className={s ? "" : "text-muted"}>
                <span className="inline-block w-5">{icon}</span>
                {label}
                {s?.detail && <span className="block pl-5 text-xs text-muted">{s.detail}</span>}
              </li>
            );
          })}
        </ol>
        {job!.status === "queued" && <p className="mt-3 text-xs text-muted">Waiting for GitHub to start the job…</p>}
        {job!.status === "failed" && (
          <>
            <p className="mt-3 text-sm text-down">{job!.message}</p>
            <button onClick={start} className="mt-3 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-black">
              Try again
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={start}
        disabled={starting}
        className={
          mode === "load"
            ? "rounded-full bg-accent px-6 py-3 font-semibold text-black transition hover:brightness-110 disabled:opacity-60"
            : "rounded-full border border-border px-4 py-1.5 text-sm text-muted hover:text-foreground disabled:opacity-60"
        }
      >
        {starting ? "Starting…" : mode === "load" ? `Load ${ticker} data` : "Refresh data"}
      </button>
      {error && <p className="mt-2 text-sm text-down">{error}</p>}
    </div>
  );
}
