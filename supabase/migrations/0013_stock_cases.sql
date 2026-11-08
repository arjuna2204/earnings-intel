-- Bull / base / bear cases per stock: scenario values computed in code, reasoning written by AI from verified facts.
create table public.stock_cases (
  cik        integer primary key references public.companies (cik) on delete cascade,
  version    text not null,
  period_a   text,
  period_b   text,
  numbers    jsonb not null,   -- price, EPS range, P/E percentiles, scenario values
  facts      jsonb not null,   -- facts the cases may cite (V = valuation math, plus brief and peer facts)
  claims     jsonb not null,   -- verified sentences, section = bull | base | bear | watch
  dropped    jsonb,
  cost_usd   numeric(12,6) not null default 0,
  created_at timestamptz not null default now()
);
alter table public.stock_cases enable row level security;
