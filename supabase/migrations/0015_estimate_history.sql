-- Weekly snapshots of consensus estimates, so the app can show estimate revisions over time.
create table public.eps_estimate_history (
  cik           integer not null references public.companies (cik) on delete cascade,
  snapshot_date date not null,
  horizon       text not null,
  period_end    date not null,
  eps_avg       double precision,
  eps_low       double precision,
  eps_high      double precision,
  revenue_avg   double precision,
  analysts      integer,
  primary key (cik, snapshot_date, horizon, period_end)
);
alter table public.eps_estimate_history enable row level security;
-- seed with the estimates already stored
insert into public.eps_estimate_history (cik, snapshot_date, horizon, period_end, eps_avg, eps_low, eps_high, revenue_avg, analysts)
select cik, fetched_at::date, horizon, period_end, eps_avg, eps_low, eps_high, revenue_avg, analysts from public.eps_estimates
where period_end >= current_date - 30
on conflict do nothing;
