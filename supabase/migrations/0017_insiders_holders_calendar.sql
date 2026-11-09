-- Insider trades from SEC Form 4 (one row per non-derivative transaction line)
create table if not exists insider_trades (
  accession text not null,
  seq int not null,
  cik int not null references companies(cik) on delete cascade,
  filed_date date not null,
  trade_date date,
  owner text not null,
  role text,
  code text not null,          -- P open-market buy, S open-market sale, A award, M option exercise, F tax withholding, G gift ...
  acquired boolean,
  shares numeric,
  price numeric,
  value numeric,
  owned_after numeric,
  direct boolean,
  plan_10b5_1 boolean not null default false,
  url text not null,
  primary key (accession, seq)
);
create index if not exists insider_trades_cik_date on insider_trades (cik, trade_date desc);
alter table insider_trades enable row level security;

-- Form 4s already read (including ones with no transactions), so daily runs only fetch new filings
create table if not exists insider_filings_seen (
  accession text primary key,
  cik int not null,
  seen_at timestamptz not null default now()
);
alter table insider_filings_seen enable row level security;

-- Institutional holders from SEC 13F data sets, latest quarter vs prior quarter
create table if not exists institutional_holders (
  cik int primary key references companies(cik) on delete cascade,
  period date not null,
  prior_period date,
  result jsonb not null,
  source text not null,
  created_at timestamptz not null default now()
);
alter table institutional_holders enable row level security;

-- Upcoming earnings dates (Alpha Vantage EARNINGS_CALENDAR, all US tickers, refreshed daily)
create table if not exists earnings_calendar (
  ticker text primary key,
  report_date date not null,
  fiscal_date_ending date,
  eps_estimate numeric,
  updated_at timestamptz not null default now()
);
alter table earnings_calendar enable row level security;
