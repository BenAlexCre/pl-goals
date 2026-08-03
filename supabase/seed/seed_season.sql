insert into public.seasons (name, year_start, year_end, is_current)
values ('2026/27', 2026, 2027, true)
on conflict (year_start, year_end) do update set is_current = excluded.is_current;

update public.seasons
set is_current = false
where year_start <> 2026 and year_end <> 2027;

insert into public.leagues (name, country, provider_id, provider_name, season_id, is_active)
select 'Premier League', 'England', '39', 'api-football', s.id, true
from public.seasons s
where s.year_start = 2026 and s.year_end = 2027
on conflict (provider_id, provider_name, season_id) do nothing;