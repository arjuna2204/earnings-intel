-- Phase 5: "Your take" — the user's own verdict on a quarter, shown back next quarter.
create table public.takes (
  id          bigint generated always as identity primary key,
  cik         integer not null references public.companies (cik) on delete cascade,
  period_a    text not null,
  period_b    text not null,
  verdict     text not null check (verdict in ('better','same','worse')),
  note        text check (char_length(note) <= 600),
  created_at  timestamptz not null default now(),
  unique (cik, period_a, period_b)
);
alter table public.takes enable row level security;
