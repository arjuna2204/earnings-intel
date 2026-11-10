-- Customers, suppliers and concentration from the latest 10-K (ei/supply.py), quotes verified in code
create table if not exists supply_chain (
  cik        integer primary key references companies(cik) on delete cascade,
  accession  text not null,
  filed_date date,
  version    text not null,
  result     jsonb not null,
  created_at timestamptz not null default now()
);
alter table supply_chain enable row level security;
