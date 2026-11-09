-- Current revenue growth by sector (median of listed companies with $1B+ revenue), refreshed monthly from SEC data.
create table public.sector_growth (
  etf        text primary key,      -- SPDR sector ETF the app uses as the sector label (XLK = technology, ...)
  as_of      date not null,
  year       integer not null,      -- calendar year measured (vs. the year before)
  median     double precision,
  p25        double precision,
  p75        double precision,
  n          integer not null,
  method     text not null
);
alter table public.sector_growth enable row level security;
