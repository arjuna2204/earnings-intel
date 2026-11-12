import Link from "next/link";
import Term from "@/components/Term";

export type Supply = {
  customers: { name: string; share_pct: number | null; basis: string; period: string; quote: string }[];
  suppliers: { name: string; role: string; quote: string }[];
  sole_source: boolean;
};

/** Who the company sells to and depends on, from its own 10-K (every line quotes the filing). */
export default function SupplyView({
  s,
  filed,
  url,
  dependents,
}: {
  s: Supply | null;
  filed: string | null;
  url: string | null;
  dependents: { ticker: string; name: string; role: string }[];
}) {
  if (!s) {
    return <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">Customers and suppliers are read from each company&apos;s latest 10-K every morning. Not read for this company yet.</p>;
  }
  // individual customers only; groups like "top ten customers" would double count
  const rev = s.customers.filter((c) => c.basis === "revenue" && c.share_pct != null && !/^(top|largest)\b|customers\b/i.test(c.name));
  const top = rev.reduce((a, c) => a + (c.share_pct ?? 0), 0);
  const headline = rev.length
    ? `${rev.length === 1 ? "One customer" : `${rev.length} customers`} made up ${top.toFixed(0)}% of revenue — ${top >= 30 ? "a heavy dependence on a few buyers" : "a notable concentration"}.`
    : s.customers.length
      ? "The filing names large customers but gives no revenue share."
      : "No single customer is large enough to disclose (under 10% of revenue each).";
  return (
    <div className="space-y-10">
      <section aria-label="Customers">
        <h2 className="flex items-center border-b border-border pb-3 text-xl font-semibold tracking-tight">
          <Term k="customer_concentration" quiet>Biggest customers</Term>
        </h2>
        <p className="mt-2 text-[15px]">{headline}</p>
        {s.customers.length > 0 && (
          <ul className="mt-3 divide-y divide-border">
            {s.customers.map((c) => (
              <li key={c.name + c.basis} className="py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{c.name}</span>
                  <span className="tabular-nums">
                    {c.share_pct != null ? `${c.share_pct}% of ${c.basis}` : "—"}
                    {c.period && <span className="ml-1 text-xs text-muted">({c.period})</span>}
                  </span>
                </div>
                <p className="pro-only mt-0.5 text-xs text-muted">“{c.quote}”</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Suppliers">
        <h2 className="flex items-center border-b border-border pb-3 text-xl font-semibold tracking-tight">
          <Term k="key_suppliers" quiet>Who it depends on</Term>
        </h2>
        <p className="mt-2 text-[15px]">
          {s.suppliers.length ? `The 10-K names ${s.suppliers.length} supplier${s.suppliers.length === 1 ? "" : "s"} or partner${s.suppliers.length === 1 ? "" : "s"} it relies on.` : "The 10-K doesn't name specific suppliers."}
          {s.sole_source && " It says it relies on a single or limited number of sources for key parts or manufacturing."}
        </p>
        {s.suppliers.length > 0 && (
          <ul className="mt-3 divide-y divide-border">
            {s.suppliers.map((x) => (
              <li key={x.name} className="py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{x.name}</span>
                  <span className="text-sm text-muted">{x.role}</span>
                </div>
                <p className="pro-only mt-0.5 text-xs text-muted">“{x.quote}”</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dependents.length > 0 && (
        <section aria-label="Who depends on it">
          <h2 className="border-b border-border pb-3 text-xl font-semibold tracking-tight">Who names it as a supplier</h2>
          <p className="mt-2 text-[15px]">Companies on Earnings Intel whose 10-K says they rely on it.</p>
          <ul className="mt-3 divide-y divide-border">
            {dependents.map((d) => (
              <li key={d.ticker}>
                <Link href={`/c/${d.ticker}?tab=business&view=supply`} className="flex items-baseline justify-between gap-3 py-2.5 hover:text-accent">
                  <span>
                    <span className="font-semibold">{d.ticker}</span> <span className="text-muted">{d.name}</span>
                  </span>
                  <span className="text-sm text-muted">{d.role}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-xs text-muted">
        From the 10-K filed {filed ?? "—"}
        {url && (
          <>
            {" "}
            (
            <a href={url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
              read it ↗
            </a>
            )
          </>
        )}
        . Companies must disclose any customer worth 10% or more of revenue. Read by AI; every line is checked against the filing&apos;s exact wording, quoted under each name.
      </p>
    </div>
  );
}
