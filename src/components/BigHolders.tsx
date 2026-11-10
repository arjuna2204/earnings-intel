import Term from "@/components/Term";

export type BigHolder = { accession: string; form: string; filed_date: string; holder: string; pct: number | null; shares: number | null; activist: boolean; url: string | null };

/** Anyone owning 5% or more must file a Schedule 13G (passive) or 13D (may seek to influence the company). */
export default function BigHolders({ rows }: { rows: BigHolder[] }) {
  // latest filing per holder; a 0% amendment means they sold below 5%
  const latest = new Map<string, BigHolder>();
  for (const r of rows) {
    const k = r.holder.toLowerCase();
    const prev = latest.get(k);
    if (!prev || r.filed_date > prev.filed_date) latest.set(k, r);
  }
  const list = [...latest.values()].filter((r) => (r.pct ?? 0) >= 1).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
  const activists = list.filter((r) => r.activist);
  return (
    <section aria-label="5% holders" id="big-holders" className="scroll-mt-32">
      <h2 className="flex items-center border-b border-border pb-3 text-xl font-semibold tracking-tight">
        <Term k="holders_13dg" quiet>Owners of 5% or more</Term>
      </h2>
      <p className="mt-2 text-[15px]">
        {list.length === 0
          ? "No 5%+ owner has filed in the structured format (used since December 2024)."
          : `${list.length} ${list.length === 1 ? "owner holds" : "owners hold"} 5% or more${activists.length ? `; ${activists.map((a) => a.holder).join(", ")} filed as an active investor (13D), meaning they may push for changes.` : ", all as passive investors."}`}
      </p>
      {list.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {list.map((r) => (
            <li key={r.accession} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2.5">
              <span className="font-medium">
                {r.holder}
                {r.activist && <span className="ml-2 rounded-full border border-border px-1.5 py-px text-[10px] text-muted">Active (13D)</span>}
              </span>
              <span className="text-sm tabular-nums">
                {r.pct != null ? `${r.pct.toFixed(1)}%` : "—"}
                <span className="ml-2 text-xs text-muted">
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">
                      {r.form.replace("SCHEDULE ", "")} · {r.filed_date} ↗
                    </a>
                  ) : (
                    `${r.form.replace("SCHEDULE ", "")} · ${r.filed_date}`
                  )}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
