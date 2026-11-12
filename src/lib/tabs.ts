// Company page sections (shared by the server page and the browser tab bar).
// Five tabs; some have views (pills under the tab bar). Old tab links (?tab=call, ?tab=street, ...)
// still work: each old key is now a view.
export const TABS = [
  { key: "overview", label: "Overview" },
  { key: "earnings", label: "Earnings" },
  { key: "financials", label: "Financials" },
  { key: "valuation", label: "Valuation" },
  { key: "risk", label: "Risk & Ownership" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

/** Views inside each tab. `pro`: marks trader-level views (all views are shown). The first view is the default. */
export const VIEWS: Record<TabKey, { key: ViewKey; label: string; pro?: boolean }[]> = {
  overview: [{ key: "overview", label: "Overview" }],
  earnings: [
    { key: "brief", label: "What changed" },
    { key: "call", label: "The call" },
    { key: "events", label: "Company events" },
    { key: "search", label: "Search filings & calls" },
    { key: "filings", label: "Filings", pro: true },
  ],
  financials: [{ key: "historical", label: "Financials" }],
  valuation: [
    { key: "street", label: "Street & fair value" },
    { key: "peers", label: "Peers" },
  ],
  risk: [
    { key: "ownership", label: "Who owns it" },
    { key: "riskstats", label: "Risk" },
    { key: "supply", label: "Customers & suppliers" },
    { key: "leaders", label: "Leadership & pay" },
    { key: "options", label: "Options", pro: true },
  ],
};

export type ViewKey = "leaders" | "search" | "supply" | "overview" | "brief" | "call" | "events" | "filings" | "historical" | "street" | "peers" | "ownership" | "riskstats" | "options" | "sources";

const VIEW_TAB: Record<ViewKey, TabKey> = {
  overview: "overview",
  brief: "earnings",
  call: "earnings",
  events: "earnings",
  search: "earnings",
  filings: "earnings",
  historical: "financials",
  street: "valuation",
  peers: "valuation",
  ownership: "risk",
  riskstats: "risk",
  supply: "risk",
  leaders: "risk",
  options: "risk",
  sources: "overview", // reached from the footer link
};

// old ?tab= values and other spellings
const ALIASES: Partial<Record<string, ViewKey>> = {
  stats: "riskstats",
  insiders: "ownership",
  holders: "ownership",
  streetview: "street",
  dcf: "street",
};

/** Resolve ?tab= and ?view= (old or new links) to the tab and the view to render. */
export function resolveTab(tab: string | null | undefined, view: string | null | undefined): { tab: TabKey; view: ViewKey } {
  const isView = (k: string | null | undefined): k is ViewKey => Boolean(k && k in VIEW_TAB);
  const v = view && (ALIASES[view] ?? view);
  const t = tab && (ALIASES[tab] ?? tab);
  if (t === "risk" && !view) return { tab: "risk", view: "ownership" };
  if (t && TABS.some((x) => x.key === t)) {
    const key = t as TabKey;
    if (isView(v) && VIEW_TAB[v] === key) return { tab: key, view: v };
    return { tab: key, view: VIEWS[key][0].key };
  }
  if (isView(t)) return { tab: VIEW_TAB[t], view: t }; // old link like ?tab=call
  return { tab: "overview", view: "overview" };
}

/** Link to a view. Keeps other query params (a, b) when given. */
export function viewHref(path: string, view: ViewKey, extra = ""): string {
  return `${path}?tab=${VIEW_TAB[view]}&view=${view}${extra}`;
}
