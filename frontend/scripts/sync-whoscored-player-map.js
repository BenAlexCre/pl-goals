// scripts/sync-whoscored-squads.js
//
// Usage:
//   node scripts/sync-whoscored-squads.js <leagueId> <seasonId>
//
// Example (World Cup league/season IDs):
//   node scripts/sync-whoscored-squads.js 1 1

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  process.env.SUPABASEURL;

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SERVICEROLEKEY ??
  process.env.SUPABASESERVICEKEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing Supabase env vars for sync-whoscored-squads');
  console.error(
    'Keys found:',
    Object.keys(process.env).filter((k) => k.toLowerCase().includes('supabase'))
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Name normalization (same technique as sync-whoscored-fixture-map.js
// and sync-whoscored-teamids.js — football-data.org and WhoScored frequently
// disagree on nicknames, accents, and full-vs-short names, so an exact match
// silently misses a large fraction of real players) ----------

function normalizeName(name) {
  if (!name) return '';
  const lower = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // strip accents: "Sávio" -> "savio"
  return lower.replace(/[^a-z0-9]/g, '').trim();
}

function namesMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// ---------- DB helpers ----------

// Fetch all teams in given league/season that have a whoscoredteamid
async function getTeamsWithWsId(leagueId, seasonId) {
  const { data, error } = await supabase
    .from('teams')
    .select('id, name, whoscoredteamid')
    .eq('league_id', leagueId)
    .eq('season_id', seasonId)
    .not('whoscoredteamid', 'is', null);

  if (error) {
    throw new Error(`Error fetching teams: ${error.message}`);
  }

  return data ?? [];
}

// Fetch this team's active roster (football-data-sourced players only) once
// per team, so name matching can be scoped to a small, correct candidate
// set instead of searching all ~500+ players in the DB — this avoids false
// positives on common surnames shared across different teams.
async function getActiveRosterForTeam(dbTeamId) {
  const { data: historyRows, error: histErr } = await supabase
    .from('player_team_history')
    .select('player_id')
    .eq('team_id', dbTeamId)
    .eq('is_active', true);

  if (histErr) {
    console.error('Error fetching player_team_history for team', dbTeamId, histErr.message);
    return [];
  }

  const playerIds = (historyRows ?? []).map((r) => r.player_id);
  if (!playerIds.length) return [];

  const { data: players, error: playersErr } = await supabase
    .from('players')
    .select('id, display_name, provider_name')
    .eq('provider_name', 'football-data')
    .in('id', playerIds);

  if (playersErr) {
    console.error('Error fetching players for team', dbTeamId, playersErr.message);
    return [];
  }

  return players ?? [];
}

// Try to find an existing player row by:
// 1) whoscoredplayerid (global — safe, since it's already a confirmed WS ID
//    from a prior run; useful for idempotent re-runs)
// 2) fuzzy/normalized name match, scoped to this team's active roster
async function findExistingPlayer({ wsPlayerId, name, roster }) {
  const wsId = String(wsPlayerId);

  // 1) Direct whoscoredplayerid match
  {
    const { data, error } = await supabase
      .from('players')
      .select('id, whoscoredplayerid')
      .eq('whoscoredplayerid', wsId)
      .maybeSingle();

    if (error) {
      console.error('Error querying players by whoscoredplayerid', wsId, error.message);
    }

    if (data?.id) {
      return data.id;
    }
  }

  // 2) Fallback: fuzzy name match against this team's roster only
  if (!name || !roster?.length) return null;

  const matches = roster.filter((p) => namesMatch(p.display_name, name));

  if (matches.length === 1) {
    return matches[0].id;
  }

  if (matches.length > 1) {
    console.warn(
      `  [AMBIGUOUS] "${name}" matched ${matches.length} roster candidates — skipping to avoid a bad link:`,
      matches.map((m) => m.display_name).join(', ')
    );
  }

  // Zero or ambiguous matches: skip to avoid bad links
  return null;
}

// ---------- Scrape one team squad page ----------

async function scrapeTeamSquad(page, wsTeamId) {
  // e.g. https://www.whoscored.com/teams/341/show/international-france
  const url = `https://www.whoscored.com/teams/${wsTeamId}/show`;

  console.log('Visiting squad page:', url);

  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await sleep(1500);

  // Extract all player links from the squad table
  const players = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll('a.player-link')];
    const out = [];

    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      // Pattern: /players/353423/show/aurélien-tchouaméni
      const match = href.match(/\/players\/(\d+)\/show/i);
      if (!match) continue;

      const wsPlayerId = match[1];

      const nameText = a.textContent || '';
      const nameTrimmed = nameText.replace(/\s+/g, ' ').trim();
      if (!nameTrimmed) continue;

      out.push({
        wsPlayerId,
        name: nameTrimmed,
      });
    }

    return out;
  });

  console.log(`Found ${players.length} players on squad page for WS team ${wsTeamId}`);

  return players;
}

