export type Company = {
  cik: number;
  ticker: string;
  name: string;
  exchange: string | null;
  sic: string | null;
  sic_description: string | null;
  sector_pack: "general" | "bank" | "reit" | "insurer";
  sector_etf: string | null;
  sector_note: string | null;
  filer_type: "domestic" | "foreign";
  fiscal_year_end: string | null;
  currency: string;
  valuation: Valuation | null;
  last_ingested_at: string | null;
  history_note: string | null;
};

export type Valuation = {
  price: number | null;
  price_date: string | null;
  currency: string;
  note?: string;
  shares_source?: string;
  market_cap?: number | null;
  enterprise_value?: number | null;
  pe?: number | null;
  fcf_yield?: number | null;
  ev_ebitda?: number | null;
  ev_revenue?: number | null;
  p_tbv?: number | null;
  p_b?: number | null;
  fy_fallback?: string[];
};

export type MetricValue = {
  metric: string;
  fiscal_year: number;
  fiscal_period: "FY" | "Q1" | "Q2" | "Q3" | "Q4";
  period_start: string | null;
  period_end: string;
  value: number;
  unit: string;
  source: "reported" | "derived";
  xbrl_tag: string | null;
  derivation: string | null;
  accession: string | null;
  filed_date: string | null;
};

export type Filing = {
  accession: string;
  form: string;
  filed_date: string;
  report_date: string | null;
  url: string;
};

export type PricePoint = { date: string; close: number; adj_close: number };

export type Job = {
  id: number;
  kind: string;
  ticker: string | null;
  status: "queued" | "running" | "done" | "failed" | "deferred";
  steps: Record<string, { status: string; detail: string | null; at: string }>;
  message: string | null;
  created_at: string;
  finished_at: string | null;
};

export type TickerHit = { ticker: string; cik: number; name: string; exchange: string | null };
