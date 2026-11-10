-- Post-earnings recaps (ei/recap.py): expectations saved before the report, results after
create table if not exists earnings_recaps (
  ticker          text not null,
  report_date     date not null,
  cik             integer,
  name            text,
  researched      boolean not null default false,
  quarter         text,
  eps_estimate    double precision,
  eps_actual      double precision,
  eps_surprise    double precision,
  expected_move   double precision,   -- options-implied earnings-day move, saved before the report
  move            double precision,   -- close before report date -> close of first session after it
  move_from       date,
  move_to         date,
  revenue         double precision,
  revenue_growth  double precision,
  guidance        jsonb,              -- {raised, lowered, maintained}
  final           boolean not null default false,
  computed_at     timestamptz,
  primary key (ticker, report_date)
);
alter table earnings_recaps enable row level security;
