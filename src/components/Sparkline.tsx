/** A small line of recent closes, green if the period is up and orange-red if down. Server-renderable SVG. */
export default function Sparkline({
  values,
  width = 96,
  height = 32,
  className = "",
  up: upOverride,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  /** color to match a move shown beside it (e.g. the day's move pill); defaults to the line's own direction */
  up?: boolean;
}) {
  const v = values.filter((x) => Number.isFinite(x) && x > 0);
  if (v.length < 2) return <span style={{ width, height }} className={`inline-block ${className}`} aria-hidden />;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const pad = 2;
  const d = v
    .map((p, i) => `${i ? "L" : "M"}${((i / (v.length - 1)) * width).toFixed(1)},${(pad + (height - 2 * pad) * (1 - (p - lo) / (hi - lo || 1))).toFixed(1)}`)
    .join(" ");
  const up = upOverride ?? v[v.length - 1] >= v[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={`spark overflow-visible ${className}`} aria-hidden>
      <path d={d} fill="none" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={up ? "stroke-up" : "stroke-down"} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
