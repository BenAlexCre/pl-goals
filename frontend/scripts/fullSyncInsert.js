// scripts/fullSyncInsert.js
// Fetches competition data from football-data.org and upserts into local/cloud Supabase
// Defaults to World Cup 2026 but supports any football-data competition via env vars.

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const BASE_URL = 'https://api.football-data.org/v4';

const FOOTBALL_DATA_KEY =
  process.env.FOOTBALL_DATA_KEY ??
  process.env.VITE_FOOTBALL_DATA_KEY ??
  '';

const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  '';

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  '';

const COMPETITION_CODE =
  process.env.FOOTBALL_COMPETITION_CODE ??
  'WC';

const SEASON_YEAR =
  Number(process.env.FOOTBALL_SEASON ?? '2026');

if (!FOOTBALL_DATA_KEY) throw new Error('Missing FOOTBALL_DATA_KEY or VITE_FOOTBALL_DATA_KEY');
if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL or VITE_SUPABASE_URL');
if (!SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

function logConfig() {
  console.log(JSON.stringify({
    supabase_url: SUPABASE_URL,
    competition_code: COMPETITION_CODE,
    season_year: SEASON_YEAR,
    using_local_supabase: SUPABASE_URL.includes('127.0.0.1') || SUPABASE_URL.includes('localhost'),
  }, null, 2));
}

async function apiFetch(path, params = {}) {
  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url, {
    headers: { 'X-Auth-Token': FOOTBALL_DATA_KEY },
  });

  if (!res.ok) {
    throw new Error(`football-data ${path} -> ${res.status} ${await res.text()}`);
  }

  return res.json();
}

async function sb(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: prefer ?? 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`supabase ${method} ${path} -> ${res.status} ${text}`);
  }

  return text ? JSON.parse(text) : null;
}

// Phase 19 — real, previously-undiscovered bug: `TIMED` and `SCHEDULED`
// were both collapsed into our own `'scheduled'`, discarding the exact
// distinction football-data.org's API uses to mean "kickoff time
// confirmed" (TIMED, a real hour/minute) vs "date known, exact time not
// yet set by broadcasters" (SCHEDULED — sent with `utcDate` at a literal
// `00:00:00Z` placeholder, confirmed live against the real API). The
// schema already has a status for exactly this — `'tbd'`, already read
// by Dashboard.jsx/useMatchCentre.js, just never populated by either
// ingestion path. Mapped correctly here instead of inventing a new
// column.
function fixtureStatus(s) {
  if (s === 'TIMED') return 'scheduled';
  if (s === 'SCHEDULED') return 'tbd';
  if (['IN_PLAY', 'PAUSED'].includes(s)) return 'live';
  if (s === 'FINISHED') return 'finished';
  if (s === 'POSTPONED') return 'postponed';
  if (['CANCELLED', 'AWARDED'].includes(s)) return 'cancelled';
  return 'tbd';
}

function gameweekStatus(matchStatus, kickoff) {
  if (['IN_PLAY', 'PAUSED'].includes(matchStatus)) return 'live';
  if (matchStatus === 'FINISHED') return 'completed';
  if (matchStatus === 'POSTPONED') return 'postponed';
  if (new Date(kickoff) > new Date()) return 'upcoming';
  return 'completed';
}

function gwNumber(match) {
  if (match.matchday) return match.matchday;

  const stageMap = {
    GROUP_STAGE: 1,
    LAST_32: 33,
    LAST_16: 34,
    QUARTER_FINALS: 35,
    SEMI_FINALS: 36,
    THIRD_PLACE: 37,
    FINAL: 38,
  };

  return stageMap[match.stage] ?? 99;
}

function gwName(match, number) {
  if (match.stage === 'REGULAR_SEASON') return `Gameweek ${number}`;
  if (match.stage) return match.stage.replaceAll('_', ' ');
  return `Matchday ${number}`;
}

// Phase 19 — real, previously-undiscovered bug: this script wrote
// `deadline_utc = kickoff` (zero offset at all), not the intended
// "15 minutes before the gameweek's earliest kickoff" business rule —
// found while auditing every writer of this column, not from a live
// symptom. Harmless in practice only because `refresh_gameweek_deadlines()`
// (migration 029) recomputes it correctly the moment this script's own
// `upsertFixtures()` commits a write to `fixtures` — but this script's
// own initial value should never be wrong even momentarily, and should
// remain correct standalone if that trigger is ever unavailable.
function minusFifteenMinutes(isoString) {
  return new Date(new Date(isoString).getTime() - 15 * 60 * 1000).toISOString();
}

async function insertSyncRun() {
  const rows = await sb('/sync_runs', {
    method: 'POST',
    body: [{
      job_name: `football-data-${COMPETITION_CODE}-${SEASON_YEAR}`,
      status: 'running',
      triggered_by: 'manual',
      records_processed: 0,
    }],
  });

  return rows[0];
}

async function finishSyncRun(id, status, recordsProcessed, errors = null) {
  await sb(`/sync_runs?id=eq.${id}`, {
    method: 'PATCH',
    body: {
      status,
      finished_at: new Date().toISOString(),
      records_processed: recordsProcessed,
      errors,
    },
    prefer: 'return=minimal',
  });
}

async function upsertSeason() {
  const existingExact = await sb(
    `/seasons?year_start=eq.${SEASON_YEAR}&year_end=eq.${SEASON_YEAR}&select=*`
  );

  if (existingExact?.length) return existingExact[0];

  const rows = await sb('/seasons', {
    method: 'POST',
    body: [{
      name: String(SEASON_YEAR),
      year_start: SEASON_YEAR,
      year_end: SEASON_YEAR,
      is_current: false,
    }],
  });

  return rows[0];
}

