-- Marks calls made through the Message Batches API (half price), so the saving can be measured.
alter table public.ai_spend add column if not exists batch boolean not null default false;
