alter table public.companies
  add column predecessor_ciks integer[] not null default '{}',
  add column history_note text;
