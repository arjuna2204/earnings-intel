alter table public.prices add column split_factor double precision not null default 1;
truncate table public.prices; -- reload once so every row carries its split factor
