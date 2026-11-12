// Company page sections (shared by the server page and the browser tab bar).
// Five tabs; some have views (pills under the tab bar). Old tab links (?tab=call, ?tab=street, ...)
// still work: each old key is now a view.
export const TABS = [
  { key: "overview", label: "Overview" },
  { key: "earnings", label: "Earnings" },
  { key: "financials", label: "Financials" },
  { key: "valuation", label: "Valuation" },
  { key: "risk", label: "Risk" },
  { key: "business", label: "Business" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

/** Views inside each tab (pills under the tab bar). The first view is the default. */
export const VIEWS: Record<TabKey, { key: ViewKey; label: string }[]> = {
  overview: [{ key: "overview", label: "Overview" }],
  earnings: [
    { key: "brief", label: "What changed" },
    { key: "call", label: "The call" },
    { key: "events", label: "Company events" },
    { key: "search", label: "Search filings & calls" },
  ],
  financials: [{ key: "historical", label: "Financials" }],
  valuation: [
    { key: "street", label: "Fair value & Street" },
    { key: "peers", label: "Peers" },
  ],
  risk: [
    { key: "riskfactors", label: "New risk factors" },
    { key: "riskstats", label: "Price risk" },
    { key: "ownership", label: "Who owns it" },
    { key: "options", label: "Options" },
  ],
  business: [
    { key: "supply", label: "Customers & suppliers" },
    { key: "leaders", label: "Leadership & pay" },
  ],
};

export type ViewKey = "leaders" | "search" | "supply" | "overview" | "brief" | "call" | "events" | "historical" | "street" | "peers" | "ownership" | "riskstats" | "riskfactors" | "options" | "sources";

const VIEW_TAB: Record<ViewKey, TabKey> = {
  overview: "overview",
  brief: "earnings",
  call: "earnings",
  events: "earnings",
  search: "earnings",
  historical: "financials",
  street: "valuation",
  peers: "valuation",
  ownership: "risk",
  riskstats: "risk",
  riskfactors: "risk",
  supply: "business",
  leaders: "business",
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
  filings: "brief", // the Filings view is now "From the filings" inside What changed
  redline: "riskfactors",
};

/** Resolve ?tab= and ?view= (old or new links) to the tab and the view to render. */
export function resolveTab(tab: string | null | undefined, view: string | null | undefined): { tab: TabKey; view: ViewKey } {
  const isView = (k: string | null | undefined): k is ViewKey => Boolean(k && k in VIEW_TAB);
  const v = view && (ALIASES[view] ?? view);
  const t = tab && (ALIASES[tab] ?? tab);
  if (isView(v)) return { tab: VIEW_TAB[v], view: v }; // a view always opens under its own tab (old ?tab=risk&view=supply links too)
  if (t && TABS.some((x) => x.key === t)) {
    const key = t as TabKey;
    return { tab: key, view: VIEWS[key][0].key };
  }
  if (isView(t)) return { tab: VIEW_TAB[t], view: t }; // old link like ?tab=call
  return { tab: "overview", view: "overview" };
}

/** Link to a view. Keeps other query params (a, b) when given. */
export function viewHref(path: string, view: ViewKey, extra = ""): string {
  return `${path}?tab=${VIEW_TAB[view]}&view=${view}${extra}`;
}