// ---------- Link players for a single team (no inserts) ----------

async function syncTeamSquad(page, team) {
  const wsTeamId = team.whoscoredteamid;
  if (!wsTeamId) {
    console.log(`Team ${team.id} (${team.name}) has no whoscoredteamid; skipping`);
    return;
  }

  const players = await scrapeTeamSquad(page, wsTeamId);
  const roster = await getActiveRosterForTeam(team.id);
  console.log(`  DB roster for this team (football-data, active): ${roster.length} players`);

  for (const p of players) {
    const wsId = p.wsPlayerId;
    const name = p.name?.trim();
    if (!name) {
      console.warn('Skipping player with no name, wsId', wsId);
      continue;
    }

    const existingId = await findExistingPlayer({
      wsPlayerId: wsId,
      name,
      roster,
    });

    if (existingId) {
      const { error: updateErr } = await supabase
        .from('players')
        .update({ whoscoredplayerid: wsId })
        .eq('id', existingId)
        .is('whoscoredplayerid', null);

      if (updateErr) {
        console.error(
          'Error updating whoscoredplayerid for player',
          existingId,
          wsId,
          updateErr.message
        );
      } else {
        console.log(
          'LINKED',
          'teamId', team.id,
          'teamName', team.name,
          'wsPlayerId', wsId,
          'wsName', name,
          'dbPlayerId', existingId
        );
      }

      continue;
    }

    // No existing player found: log UNMAPPED
    console.log(
      'UNMAPPED',
      'teamId', team.id,
      'teamName', team.name,
      'wsPlayerId', wsId,
      'wsName', name
    );
  } // close: for (const p of players)
} // close: async function syncTeamSquad

// ---------- main ----------

async function main(leagueId, seasonId) {
  const teams = await getTeamsWithWsId(leagueId, seasonId);

  if (!teams.length) {
    console.log('No teams with whoscoredteamid for this league/season; nothing to do.');
    return;
  }

  console.log(`Found ${teams.length} teams with whoscoredteamid for league ${leagueId}, season ${seasonId}`);

  const context = await chromium.launchPersistentContext('.chrome-profile', {
    headless: false,
    channel: 'chrome',
    userAgent: USER_AGENT,
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = await context.newPage();

  try {
    for (const team of teams) {
      console.log('\n=============================');
      console.log(`Team ${team.id} | ${team.name} | WS team ${team.whoscoredteamid}`);
      console.log('=============================');

      try {
        await syncTeamSquad(page, team);
      } catch (err) {
        console.error(
          `Error syncing squad for team ${team.id} (${team.name}):`,
          err.message
        );
      }

      await sleep(2000); // polite delay
    }
  } finally {
    await context.close();
  }

  console.log('\nDone syncing squads for all teams with whoscoredteamid');
}

const leagueIdArg = process.argv[2];
const seasonIdArg = process.argv[3];

if (!leagueIdArg || !seasonIdArg) {
  console.error('Usage: node scripts/sync-whoscored-squads.js <leagueId> <seasonId>');
  process.exit(1);
}

const leagueId = Number(leagueIdArg);
const seasonId = Number(seasonIdArg);

if (Number.isNaN(leagueId) || Number.isNaN(seasonId)) {
  console.error('leagueId and seasonId must be numbers');
  process.exit(1);
}

main(leagueId, seasonId).catch((err) => {
  console.error('Fatal error in sync-whoscored-squads', err);
  process.exit(1);
});