import "server-only";
import { selectAll } from "@/lib/db";

export type MacroPoint = [string, number];
export type MacroSeries = { id: string; points: MacroPoint[] };

/** Plain-English definitions; `transform` turns an index into a growth rate where that's what people read. */
export const MACRO: Record<string, { name: string; unit: "%" | "pts" | "$" | "k" | "idx"; transform?: "yoy" | "diff"; freq: "daily" | "weekly" | "monthly" | "quarterly"; why: string }> = {
  DGS10: { name: "10-year Treasury yield", unit: "%", freq: "daily", why: "The base rate for mortgages and corporate borrowing, and the discount rate behind stock valuations. Higher yields weigh most on long-duration growth stocks, REITs and utilities." },
  DGS2: { name: "2-year Treasury yield", unit: "%", freq: "daily", why: "Tracks where markets expect the Fed's rate to be over the next two years." },
  T10Y2Y: { name: "Yield curve (10-yr minus 2-yr)", unit: "pts", freq: "daily", why: "Below zero (inverted) has preceded most US recessions. A steeper curve helps banks, which borrow short and lend long." },
  DFF: { name: "Fed funds rate", unit: "%", freq: "daily", why: "The Federal Reserve's policy rate: what cash earns and what short-term borrowing costs." },
  CPIAUCSL: { name: "Inflation (CPI, year over year)", unit: "%", transform: "yoy", freq: "monthly", why: "How fast consumer prices are rising. High inflation keeps rates high and squeezes companies that can't raise prices." },
  CPILFESL: { name: "Core inflation (ex food & energy)", unit: "%", transform: "yoy", freq: "monthly", why: "The Fed's preferred way to see the underlying trend in prices." },
  UNRATE: { name: "Unemployment rate", unit: "%", freq: "monthly", why: "A rising rate usually means slowing consumer spending — watch it for retailers, restaurants and travel." },
  PAYEMS: { name: "Jobs added (monthly)", unit: "k", transform: "diff", freq: "monthly", why: "New jobs each month; the most-watched sign of how fast the economy is growing." },
  A191RL1Q225SBEA: { name: "Real GDP growth (annualized)", unit: "%", freq: "quarterly", why: "Total economic output after inflation. Industrials, materials and banks are most tied to it." },
  BAMLH0A0HYM2: { name: "High-yield credit spread", unit: "pts", freq: "daily", why: "Extra interest riskier companies pay over Treasuries. When it jumps, lenders are getting nervous — often before stocks fall." },
  DCOILWTICO: { name: "Oil price (WTI)", unit: "$", freq: "daily", why: "Drives energy-company profits and is a cost for airlines, chemicals and transport." },
  MORTGAGE30US: { name: "30-year mortgage rate", unit: "%", freq: "weekly", why: "Sets housing affordability: homebuilders, home improvement retailers and mortgage lenders move with it." },
  UMCSENT: { name: "Consumer sentiment", unit: "idx", freq: "monthly", why: "How confident households feel; it often leads discretionary spending." },
  VIXCLS: { name: "VIX (expected volatility)", unit: "idx", freq: "daily", why: "What options imply for S&P 500 swings over the next month. Above ~25 means markets are nervous." },
};

/** Which macro numbers matter most for each sector fund (and so for the companies in it). */
export const SECTOR_MACRO: Record<string, { ids: string[]; note: string }> = {
  XLF: { ids: ["T10Y2Y", "DFF", "BAMLH0A0HYM2"], note: "Banks earn the gap between short and long rates, and lose when borrowers default." },
  XLRE: { ids: ["DGS10", "MORTGAGE30US"], note: "Real estate is bought with borrowed money and valued against bond yields." },
  XLU: { ids: ["DGS10"], note: "Utilities compete with bonds for income investors." },
  XLE: { ids: ["DCOILWTICO"], note: "Energy profits rise and fall with oil and gas prices." },
  XLK: { ids: ["DGS10", "A191RL1Q225SBEA"], note: "Tech valuations lean on profits far in the future, which higher yields discount more heavily." },
  QQQ: { ids: ["DGS10", "A191RL1Q225SBEA"], note: "Tech valuations lean on profits far in the future, which higher yields discount more heavily." },
  XLY: { ids: ["UMCSENT", "UNRATE", "MORTGAGE30US"], note: "Discretionary spending follows jobs, confidence and borrowing costs." },
  XLP: { ids: ["CPIAUCSL"], note: "Staples sell steadily; inflation in their costs is the main swing factor." },
  XLI: { ids: ["A191RL1Q225SBEA", "PAYEMS"], note: "Industrial orders follow the economic cycle." },
  XLB: { ids: ["A191RL1Q225SBEA", "DCOILWTICO"], note: "Materials demand follows global growth; energy is a big cost." },
  XLV: { ids: ["DGS10"], note: "Health care is the least tied to the economy; rates matter mostly for valuations." },
  XLC: { ids: ["A191RL1Q225SBEA", "UMCSENT"], note: "Advertising budgets track the economy and consumer confidence." },
};

export async function getMacro(ids: string[], years = 5): Promise<MacroSeries[]> {
  const since = new Date(Date.now() - (years + 1) * 365 * 86400000).toISOString().slice(0, 10);
  const rows = await selectAll<{ series: string; date: string; value: number }>("macro_series", {
    series: `in.(${ids.join(",")})`,
    date: `gte.${since}`,
    select: "series,date,value",
    order: "date",
  }).catch(() => []);
  return ids.map((id) => {
    let pts: MacroPoint[] = rows.filter((r) => r.series === id).map((r) => [r.date, r.value]);
    const t = MACRO[id]?.transform;
    if (t === "yoy") pts = pts.slice(12).map(([d, v], i) => [d, (v / pts[i][1] - 1) * 100]);
    if (t === "diff") pts = pts.slice(1).map(([d, v], i) => [d, v - pts[i][1]]);
    const cut = new Date(Date.now() - years * 365 * 86400000).toISOString().slice(0, 10);
    return { id, points: pts.filter(([d]) => d >= cut) };
  });
}

export function fmtMacro(id: string, v: number): string {
  const u = MACRO[id]?.unit;
  if (u === "%") return `${v.toFixed(2)}%`;
  if (u === "pts") return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
  if (u === "$") return `$${v.toFixed(2)}`;
  if (u === "k") return `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v)).toLocaleString()}K`;
  return v.toFixed(1);
}

/** Latest value and its change over ~3 months, for one-line readings. */
export function reading(s: MacroSeries): { last: MacroPoint; change: number | null } | null {
  if (!s.points.length) return null;
  const last = s.points[s.points.length - 1];
  const target = new Date(Date.parse(last[0]) - 91 * 86400000).toISOString().slice(0, 10);
  const then = [...s.points].reverse().find(([d]) => d <= target);
  return { last, change: then ? last[1] - then[1] : null };
}
