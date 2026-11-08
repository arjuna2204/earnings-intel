create table public.eps_estimates (
  cik            integer not null references public.companies (cik) on delete cascade,
  period_end     date not null,
  horizon        text not null check (horizon in ('fiscal quarter','fiscal year')),
  eps_avg        double precision,
  eps_high       double precision,
  eps_low        double precision,
  analysts       integer,
  revenue_avg    double precision,
  fetched_at     timestamptz not null default now(),
  primary key (cik, period_end, horizon)
);
alter table public.eps_estimates enable row level security;
