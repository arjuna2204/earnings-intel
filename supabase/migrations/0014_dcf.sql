-- DCF per company: SEC history, default assumptions (each with its source), and the computed result.
create table public.dcf_models (
  cik        integer primary key references public.companies (cik) on delete cascade,
  version    text not null,
  status     text not null,      -- ok | not_applicable | insufficient
  note       text,
  history    jsonb,              -- fiscal-year SEC figures used
  assumptions jsonb,             -- {key: {value, label, source}}
  result     jsonb,              -- forecast rows, EV, equity, per-share value, sensitivity grid
  created_at timestamptz not null default now()
);
alter table public.dcf_models enable row level security;
