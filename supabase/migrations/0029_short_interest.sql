-- FINRA consolidated short interest, twice a month (ei/short_interest.py)
create table if not exists short_interest (
  ticker           text not null,
  settlement_date  date not null,
  short_shares     double precision not null,
  avg_daily_volume double precision,
  days_to_cover    double precision,
  primary key (ticker, settlement_date)
);
alter table short_interest enable row level security;
