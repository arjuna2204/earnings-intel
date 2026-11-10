-- Debt maturity ladder, average rate and credit lines from the latest 10-K (ei/debt.py)
create table if not exists debt_profile (
  cik        integer primary key references companies(cik) on delete cascade,
  as_of      date,
  result     jsonb not null,
  created_at timestamptz not null default now()
);
alter table debt_profile enable row level security;
