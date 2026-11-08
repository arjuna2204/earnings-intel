-- Phase 2: earnings calls. RLS on, no policies (server-only access), like every other table.

-- When each quarter was reported (drives chart dots, period picker and price reaction).
create table public.earnings_events (
  cik             integer not null references public.companies (cik) on delete cascade,
  fiscal_year     integer not null,
  fiscal_quarter  integer not null check (fiscal_quarter between 1 and 4),
  period_end      date not null,
  report_date     date not null,
  report_time     text,             -- 'pre-market' | 'post-market' | null
  eps_reported    double precision,
  eps_estimated   double precision,
  source          text not null default 'alpha_vantage',
  primary key (cik, fiscal_year, fiscal_quarter)
);

-- Raw transcripts, fetched once and never again (Postgres compresses large jsonb automatically).
create table public.transcripts (
  cik             integer not null references public.companies (cik) on delete cascade,
  fiscal_year     integer not null,
  fiscal_quarter  integer not null check (fiscal_quarter between 1 and 4),
  provider        text not null,
  turns           jsonb not null,   -- [{speaker, title, content}]
  sha256          text not null,
  fetched_at      timestamptz not null default now(),
  primary key (cik, fiscal_year, fiscal_quarter)
);

-- Everything derived from one call. Cache key includes analysis_version so prompt changes re-run.
create table public.call_analysis (
  cik               integer not null references public.companies (cik) on delete cascade,
  fiscal_year       integer not null,
  fiscal_quarter    integer not null,
  analysis_version  text not null,
  parsed            jsonb not null,   -- speakers/roles, sections, Q&A exchanges
  tone              jsonb not null,   -- word-list rates per speaker and section (free)
  extraction        jsonb,            -- AI: guidance, KPIs, risks, topics (verified quotes only)
  evasiveness       jsonb,            -- AI: per Q&A exchange score + reason
  dropped_claims    jsonb not null default '[]'::jsonb, -- quotes that failed verbatim check (logged)
  price_reaction    jsonb,
  cost_usd          numeric(10,6) not null default 0,
  status            text not null default 'done', -- 'done' | 'partial' (e.g. budget reached)
  note              text,
  created_at        timestamptz not null default now(),
  primary key (cik, fiscal_year, fiscal_quarter, analysis_version)
);

-- Two-period comparisons (computed in code from two call_analysis rows).
create table public.call_comparisons (
  cik               integer not null references public.companies (cik) on delete cascade,
  period_a          text not null,    -- e.g. 'FY2025Q4' (earlier)
  period_b          text not null,    -- e.g. 'FY2026Q4' (later)
  analysis_version  text not null,
  result            jsonb not null,
  created_at        timestamptz not null default now(),
  primary key (cik, period_a, period_b, analysis_version)
);

alter table public.earnings_events  enable row level security;
alter table public.transcripts      enable row level security;
alter table public.call_analysis    enable row level security;
alter table public.call_comparisons enable row level security;

-- Month-to-date spend helper for the budget guard (US Eastern month).
create function public.ai_spend_month_to_date()
returns numeric language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(cost_usd), 0)
  from public.ai_spend
  where created_at >= date_trunc('month', now() at time zone 'America/New_York') at time zone 'America/New_York';
$$;
revoke all on function public.ai_spend_month_to_date() from public, anon, authenticated;
grant execute on function public.ai_spend_month_to_date() to service_role;