async function upsertLeague(seasonId, competition) {
  const rows = await sb('/leagues?on_conflict=provider_id,provider_name,season_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: [{
      name: competition.name,
      country: competition.area?.name ?? 'World',
      provider_id: competition.code,
      provider_name: 'football-data',
      season_id: seasonId,
      is_active: true,
    }],
  });

  return rows[0];
}

async function upsertTeams(teams, seasonId, leagueId) {
  if (!teams.length) return [];

  const body = teams.map((t) => ({
    name: t.name,
    short_name: t.shortName || t.tla || t.name,
    crest_url: t.crest ?? null,
    provider_id: String(t.id),
    provider_name: 'football-data',
    season_id: seasonId,
    league_id: leagueId,
  }));

  return sb('/teams?on_conflict=provider_id,provider_name,season_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body,
  });
}

async function upsertGameweeks(matches, seasonId, leagueId) {
  const byNumber = new Map();

  for (const m of matches) {
    const number = gwNumber(m);
    const kickoff = m.utcDate;
    const status = gameweekStatus(m.status, kickoff);
    const record = byNumber.get(number);

    if (!record) {
      byNumber.set(number, {
        season_id: seasonId,
        league_id: leagueId,
        number,
        name: gwName(m, number),
        status,
        deadline_utc: minusFifteenMinutes(kickoff),
        earliest_kickoff_utc: kickoff,
        is_current: false,
        provider_id: `${COMPETITION_CODE}-${number}`,
      });
    } else {
      if (new Date(kickoff) < new Date(record.earliest_kickoff_utc)) {
        record.earliest_kickoff_utc = kickoff;
        record.deadline_utc = minusFifteenMinutes(kickoff);
      }
      if (status === 'live') record.status = 'live';
      else if (status === 'upcoming' && record.status !== 'live') record.status = 'upcoming';
    }
  }

  const body = [...byNumber.values()];
  if (!body.length) return [];

  return sb('/gameweeks?on_conflict=season_id,league_id,number', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body,
  });
}

async function upsertFixtures(matches, teamRows, gameweekRows) {
  const teamMap = new Map(teamRows.map((t) => [`football-data:${t.provider_id}`, t.id]));
  const gwMap = new Map(gameweekRows.map((g) => [g.number, g.id]));

  const body = matches.map((m) => ({
    gameweek_id: gwMap.get(gwNumber(m)) ?? null,
    home_team_id: m.homeTeam?.id ? (teamMap.get(`football-data:${m.homeTeam.id}`) ?? null) : null,
    away_team_id: m.awayTeam?.id ? (teamMap.get(`football-data:${m.awayTeam.id}`) ?? null) : null,
    kickoff_utc: m.utcDate,
    status: fixtureStatus(m.status),
    minute: m.minute ?? null,
    home_goals: m.score?.fullTime?.home ?? 0,
    away_goals: m.score?.fullTime?.away ?? 0,
    provider_id: String(m.id),
    provider_name: 'football-data',
    provider_raw: m,
    last_synced_at: new Date().toISOString(),
  }));

  if (!body.length) return [];

  return sb('/fixtures?on_conflict=provider_id,provider_name', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body,
  });
}

async function countRows(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id`, {
    method: 'HEAD',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Prefer: 'count=exact',
    },
  });

  if (!res.ok) {
    throw new Error(`count ${table} -> ${res.status}`);
  }

  const contentRange = res.headers.get('content-range') ?? '0-0/0';
  const total = Number(contentRange.split('/')[1] ?? '0');
  return total;
}

async function main() {
  logConfig();

  const syncRun = await insertSyncRun();
  let processed = 0;

  try {
    const [competition, teamsRes, matchesRes] = await Promise.all([
      apiFetch(`/competitions/${COMPETITION_CODE}`),
      apiFetch(`/competitions/${COMPETITION_CODE}/teams`, { season: SEASON_YEAR }),
      apiFetch(`/competitions/${COMPETITION_CODE}/matches`, { season: SEASON_YEAR }),
    ]);

    const teams = teamsRes.teams ?? [];
    const matches = matchesRes.matches ?? [];

    console.log(`football-data teams fetched: ${teams.length}`);
    console.log(`football-data matches fetched: ${matches.length}`);

    const season = await upsertSeason();
    const league = await upsertLeague(season.id, competition);
    const teamRows = await upsertTeams(teams, season.id, league.id);
    const gameweekRows = await upsertGameweeks(matches, season.id, league.id);
    const fixtureRows = await upsertFixtures(matches, teamRows, gameweekRows);

    processed = (teamRows?.length ?? 0) + (gameweekRows?.length ?? 0) + (fixtureRows?.length ?? 0);

    await finishSyncRun(syncRun.id, 'success', processed, null);

    const [seasonCount, leagueCount, teamCount, gameweekCount, fixtureCount] = await Promise.all([
      countRows('seasons'),
      countRows('leagues'),
      countRows('teams'),
      countRows('gameweeks'),
      countRows('fixtures'),
    ]);

    console.log(JSON.stringify({
      ok: true,
      competition: COMPETITION_CODE,
      season: SEASON_YEAR,
      season_id: season.id,
      league_id: league.id,
      teams_upserted: teamRows?.length ?? 0,
      gameweeks_upserted: gameweekRows?.length ?? 0,
      fixtures_upserted: fixtureRows?.length ?? 0,
      db_counts: {
        seasons: seasonCount,
        leagues: leagueCount,
        teams: teamCount,
        gameweeks: gameweekCount,
        fixtures: fixtureCount,
      },
    }, null, 2));
  } catch (err) {
    await finishSyncRun(syncRun.id, 'failed', processed, { message: err.message });
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});