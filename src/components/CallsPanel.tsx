"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Job } from "@/lib/types";

type Option = { value: string; label: string };

const STEP_ORDER = ["company", "dates"];

/** Choose two quarters, start the comparison job, and follow its progress. */
export default function CallsPanel({
  ticker,
  options,
  a,
  b,
  initialJob,
  hasResult,
}: {
  ticker: string;
  options: Option[];
  a: string;
  b: string;
  initialJob: Job | null;
  hasResult: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const [pa, setPa] = useState(a);
  const [pb, setPb] = useState(b);
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
      if (next.steps?.compare?.status === "done" || ["done", "failed", "deferred"].includes(next.status)) router.refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [job, active, router]);

  const select = (which: "a" | "b", v: string) => {
    if (which === "a") setPa(v);
    else setPb(v);
    const next = new URLSearchParams({ tab: "call", a: which === "a" ? v : pa, b: which === "b" ? v : pb });
    router.replace(`${path}?${next}`, { scroll: false });
  };

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, period_a: pa, period_b: pb }),
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

  const steps = job?.steps ?? {};
  const stepKeys = [...STEP_ORDER.filter((k) => steps[k]), ...Object.keys(steps).filter((k) => k.startsWith("FY")), "compare", "history"].filter(
    (k, i, arr) => steps[k] && arr.indexOf(k) === i,
  );

  return (
    <div className="rounded-2xl border border-border p-5">
      <div className="flex flex-wrap items-end gap-3">
        <PeriodSelect label="Compare" value={pa} options={options} onChange={(v) => select("a", v)} />
        <span className="pb-2 text-muted">→</span>
        <PeriodSelect label="with" value={pb} options={options} onChange={(v) => select("b", v)} />
        {!active && (
          <button
            onClick={start}
            disabled={starting || pa === pb}
            className="ml-auto rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
          >
            {starting ? "Starting…" : hasResult ? "Re-run" : "Analyze calls"}
          </button>
        )}
      </div>
      {!active && !hasResult && (
        <p className="mt-3 text-xs text-muted">
          Uses ~3 free transcript requests and about $0.01 of AI budget for two new quarters (cached quarters are free).
        </p>
      )}
      {error && <p className="mt-3 text-sm text-down">{error}</p>}
      {job && (active || job.status === "failed" || job.status === "deferred") && (
        <div className="mt-4 border-t border-border pt-4 text-sm" aria-live="polite">
          {job.status === "queued" && <p className="text-muted">Waiting for GitHub to start the job…</p>}
          <ol className="space-y-1.5">
            {stepKeys.map((k) => {
              const s = steps[k];
              const icon = s.status === "done" ? "✓" : s.status === "running" ? "◌" : s.status === "deferred" ? "⏸" : "•";
              const label = k === "dates" ? "Earnings dates" : k === "compare" ? "Compare" : k === "history" ? "Tone history (background)" : k === "company" ? "Load company" : k;
              return (
                <li key={k}>
                  <span className="inline-block w-5">{icon}</span>
                  {label}
                  {s.detail && <span className="block pl-5 text-xs text-muted">{s.detail}</span>}
                </li>
              );
            })}
          </ol>
          {job.status !== "running" && job.message && <p className={`mt-2 ${job.status === "failed" ? "text-down" : "text-muted"}`}>{job.message}</p>}
        </div>
      )}
    </div>
  );
}

function PeriodSelect({ label, value, options, onChange }: { label: string; value: string; options: Option[]; onChange: (v: string) => void }) {
  return (
    <label className="text-xs text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
