-- one-line summary of an 8-K (first sentence under its main Item), read in code by ei/events.py
alter table filings add column if not exists summary text;
