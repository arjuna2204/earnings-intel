-- Phase 1 schema. Every table has row-level security ON and NO policies:
-- only server code holding the secret key (Vercel routes, GitHub Actions) can read/write.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists vector with schema extensions;

-- All US-listed tickers from SEC company_tickers_exchange.json (light; refreshed daily).
create table public.tickers (
  ticker      text primary key,
  cik         integer not null,
  name        text not null,
  exchange    text,
  updated_at  timestamptz not null default now()
);
create index tickers_cik_idx on public.tickers (cik);
create index tickers_name_trgm_idx on public.tickers using gin (name extensions.gin_trgm_ops);

-- Companies we have fully ingested (analyzed tickers + their peers).
create table public.companies (
  cik              integer primary key,
  ticker           text not null,
  name             text not null,
  sic              text,
  sic_description  text,
  sector_pack      text not null default 'general' check (sector_pack in ('general','bank','reit','insurer')),
  sector_etf       text,
  filer_type       text not null default 'domestic' check (filer_type in ('domestic','foreign')),
  fiscal_year_end  text,            -- 'MMDD' as reported by SEC
  state_of_inc     text,
  last_ingested_at timestamptz,
  is_primary       boolean not null default false, -- analyzed directly (vs. only as a peer)
  created_at       timestamptz not null default now()
);

create table public.filings (
  accession     text primary key,
  cik           integer not null references public.companies (cik) on delete cascade,
  form          text not null,
  filed_date    date not null,
  report_date   date,
  primary_doc   text,
  url           text not null
);
create index filings_cik_form_idx on public.filings (cik, form, filed_date desc);

-- Normalized metric values (reported or derived), one row per company/metric/fiscal period.
create table public.metric_values (
  cik            integer not null references public.companies (cik) on delete cascade,
  metric         text not null,
  fiscal_year    integer not null,
  fiscal_period  text not null check (fiscal_period in ('FY','Q1','Q2','Q3','Q4','TTM')),
  period_start   date,
  period_end     date not null,
  value          double precision not null,
  unit           text not null,
  source         text not null check (source in ('reported','derived')),
  xbrl_tag       text,            -- tag used (reported) or null (derived)
  derivation     text,            -- human-readable formula for derived values
  accession      text,            -- filing the value (or its main input) came from
  filed_date     date,
  primary key (cik, metric, fiscal_year, fiscal_period)
);
create index metric_values_lookup_idx on public.metric_values (cik, metric, period_end);

-- Metrics we could not resolve for a company (shown as "Not reported", never guessed).
create table public.unresolved_metrics (
  cik     integer not null references public.companies (cik) on delete cascade,
  metric  text not null,
  reason  text not null,
  primary key (cik, metric)
);

create table public.prices (
  ticker     text not null,
  date       date not null,
  close      double precision not null,
  adj_close  double precision not null,
  volume     bigint,
  primary key (ticker, date)
);

-- Process-once cache for raw documents and analysis outputs (used from Phase 2 on).
create table public.documents (
  cik               integer not null,
  doc_type          text not null,   -- e.g. 'transcript', '10-K', 'analysis:guidance'
  period            text not null,   -- e.g. 'FY2025Q1'
  analysis_version  text not null default 'raw',
  storage_path      text,            -- Supabase Storage path (compressed text)
  payload           jsonb,           -- small structured outputs
  source_url        text,
  sha256            text,
  fetched_at        timestamptz not null default now(),
  primary key (cik, doc_type, period, analysis_version)
);

-- AI spend ledger: every Claude call is logged here; the budget guard reads it.
create table public.ai_spend (
  id                   bigint generated always as identity primary key,
  created_at           timestamptz not null default now(),
  model                text not null,
  purpose              text not null,
  cik                  integer,
  input_tokens         integer not null default 0,
  output_tokens        integer not null default 0,
  cache_write_tokens   integer not null default 0,
  cache_read_tokens    integer not null default 0,
  batch                boolean not null default false,
  cost_usd             numeric(10,6) not null
);
create index ai_spend_month_idx on public.ai_spend (created_at);

-- Free-tier request counters per provider per day (US Eastern day).
create table public.api_usage (
  provider  text not null,
  day       date not null,
  requests  integer not null default 0,
  primary key (provider, day)
);

-- Background jobs (one per "analyze ticker" request or scheduled refresh).
create table public.jobs (
  id           bigint generated always as identity primary key,
  kind         text not null,                 -- 'analyze' | 'refresh' | 'tickers'
  ticker       text,
  cik          integer,
  status       text not null default 'queued' check (status in ('queued','running','done','failed','deferred')),
  steps        jsonb not null default '{}'::jsonb, -- per-step progress for the status page
  message      text,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
create index jobs_recent_idx on public.jobs (created_at desc);

create table public.login_attempts (
  id            bigint generated always as identity primary key,
  ip            text not null,
  attempted_at  timestamptz not null default now()
);
create index login_attempts_ip_idx on public.login_attempts (ip, attempted_at desc);

create table public.app_settings (
  key    text primary key,
  value  jsonb not null
);
insert into public.app_settings (key, value) values
  ('ai_budget', '{"monthly_cap_usd": 10, "warn_at_usd": 8}'),
  ('free_tier_limits', '{"alpha_vantage": 25, "tiingo": 1000}');

-- Month-to-date spend in US Eastern time.
create view public.ai_spend_mtd with (security_invoker = true) as
select coalesce(sum(cost_usd), 0)::numeric(10,4) as spent_usd
from public.ai_spend
where created_at >= date_trunc('month', now() at time zone 'America/New_York') at time zone 'America/New_York';

-- Atomically bump a provider's daily request counter and return the new count.
create function public.bump_api_usage(p_provider text, p_day date, p_n integer default 1)
returns integer language sql security invoker set search_path = '' as $$
  insert into public.api_usage (provider, day, requests) values (p_provider, p_day, p_n)
  on conflict (provider, day) do update set requests = public.api_usage.requests + excluded.requests
  returning requests;
$$;

-- Ticker autocomplete: exact/prefix ticker matches first, then name similarity.
create function public.search_tickers(q text, max_results integer default 8)
returns table (ticker text, cik integer, name text, exchange text)
language sql stable security invoker set search_path = '' as $$
  select t.ticker, t.cik, t.name, t.exchange
  from public.tickers t
  where t.ticker ilike (q || '%') or t.name ilike ('%' || q || '%')
  order by
    (upper(t.ticker) = upper(q)) desc,
    (t.ticker ilike (q || '%')) desc,
    extensions.similarity(t.name, q) desc,
    length(t.ticker)
  limit max_results;
$$;

alter table public.tickers            enable row level security;
alter table public.companies          enable row level security;
alter table public.filings            enable row level security;
alter table public.metric_values      enable row level security;
alter table public.unresolved_metrics enable row level security;
alter table public.prices             enable row level security;
alter table public.documents          enable row level security;
alter table public.ai_spend           enable row level security;
alter table public.api_usage          enable row level security;
alter table public.jobs               enable row level security;
alter table public.login_attempts     enable row level security;
alter table public.app_settings       enable row level security;

revoke all on function public.bump_api_usage(text, date, integer) from public, anon, authenticated;
revoke all on function public.search_tickers(text, integer) from public, anon, authenticated;
grant execute on function public.bump_api_usage(text, date, integer) to service_role;
grant execute on function public.search_tickers(text, integer) to service_role;
