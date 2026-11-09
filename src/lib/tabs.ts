// Company page tabs (shared by the server page and the browser tab bar).
export const TABS = [
  { key: "brief", label: "Brief" },
  { key: "street", label: "StreetView" },
  { key: "historical", label: "Historical" },
  { key: "call", label: "Call" },
  { key: "filings", label: "Filings" },
  { key: "peers", label: "Peers" },
  { key: "ownership", label: "Ownership" },
  { key: "sources", label: "Sources" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];
const ALIASES: Record<string, TabKey> = { financials: "historical", streetview: "street", insiders: "ownership", holders: "ownership" };
export const normalizeTab = (t: string | null | undefined, fallback: TabKey): TabKey =>
  (t && (ALIASES[t] ?? (TABS.some((x) => x.key === t) ? (t as TabKey) : undefined))) || fallback;
