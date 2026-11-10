-- Basic data for the largest companies not yet researched in full (ei/lite.py): screener coverage
create table if not exists lite_companies (
  cik              integer primary key,
  ticker           text not null,
  name             text not null,
  rank             integer,
  snapshot         jsonb not null default '{}',
  history          jsonb not null default '[]',   -- [[date, close], ...] last ~400 days
  fundamentals_at  timestamptz,
  updated_at       timestamptz not null default now()
);
alter table lite_companies enable row level security;
