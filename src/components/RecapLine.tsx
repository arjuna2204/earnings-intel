import Term from "@/components/Term";
import type { Recap } from "@/lib/screener";

const pct = (v: number) => `${Math.abs(v * 100).toFixed(1)}%`;
const arrow = (v: number) => (v >= 0 ? "▲" : "▼");
const tone = (v: number) => (v >= 0 ? "text-up" : "text-down");

/** The facts of one report, each from code: EPS vs estimate, the stock's move vs what options priced
 * in, revenue growth and guidance counts. Shown only for the parts that are in. */
export function RecapFacts({ r }: { r: Recap }) {
  const g = r.guidance;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
      {r.eps_actual != null && r.eps_estimate != null ? (
        <span>
          <Term k="eps_surprise" quiet>
            EPS
          </Term>{" "}
          ${r.eps_actual.toFixed(2)} vs ${r.eps_estimate.toFixed(2)} est.
          {r.eps_surprise != null && (
            <span className={`ml-1 font-medium ${tone(r.eps_surprise)}`}>
              {arrow(r.eps_surprise)} {r.eps_surprise >= 0 ? "beat" : "miss"} {pct(r.eps_surprise)}
            </span>
          )}
        </span>
      ) : r.eps_estimate != null ? (
        <span className="text-muted">EPS est. ${r.eps_estimate.toFixed(2)} · result not in yet</span>
      ) : null}
      {r.move != null && (
        <span>
          <Term k="earnings_reaction" quiet>
            Stock
          </Term>{" "}
          <span className={`font-medium ${tone(r.move)}`}>
            {arrow(r.move)} {pct(r.move)}
          </span>
          {r.expected_move != null && (
            <span className="text-muted">
              {" "}
              vs ±{pct(r.expected_move)} expected
              {Math.abs(r.move) > r.expected_move ? " · bigger than priced in" : " · within what was priced in"}
            </span>
          )}
        </span>
      )}
      {r.revenue_growth != null && (
        <span>
          Revenue{" "}
          <span className={tone(r.revenue_growth)}>
            {arrow(r.revenue_growth)} {pct(r.revenue_growth)}
          </span>{" "}
          <span className="text-muted">vs a year ago</span>
        </span>
      )}
      {g && (g.raised || g.lowered || g.maintained) ? (
        <span>
          Guidance{" "}
          <span className={g.raised > g.lowered ? "text-up" : g.lowered > g.raised ? "text-down" : "text-muted"}>
            {g.raised > g.lowered ? "▲ raised" : g.lowered > g.raised ? "▼ lowered" : "held"}
          </span>{" "}
          <span className="text-muted">
            ({g.raised} up · {g.lowered} down · {g.maintained} same)
          </span>
        </span>
      ) : null}
    </div>
  );
}

export function recapDate(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
