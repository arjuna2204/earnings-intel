/**
 * SEC registrant names are often ALL CAPS with state tags ("TJX COMPANIES INC /DE/").
 * Turn them into how people write them ("TJX Companies Inc."). Names that already use
 * mixed case keep their casing; only the tags are trimmed.
 */

// Kept in capitals: tickers-as-names and initialisms.
const UPPER = new Set(
  "IBM AMD KLA NVIDIA HCA MSCI RTX GE CVS UPS ADP AES EOG CME ICE PNC USA US II III IV MGM NXP ASML SAP BHP TSMC PPG PPL DTE WEC AEP CMS NRG SBA HP ABB TJX CSX CBRE CDW CF CH DXC EPAM FMC GXO IDEXX IQVIA KKR LKQ MKS NVR ONEOK PTC QXO RPM SS&C TE UDR WR ZTO AG SE NV SA BV LLC LP REIT ETF FMC A.O. J.M. W.R. T. JB".split(" "),
);
const SPECIAL: Record<string, string> = {
  JPMORGAN: "JPMorgan",
  MCDONALDS: "McDonald's",
  "MCDONALD'S": "McDonald's",
  PAYPAL: "PayPal",
  EBAY: "eBay",
  BLACKROCK: "BlackRock",
  FEDEX: "FedEx",
  DOORDASH: "DoorDash",
  SALESFORCE: "Salesforce",
  CROWDSTRIKE: "CrowdStrike",
  SERVICENOW: "ServiceNow",
  MASTERCARD: "Mastercard",
  EXXON: "Exxon",
};
const SUFFIX: Record<string, string> = {
  INC: "Inc.",
  "INC.": "Inc.",
  CORP: "Corp.",
  "CORP.": "Corp.",
  CO: "Co.",
  "CO.": "Co.",
  LTD: "Ltd.",
  "LTD.": "Ltd.",
  PLC: "plc",
  "N.V.": "N.V.",
  "S.A.": "S.A.",
  "L.P.": "L.P.",
  OF: "of",
  AND: "and",
  THE: "The",
  "DE": "de",
};

function word(w: string, first: boolean): string {
  const u = w.toUpperCase();
  if (SPECIAL[u]) return SPECIAL[u];
  if (SUFFIX[u] && !(first && (u === "OF" || u === "AND" || u === "DE"))) return SUFFIX[u];
  if (UPPER.has(u) || u.includes("&") || /\d/.test(u) || !/[AEIOUY]/.test(u)) return u;
  return w
    .toLowerCase()
    .replace(/(^|[-'’.(])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase())
    .replace(/^Mc([a-z])/, (_, c: string) => `Mc${c.toUpperCase()}`);
}

export function prettyName(raw: string | null | undefined): string {
  if (!raw) return "";
  // drop state / reorg tags: "/DE/", "/NEW/", "\DE\", trailing slashes and commas
  const name = raw
    .replace(/\s*[/\\][A-Z]{2,4}[/\\]?\s*$/g, "")
    .replace(/\s*[/\\][A-Z]{2,4}[/\\]?\s*$/g, "")
    .replace(/[\s/\\,]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const letters = name.replace(/[^A-Za-z]/g, "");
  const upper = letters.replace(/[^A-Z]/g, "").length;
  if (!letters || upper / letters.length < 0.85) return name; // already mixed case
  return name
    .split(" ")
    .map((w, i) => word(w, i === 0))
    .join(" ")
    .replace(/,\s*(Inc|Corp|Co|Ltd)\./g, ", $1.")
    .replace(/\.\.$/, ".");
}
