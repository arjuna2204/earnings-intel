
-- whether a year's lines add up to total revenue (false: some revenue not broken out)
alter table segment_values add column if not exists adds_up boolean;
