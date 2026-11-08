-- Phase 6: backtest — one row per (signal, event) with abnormal returns after it, and run summaries.
create table public.backtest_events (
  id          text primary key,              -- "<signal>:<cik>:<date>"
  signal      text not null,
  cik         integer not null,
  ticker      text not null,
  event_date  date not null,
  label       text,                          -- e.g. FY2026Q4 or 10-K 2025
  value       double precision not null,     -- the signal's value at the event
  reaction    double precision,              -- stock minus sector ETF, reaction day
  drift20     double precision,              -- stock minus sector ETF, next 20 trading days after reaction
  drift60     double precision,              -- same, next 60 trading days
  benchmark   text,
  updated_at  timestamptz not null default now()
);
create index backtest_events_signal_idx on public.backtest_events (signal);
create table public.backtest_results (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  summary     jsonb not null,
  coverage    jsonb not null
);
alter table public.backtest_events  enable row level security;
alter table public.backtest_results enable row level security;
