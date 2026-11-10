-- Pay vs performance from the latest DEF 14A, and 5%+ holders from Schedules 13D/13G (ei/proxy.py)
create table if not exists exec_pay (
  cik        integer primary key references companies(cik) on delete cascade,
  accession  text not null,
  filed_date date,
  result     jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists big_holders (
  accession  text primary key,
  cik        integer not null references companies(cik) on delete cascade,
  form       text not null,
  filed_date date not null,
  holder     text not null,
  pct        double precision,
  shares     double precision,
  activist   boolean not null default false,
  url        text
);
create index if not exists big_holders_cik on big_holders(cik, filed_date desc);
alter table exec_pay enable row level security;
alter table big_holders enable row level security;
