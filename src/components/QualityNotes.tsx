import type { Company } from "@/lib/types";

/** Numbers held back or flagged by the daily data-quality checks, said plainly under the valuation strip. */
export default function QualityNotes({ flags }: { flags: Company["quality"] }) {
  // held-back DCFs and segment views explain themselves where they would have appeared
  const shown = (flags ?? []).filter(
    (f) => !(f.severity === "hide" && f.fields.length > 0 && f.fields.every((x) => x === "dcf" || x.startsWith("segments:"))),
  );
  if (!shown.length) return null;
  return (
    <details className="mt-3 text-xs text-muted">
      <summary className="cursor-pointer list-none hover:text-foreground">
        <span aria-hidden>⚠︎ </span>
        {shown.some((f) => f.severity === "hide") ? "Some numbers are held back because they failed our daily checks" : "Our daily checks flagged some numbers"}
        <span className="underline decoration-dotted underline-offset-2"> · why</span>
      </summary>
      <ul className="mt-2 space-y-1 pl-4">
        {shown.map((f) => (
          <li key={f.check} className="list-disc">
            {f.severity === "hide" ? "Hidden: " : ""}
            {f.message}
          </li>
        ))}
      </ul>
    </details>
  );
}
