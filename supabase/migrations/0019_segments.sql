-- Revenue and operating income by business segment, product line and region (from each filing's XBRL)
create table if not exists segment_values (
  cik           integer not null references companies(cik) on delete cascade,
  axis          text not null check (axis in ('segment','product','region')),
  measure       text not null check (measure in ('revenue','operating_income')),
  member        text not null,
  label         text not null,
  fiscal_year   integer not null,
  fiscal_period text not null check (fiscal_period in ('FY','Q1','Q2','Q3','Q4')),
  period_start  date,
  period_end    date not null,
  value         double precision not null,
  source        text not null default 'reported',
  accession     text,
  updated_at    timestamptz not null default now(),
  primary key (cik, axis, measure, member, fiscal_year, fiscal_period)
);
alter table segment_values enable row level security;
