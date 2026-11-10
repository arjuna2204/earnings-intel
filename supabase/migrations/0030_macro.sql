-- FRED macro series (ei/macro.py)
create table if not exists macro_series (
  series text not null,
  date   date not null,
  value  double precision not null,
  primary key (series, date)
);
alter table macro_series enable row level security;
