/** A move as a tinted pill: green up, orange-red down. `v` is a fraction (0.012 = +1.2%). */
export default function MovePill({ v, digits = 2, className = "" }: { v: number | null | undefined; digits?: number; className?: string }) {
  if (v == null || !Number.isFinite(v)) return <span className={`text-sm text-muted ${className}`}>—</span>;
  const up = v >= 0;
  return (
    <span className={`${up ? "pill-up" : "pill-down"} ${className}`}>
      {up ? "+" : "−"}
      {Math.abs(v * 100).toFixed(digits)}%
    </span>
  );
}
