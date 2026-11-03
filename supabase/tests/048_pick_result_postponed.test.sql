-- Migration 048 — 'postponed' pick result (owner decision 2026-11-03). Rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(2);
select ok(exists (select 1 from pg_enum where enumtypid = 'public.pick_result'::regtype and enumlabel = 'postponed'),
  'pick_result has the postponed value');
select ok((select array_agg(enumlabel order by enumsortorder) from pg_enum where enumtypid = 'public.pick_result'::regtype)
  @> array['pending','winning','losing','won','lost','void']::name[], 'every pre-existing pick_result value is still present');
select * from finish();
rollback;
