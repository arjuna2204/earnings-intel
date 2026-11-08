-- Phase 4: peer sets (auto-picked or edited) and computed peer comparisons.
create table public.peer_sets (
  cik         integer primary key references public.companies (cik) on delete cascade,
  peers       jsonb not null,          -- [{cik, ticker, name, source, reason}]
  candidates  jsonb,                   -- next-best suggestions shown in the editor
  edited      boolean not null default false,
  updated_at  timestamptz not null default now()
);

create table public.peer_comparisons (
  cik         integer primary key references public.companies (cik) on delete cascade,
  version     text not null,
  peer_ciks   integer[] not null,
  result      jsonb not null,          -- {columns, rows, ranks, medians, facts}
  claims      jsonb,                   -- verified summary sentences
  dropped     jsonb,
  cost_usd    numeric(12,6) not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.peer_sets        enable row level security;
alter table public.peer_comparisons enable row level security;
