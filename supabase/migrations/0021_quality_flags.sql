-- Results of the daily data-quality checks (ei/quality.py); rebuilt from scratch each run
create table if not exists quality_flags (
  cik        integer not null references companies(cik) on delete cascade,
  "check"    text not null,
  severity   text not null check (severity in ('hide','warn')),
  fields     text[] not null default '{}',
  message    text not null,
  detail     jsonb,
  created_at timestamptz not null default now(),
  primary key (cik, "check")
);
alter table quality_flags enable row level security;
