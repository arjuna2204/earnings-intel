alter table public.jobs add column params jsonb not null default '{}'::jsonb;
