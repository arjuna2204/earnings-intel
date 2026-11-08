-- Phase 3: filing text, risk-factor redlines, earnings-release figures, MD&A drivers, briefs.
alter table public.filings add column if not exists items text;  -- 8-K item codes, e.g. "2.02,9.01"

create table public.filing_sections (
  accession   text not null,
  cik         integer not null references public.companies (cik) on delete cascade,
  section     text not null,            -- business | risk_factors | mdna | release
  form        text not null,
  report_date date,
  title       text,
  paragraphs  jsonb not null,           -- ["para text", ...] (exact text quotes are checked against)
  risk_factors jsonb,                   -- [{idx, category, headline, body}] for risk_factors
  parser_version text not null,
  fetched_at  timestamptz not null default now(),
  primary key (accession, section)
);
create index filing_sections_cik_idx on public.filing_sections (cik);

create table public.risk_comparisons (
  cik           integer not null references public.companies (cik) on delete cascade,
  accession_new text not null,
  accession_old text not null,
  version       text not null,
  summary       jsonb not null,
  changes       jsonb not null,
  created_at    timestamptz not null default now(),
  primary key (cik, accession_new, accession_old, version)
);

-- AI extractions from one filing document (earnings release figures, MD&A drivers).
create table public.filing_analysis (
  accession   text not null,
  cik         integer not null references public.companies (cik) on delete cascade,
  kind        text not null,            -- release | mdna
  version     text not null,
  period      text,                     -- fiscal quarter label, e.g. FY2026Q4
  result      jsonb not null,           -- verified items only
  dropped     jsonb,
  raw         jsonb,
  cost_usd    numeric(12,6) not null default 0,
  created_at  timestamptz not null default now(),
  primary key (accession, kind, version)
);
create index filing_analysis_cik_idx on public.filing_analysis (cik, kind);

create table public.briefs (
  cik         integer not null references public.companies (cik) on delete cascade,
  period_a    text not null,
  period_b    text not null,
  version     text not null,
  inputs      jsonb not null,           -- the structured facts the brief may cite, keyed by source id
  claims      jsonb not null,           -- verified claims with source_refs
  dropped     jsonb,
  raw         jsonb,
  cost_usd    numeric(12,6) not null default 0,
  created_at  timestamptz not null default now(),
  primary key (cik, period_a, period_b, version)
);

alter table public.filing_sections  enable row level security;
alter table public.risk_comparisons enable row level security;
alter table public.filing_analysis  enable row level security;
alter table public.briefs           enable row level security;
