import Term from "@/components/Term";
import ExportTable from "@/components/ExportTable";

export type PayRow = {
  year_end: string;
  ceo_reported?: number;
  ceo_actually_paid?: number;
  others_reported?: number;
  tsr?: number;
  peer_tsr?: number;
  net_income?: number;
  company_measure?: number;
};
export type Pay = {
  rows: PayRow[];
  measure_name: string | null;
  ceo_names: string[];
};
export type Leader = {
  owner: string;
  role: string | null;
  last: string;
  shares: number | null;
};

const money = (v: number | null | undefined) =>
  v == null
    ? "—"
    : Math.abs(v) >= 1e9
      ? `$${(v / 1e9).toFixed(1)}B`
      : Math.abs(v) >= 1e6
        ? `$${(v / 1e6).toFixed(1)}M`
        : `$${(v / 1e3).toFixed(0)}K`;
const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** CEO pay against shareholder returns (the proxy's pay-vs-performance table), plus who runs the company. */
export default function LeadershipView({
  pay,
  filed,
  payUrl,
  leaders,
  price,
}: {
  pay: Pay | null;
  filed: string | null;
  payUrl: string | null;
  leaders: Leader[];
  price: number | null;
}) {
  const rows =
    pay?.rows.filter((r) => r.ceo_reported != null || r.tsr != null) ?? [];
  const last = rows.at(-1);
  const first = rows[0];
  let headline = "";
  if (last && first && last.tsr != null && last.ceo_actually_paid != null) {
    const tsrPct = last.tsr - 100;
    headline = `A $100 investment ${rows.length > 1 ? `made ${rows.length} years earlier` : ""} was worth $${last.tsr.toFixed(0)} by ${last.year_end.slice(0, 4)}${last.peer_tsr != null ? ` (peer index: $${last.peer_tsr.toFixed(0)})` : ""}; the CEO's pay "actually paid" that year was ${money(last.ceo_actually_paid)}${
      last.ceo_reported != null
        ? ` vs ${money(last.ceo_reported)} reported`
        : ""
    }${tsrPct < 0 && last.ceo_actually_paid > (last.ceo_reported ?? 0) ? " — pay rose while shareholders lost money." : "."}`;
  }
  const officers = leaders.filter(
    (l) => l.role && !/^10% owner$/i.test(l.role),
  );
  return (
    <div className="space-y-10">
      <section aria-label="Pay versus performance">
        <h2 className="flex items-center border-b border-border pb-3 text-xl font-semibold tracking-tight">
          <Term k="pay_vs_performance" quiet>
            Is management paid for results?
          </Term>
        </h2>
        {rows.length ? (
          <>
            <p className="mt-2 text-[15px]">{headline}</p>
            <div className="mt-4 overflow-x-auto">
              <ExportTable name="pay-vs-performance">
                <table className="w-full min-w-[34rem] text-sm tabular-nums">
                  <thead className="text-xs text-muted">
                    <tr className="border-b border-border">
                      <th className="py-2 text-left font-medium">
                        Fiscal year
                      </th>
                      <th className="py-2 text-right font-medium">
                        <Term k="pay_vs_performance" quiet>
                          CEO pay (reported)
                        </Term>
                      </th>
                      <th className="py-2 text-right font-medium">
                        CEO pay (actually paid)
                      </th>
                      <th className="py-2 text-right font-medium">
                        $100 invested became
                      </th>
                      <th className="pro-only py-2 text-right font-medium">
                        Peer index
                      </th>
                      <th className="pro-only py-2 text-right font-medium">
                        Net income
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {[...rows].reverse().map((r) => (
                      <tr key={r.year_end}>
                        <td className="py-2">{r.year_end.slice(0, 4)}</td>
                        <td className="py-2 text-right">
                          {money(r.ceo_reported)}
                        </td>
                        <td className="py-2 text-right">
                          {money(r.ceo_actually_paid)}
                        </td>
                        <td
                          className={`py-2 text-right ${r.tsr == null ? "" : r.tsr >= 100 ? "text-up" : "text-down"}`}
                        >
                          {r.tsr == null
                            ? "—"
                            : `${r.tsr >= 100 ? "▲" : "▼"} $${r.tsr.toFixed(0)}`}
                        </td>
                        <td className="pro-only py-2 text-right text-muted">
                          {r.peer_tsr == null
                            ? "—"
                            : `$${r.peer_tsr.toFixed(0)}`}
                        </td>
                        <td className="pro-only py-2 text-right text-muted">
                          {money(r.net_income)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ExportTable>
            </div>
            <p className="mt-2 text-xs text-muted">
              From the proxy statement (DEF 14A) filed {filed}
              {payUrl && (
                <>
                  {" "}
                  ·{" "}
                  <a
                    href={payUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    read it ↗
                  </a>
                </>
              )}
              . &quot;Actually paid&quot; counts stock awards at their current
              value, so it rises and falls with the share price.
              {pay?.ceo_names.length
                ? ` CEO: ${pay.ceo_names.join(", ")}.`
                : ""}
              {pay?.measure_name
                ? ` The company's own key pay measure: ${pay.measure_name}.`
                : ""}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">
            This company&apos;s proxy statement doesn&apos;t include the tagged
            pay-versus-performance table (smaller and foreign companies are
            exempt).
          </p>
        )}
      </section>

      <section aria-label="Leadership">
        <h2 className="flex items-center border-b border-border pb-3 text-xl font-semibold tracking-tight">
          <Term k="leadership" quiet>
            Who runs it
          </Term>
        </h2>
        <p className="mt-2 text-[15px]">
          {officers.length
            ? `${officers.length} executives and directors have reported trades in the stock in the last two years.`
            : "No executive or director stock filings in the last two years."}
        </p>
        {officers.length > 0 && (
          <ul className="mt-3 divide-y divide-border">
            {officers.map((l) => (
              <li
                key={l.owner}
                className="flex flex-wrap items-baseline justify-between gap-x-4 py-2.5"
              >
                <span>
                  <span className="font-medium">{titleCase(l.owner)}</span>
                  <span className="ml-2 text-sm text-muted">{l.role}</span>
                </span>
                <span className="text-sm tabular-nums text-muted">
                  {l.shares != null
                    ? `${Math.round(l.shares).toLocaleString()} shares${price ? ` (${money(l.shares * price)})` : ""}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">
          From Form 4 filings; shares are the holdings reported after each
          person&apos;s latest trade.
        </p>
      </section>
    </div>
  );
}
