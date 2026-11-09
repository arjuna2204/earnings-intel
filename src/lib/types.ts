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
  shares_note?: string;
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
  street_source?: string;
  adj_eps_ltm?: number | null;
  adj_eps_ltm_quarters?: string[];
  pe_adj_ltm?: number | null;
  adj_eps_run_rate?: number | null;
  adj_eps_run_rate_quarter?: string | null;
  pe_adj_run_rate?: number | null;
  eps_ntm?: number | null;
  eps_ntm_method?: string;
  pe_fwd_ntm?: number | null;
  dividend_yield?: number | null;
  dividend_per_share_ttm?: number | null;
  shareholder_yield?: number | null;
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
  params?: Record<string, string>;
  created_at: string;
  finished_at: string | null;
};

export type TickerHit = { ticker: string; cik: number; name: string; exchange: string | null };

export type EarningsEvent = {
  fiscal_year: number;
  fiscal_quarter: number;
  period_end: string;
  report_date: string;
  report_time: string | null;
  eps_reported: number | null;
  eps_estimated: number | null;
};

export type Quoted = { quote: string; turn: number; speaker?: string; role?: string; section?: string };
export type GuidanceItem = Quoted & {
  metric: string;
  period: string;
  low: number | null;
  high: number | null;
  point: number | null;
  unit: string | null;
  qualitative: string | null;
  withdrawn: boolean;
  numbers_removed?: boolean;
};
export type TopicItem = Quoted & { label: string; summary: string; turns: number[] };
export type RiskItem = Quoted & { label: string; summary: string };
export type KpiItem = Quoted & { name: string; value: number | null; unit: string | null; period: string | null };

export type ToneRates = {
  words: number;
  uncertainty_rate: number;
  positive_rate: number;
  negative_rate: number;
  net_tone: number;
};

export type PriceReaction = {
  base_date: string;
  timing: string;
  r1: number | null;
  r5: number | null;
  bench_r1: number | null;
  bench_r5: number | null;
  excess_r1: number | null;
  excess_r5: number | null;
} | null;

export type CallAnalysis = {
  fiscal_year: number;
  fiscal_quarter: number;
  status: "done" | "partial";
  note: string | null;
  cost_usd: string;
  parsed: {
    turns: { i: number; speaker: string; title: string; role: string; section: string; words: number }[];
    speakers: Record<string, string>;
    qa_start: number | null;
    exchanges: { id: number; analyst: string; question_turns: number[]; answer_turns: number[] }[];
  };
  tone: {
    speakers: Record<string, { role: string } & Partial<Record<"prepared" | "qa" | "all", ToneRates>>>;
    executives: Partial<Record<"prepared" | "qa" | "all", ToneRates>>;
  };
  extraction: { guidance: GuidanceItem[]; kpis: KpiItem[]; risks: RiskItem[]; topics: TopicItem[] } | null;
  evasiveness: { exchange: number; analyst: string; question_turns: number[]; answer_turns: number[]; evasiveness: number; reason: string }[] | null;
  dropped_claims: unknown[];
  price_reaction: PriceReaction;
};

export type GuidanceChange = {
  metric: string;
  earlier: GuidanceItem | null;
  later: GuidanceItem | null;
  change: "raised" | "lowered" | "maintained" | "new" | "withdrawn" | "not repeated" | "changed basis" | "qualitative";
  delta?: number;
  delta_pct?: number | null;
  note?: string;
};

export type TopicChange = {
  label: string;
  earlier: TopicItem | null;
  later: TopicItem | null;
  share_a: number;
  share_b: number;
  change: "new" | "dropped" | "expanded" | "reduced" | "steady";
};

export type CallComparison = {
  period_a: string;
  period_b: string;
  embedder: string;
  guidance: GuidanceChange[];
  topics: TopicChange[];
  tone: Partial<Record<"prepared" | "qa" | "all", Record<keyof Omit<ToneRates, "words">, { a: number; b: number; delta: number }>>>;
  price_reaction: Record<string, PriceReaction>;
  partial: boolean;
};
