-- Every US-listed operating company ranked by size (SEC public float), for load priority
create table if not exists universe (
  cik int primary key,
  ticker text not null,
  name text not null,
  public_float numeric not null,
  float_date date not null,
  rank int not null,
  updated_at timestamptz not null default now()
);
create index if not exists universe_rank on universe (rank);
alter table universe enable row level security;

-- quarters with no transcript at the provider, so the daily coverage run doesn't retry every day
create table if not exists transcript_misses (
  cik int not null,
  fiscal_year int not null,
  fiscal_quarter int not null,
  checked_at timestamptz not null default now(),
  primary key (cik, fiscal_year, fiscal_quarter)
);
alter table transcript_misses enable row level security;

-- price-based statistics and fundamental risk (computed daily in code)
create table if not exists risk_stats (
  cik int primary key references companies(cik) on delete cascade,
  as_of date not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table risk_stats enable row level security;

-- options: latest delayed chain summary, plus daily at-the-money IV for IV rank over time
create table if not exists options_snapshot (
  cik int primary key references companies(cik) on delete cascade,
  as_of timestamptz not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table options_snapshot enable row level security;
create table if not exists options_iv_history (
  cik int not null,
  date date not null,
  iv30 numeric,
  primary key (cik, date)
);
alter table options_iv_history enable row level security;

-- database size, so automatic loading stops before the free tier's 500 MB
create or replace function db_size_bytes() returns bigint language sql security definer set search_path = public as $$
  select pg_database_size(current_database())
$$;
revoke all on function db_size_bytes() from public, anon, authenticated;
grant execute on function db_size_bytes() to service_role;

-- previous report date, kept when the calendar moves on to the next quarter (coverage uses it)
alter table earnings_calendar add column if not exists last_report_date date;
