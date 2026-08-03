// scripts/sync-whoscored-teamids.js
//
// Populates teams.whoscoredteamid by scraping the WhoScored STANDINGS TABLE
// (not individual match pages) — the table lists every team's WS team ID
// directly via data-team-id on each <tr>, and is populated even before a
// ball is kicked, unlike matchCentreData.home/away.teamId which only shows
// up once a match has actually been played.
//
// Usage:
//   node scripts/sync-whoscored-teamids.js <leagueId> <seasonId> <tournamentUrl>
//
// Example:
//   node scripts/sync-whoscored-teamids.js 6 3 "https://www.whoscored.com/Regions/252/Tournaments/2/England-Premier-League"

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ??
  process.env.SUPABASE_URL;

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Same name-normalization logic as sync-whoscored-fixture-map.js ───────────
// (kept identical on purpose — already proven against real DB team names)
const COUNTRY_ALIASES = {
  turkiye: 'turkey',
  turkey: 'turkey',
  curacao: 'curacao',
  usa: 'unitedstates',
  unitedstates: 'unitedstates',
  caboverde: 'capeverde',
  capeverdeislands: 'capeverde',
  capeverde: 'capeverde',
  drcongo: 'congo',
  congodr: 'congo',
  congo: 'congo',
  bosniaandherzegovina: 'bosniaherzegovina',
  bosniaherzegovina: 'bosniaherzegovina',
};

function normalizeName(name) {
  if (!name) return '';
  const lower = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const depunctuated = lower.replace(/[^a-z0-9]/g, '').trim();

  if (COUNTRY_ALIASES[depunctuated]) return COUNTRY_ALIASES[depunctuated];

  const stripped = lower
    .replace(/\bfc\b|\baf\b|\bsc\b|\bac\b|\bcf\b|\butd\b|\bunited\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
  return COUNTRY_ALIASES[stripped] ?? stripped;
}

function namesMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// ── Step 1: Scrape the standings table for {wsTeamId, name} rows ─────────────
async function scrapeStandingsTable(page, tournamentUrl) {
  console.log(`Loading: ${tournamentUrl}`);
  await page.goto(tournamentUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(4000);

  let rows = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('tr[data-team-id]')];
    return trs.map((tr) => {
      const id = tr.getAttribute('data-team-id');
      const link = tr.querySelector('a.team-link');
      const name = link?.textContent?.trim() ?? null;
      return { wsTeamId: id, name };
    }).filter((r) => r.wsTeamId && r.name);
  });

  // Fallback: some tournament pages default to a "Fixtures" tab and only
  // render the standings table after clicking a "Table"/"Standings" tab.
  if (!rows.length) {
    console.log('No standings rows found on initial load — trying to click a Table/Standings tab...');
    const clicked = await page.evaluate(() => {
      const candidates = [...document.querySelectorAll('a, li, button')];
      const target = candidates.find((el) =>
        /^(table|standings)$/i.test(el.textContent?.trim() ?? '')
      );
      if (target) {
        target.click();
        return true;
      }
      return false;
    });

    if (clicked) {
      await page.waitForTimeout(4000);
      rows = await page.evaluate(() => {
        const trs = [...document.querySelectorAll('tr[data-team-id]')];
        return trs.map((tr) => {
          const id = tr.getAttribute('data-team-id');
          const link = tr.querySelector('a.team-link');
          const name = link?.textContent?.trim() ?? null;
          return { wsTeamId: id, name };
        }).filter((r) => r.wsTeamId && r.name);
      });
    }
  }

  console.log(`Found ${rows.length} team rows in standings table`);
  return rows;
}

// ── Step 2: Fetch DB teams for this league/season ─────────────────────────────
async function getDbTeams(leagueId, seasonId) {
  const { data, error } = await supabase
    .from('teams')
    .select('id, name, short_name, whoscoredteamid')
    .eq('league_id', leagueId)
    .eq('season_id', seasonId);

  if (error) throw new Error(`DB fetch failed: ${error.message}`);
  return data ?? [];
}

// ── Step 3: Match + write ──────────────────────────────────────────────────────
async function writeTeamId(dbTeamId, wsTeamId) {
  const { error } = await supabase
    .from('teams')
    .update({ whoscoredteamid: wsTeamId })
    .eq('id', dbTeamId);

  if (error) {
    console.error(`  [ERROR] writing whoscoredteamid for DB team ${dbTeamId}: ${error.message}`);
    return false;
  }
  return true;
}

async function main() {
  const leagueId = Number(process.argv[2]);
  const seasonId = Number(process.argv[3]);
  const tournamentUrl = process.argv[4];

  if (!leagueId || !seasonId || !tournamentUrl) {
    console.error('Usage: node scripts/sync-whoscored-teamids.js <leagueId> <seasonId> <tournamentUrl>');
    process.exit(1);
  }

  const dbTeams = await getDbTeams(leagueId, seasonId);
  if (!dbTeams.length) {
    console.log(`No teams found for league_id=${leagueId}, season_id=${seasonId}`);
    return;
  }
  console.log(`Found ${dbTeams.length} DB teams for league_id=${leagueId}, season_id=${seasonId}`);

  const context = await chromium.launchPersistentContext('.chrome-profile', {
    headless: false,
    channel: 'chrome',
    userAgent: USER_AGENT,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  let matched = 0;
  let noMatch = 0;

  try {
    const wsRows = await scrapeStandingsTable(page, tournamentUrl);

    if (!wsRows.length) {
      console.log('Could not find standings table on this page — nothing to do.');
      return;
    }

    const remaining = [...dbTeams];

    for (const { wsTeamId, name } of wsRows) {
      const dbMatch = remaining.find((t) => namesMatch(t.name, name) || namesMatch(t.short_name, name));

      if (!dbMatch) {
        console.log(`  [NO MATCH] WS "${name}" (id ${wsTeamId})`);
        noMatch++;
        continue;
      }

      const ok = await writeTeamId(dbMatch.id, wsTeamId);
      if (ok) {
        console.log(`  [OK] WS "${name}" (${wsTeamId}) → DB team ${dbMatch.id} "${dbMatch.name}"`);
        matched++;
        const idx = remaining.findIndex((t) => t.id === dbMatch.id);
        if (idx !== -1) remaining.splice(idx, 1);
      }
    }

    console.log(`\nDONE  matched: ${matched}  no-match: ${noMatch}`);
    if (remaining.length) {
      console.log(`${remaining.length} DB teams still unmatched:`);
      for (const t of remaining) console.log(`  DB ${t.id} | ${t.name}`);
    }
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});