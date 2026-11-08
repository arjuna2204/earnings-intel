alter table public.companies
  add column sector_note text,
  add column currency text not null default 'USD',
  add column valuation jsonb,
  add column exchange text;
