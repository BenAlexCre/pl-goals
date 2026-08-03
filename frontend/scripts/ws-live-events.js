import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SUPABASE_URL    = process.env.VITE_SUPABASE_URL    ?? process.env.SUPABASE_URL;
const SERVICE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL_MS = 60 * 1000; // 3 minutes
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay(min = 1500, max = 3500) {
  return sleep(Math.floor(Math.random() * (max - min) + min));
}

// Map WhoScored incident type/satisfier → eventtype text value
function mapEventType(type, satisfier) {
  if (type === 'Goal') {
    if (satisfier === 'goalOwn')       return 'GOAL';
    if (satisfier === 'penaltyScored') return 'GOAL';
    return 'GOAL';
  }
  if (type === 'Card') {
    if (satisfier === 'yellowCard')  return 'YELLOW_CARD';
    if (satisfier === 'secondYellow') return 'SECOND_YELLOW_CARD';
    if (satisfier === 'redCard')     return 'RED_CARD';
  }
  if (type === 'SubstitutionOn')  return 'SUB_ON';
  if (type === 'SubstitutionOff') return 'SUB_OFF';
  return type.toUpperCase();
}

// ─── Step 1: Fetch live/in-progress fixtures that have a whoscored_fixture_id ──

async function getLiveFixtures() {
  const now = new Date();
  // Fixtures that kicked off within the last 130 mins (covers 90 + ET + HT)
  // or up to 10 mins in the future (allow early start of polling)
  const windowStart = new Date(now.getTime() - 130 * 60 * 1000);
  const windowEnd   = new Date(now.getTime() +  10 * 60 * 1000);

  const { data, error } = await supabase
    .from('fixtures')
    .select('id, whoscored_fixture_id, home_team_id, away_team_id, kickoff_utc, status')
    .not('whoscored_fixture_id', 'is', null)
    .gte('kickoff_utc', windowStart.toISOString())
    .lte('kickoff_utc', windowEnd.toISOString());

  if (error) throw new Error(`getLiveFixtures DB error: ${error.message}`);
  return data ?? [];
}

// ─── Step 2: Build lookup maps from whoscored IDs → DB bigint IDs ─────────────

async function buildPlayerMap() {
  const { data, error } = await supabase
    .from('players')
    .select('id, whoscoredplayerid')
    .not('whoscoredplayerid', 'is', null);
  if (error) throw new Error(`buildPlayerMap error: ${error.message}`);
  const map = new Map();
  for (const p of data ?? []) map.set(String(p.whoscoredplayerid), p.id);
  return map;
}

async function buildTeamMap() {
  const { data, error } = await supabase
    .from('teams')
    .select('id, whoscoredteamid')
    .not('whoscoredteamid', 'is', null);
  if (error) throw new Error(`buildTeamMap error: ${error.message}`);
  const map = new Map();
  for (const t of data ?? []) map.set(String(t.whoscoredteamid), t.id);
  return map;
}

// ─── Step 3: Scrape matchCentreData from a WhoScored Live match page ──────────

async function scrapeMatchCentreData(page, wsFixtureId) {
  const url = `https://www.whoscored.com/Matches/${wsFixtureId}/Live`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await randomDelay(1500, 3000);

  const rawJson = await page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script:not([src])')];
    for (const s of scripts) {
      const text = s.textContent;
      if (!text.includes('matchCentreData')) continue;
      const keyIdx = text.indexOf('matchCentreData');
      const colonIdx = text.indexOf(':', keyIdx);
      if (colonIdx === -1) continue;
      let i = colonIdx + 1;
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text[i] !== '{') continue;
      const start = i;
      let depth = 0, inString = false, stringChar = '', escaped = false;
      for (; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
          if (escaped) { escaped = false; continue; }
          if (ch === '\\') { escaped = true; continue; }
          if (ch === stringChar) inString = false;
          continue;
        }
        if (ch === '"' || ch === "'") { inString = true; stringChar = ch; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
      }
    }
    return null;
  });

  if (!rawJson) return null;
  try {
    return JSON.parse(rawJson);
  } catch {
    console.warn(`  WARN: JSON parse failed for WS ${wsFixtureId}`);
    return null;
  }
}

// ─── Step 4: Parse incidentEvents → fixtureevents rows ───────────────────────
// Schema:  id (serial), fixtureid (bigint NN), playerid (bigint NULL),
//          teamid (bigint NN), eventtype (text NN), minute (integer NN),
//          extraminute (integer NULL), assistplayerid (bigint NULL),
//          isowngoal (bool default false), ispenalty (bool default false),
//          providerid (text NULL), providerraw (jsonb NULL), createdat

function parseEvents(matchData, dbFixtureId, playerMap, teamMap) {
  // incidentEvents: object keyed by minute string, values are arrays
  const incidents = matchData?.incidentEvents ?? {};
  const tracked = new Set(['GOAL', 'YELLOW_CARD', 'SECOND_YELLOW_CARD', 'RED_CARD', 'SUB_ON', 'SUB_OFF']);
  const events = [];

  for (const [minuteStr, minuteEvents] of Object.entries(incidents)) {
    if (!Array.isArray(minuteEvents)) continue;
    const minute = parseInt(minuteStr, 10);
    if (isNaN(minute)) continue; // minute is NOT NULL — skip if unparseable

    for (const ev of minuteEvents) {
      const typeName      = ev.type?.displayName        ?? ev.type        ?? '';
      const satisfierName = ev.satisfier?.displayName   ?? ev.satisfier   ?? '';
      const eventtype     = mapEventType(typeName, satisfierName);

      if (!tracked.has(eventtype)) continue;

      const wsPlayerId  = ev.playerId         ? String(ev.playerId)         : null;
      const wsAssistId  = ev.assistPlayerId   ? String(ev.assistPlayerId)   : null;
      const wsTeamId    = ev.teamId           ? String(ev.teamId)           : null;

      // teamid is NOT NULL in schema — resolve from whoscoredteamid
      const dbTeamId    = wsTeamId ? (teamMap.get(wsTeamId) ?? null) : null;
      if (!dbTeamId) {
        console.warn(`    WARN: Could not resolve teamid for WS teamId=${wsTeamId}, event type=${eventtype} minute=${minute} — skipping`);
        continue;
      }

      events.push({
        fixture_id:      dbFixtureId,
        player_id:       wsPlayerId ? (playerMap.get(wsPlayerId) ?? null) : null,
        team_id:         dbTeamId,
        // FIX: was bare `event_type,` shorthand, which referenced a variable
        // named `event_type` that does not exist anywhere in this scope —
        // the actual variable holding the mapped value is `eventtype`
        // (no underscore, from mapEventType() above). The shorthand form
        // threw `ReferenceError: event_type is not defined` on every single
        // tracked event, silently caught by the try/catch in runOnce(),
        // meaning fixture_events was never actually populated.
        event_type:      eventtype,
        minute,
        extra_minute:    ev.addedTime ?? null,
        assist_player_id: wsAssistId ? (playerMap.get(wsAssistId) ?? null) : null,
        is_own_goal:      satisfierName === 'goalOwn',
        is_penalty:      satisfierName === 'penaltyScored',
        provider_id:     'whoscored',
        provider_raw:    ev,
      });
    }
  }
  return events;
}

// ─── Step 5: Upsert events — safe to re-run every 3 mins ─────────────────────

async function upsertEvents(events) {
  if (!events.length) return 0;

  // Upsert on the natural uniqueness of a fixture event.
  // Requires a unique constraint in Supabase:
  //   ALTER TABLE fixtureevents
  //     ADD CONSTRAINT fixtureevents_uniq
  //     UNIQUE (fixtureid, eventtype, minute, teamid, playerid);
  const { error } = await supabase
    .from('fixture_events')
    .upsert(events, {
      onConflict:        'fixture_id,event_type,minute,team_id,player_id',
      ignoreDuplicates:  false,
    });

  if (error) {
    console.error(`    Upsert error: ${error.message}`);
    return 0;
  }
  return events.length;
}

// ─── Poll once across all live fixtures ──────────────────────────────────────

async function runOnce(page, playerMap, teamMap) {
  const liveFixtures = await getLiveFixtures();

  if (!liveFixtures.length) {
    console.log(`[${new Date().toISOString()}] No live fixtures in window.`);
    return;
  }

  console.log(`[${new Date().toISOString()}] ${liveFixtures.length} live fixture(s):`);

  for (const fixture of liveFixtures) {
    const { id: dbId, whoscored_fixture_id: wsId, status } = fixture;
    console.log(`  → DB:${dbId}  WS:${wsId}  status:${status}`);

    try {
      const matchData = await scrapeMatchCentreData(page, wsId);
      if (!matchData) {
        console.log('    No matchCentreData found — skipping.');
        continue;
      }

      const events = parseEvents(matchData, dbId, playerMap, teamMap);
      console.log(`    Parsed ${events.length} trackable events`);

      const upserted = await upsertEvents(events);
      console.log(`    Upserted ${upserted} rows into fixture_events`);

      await randomDelay(2000, 4000);
    } catch (err) {
      console.error(`    ERROR scraping WS ${wsId}: ${err.message}`);
    }
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('WhoScored Live Events Poller — polls every 3 minutes');
  console.log('='.repeat(60));

  const context = await chromium.launchPersistentContext('.chrome-profile', {
    headless: false,
    channel:  'chrome',
    userAgent: USER_AGENT,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  // Build lookup maps once at startup; refresh every 30 mins
  let playerMap = await buildPlayerMap();
  let teamMap   = await buildTeamMap();
  let lastRefresh = Date.now();
  console.log(`Player map: ${playerMap.size} entries | Team map: ${teamMap.size} entries`);

  try {
    while (true) {
      // Refresh maps every 30 minutes in case new players/teams were synced
      if (Date.now() - lastRefresh > 30 * 60 * 1000) {
        playerMap   = await buildPlayerMap();
        teamMap     = await buildTeamMap();
        lastRefresh = Date.now();
        console.log(`[refresh] Maps rebuilt — players:${playerMap.size} teams:${teamMap.size}`);
      }

      await runOnce(page, playerMap, teamMap);
      console.log(`[wait] Next poll in ${POLL_INTERVAL_MS}/60000 minute${POLL_INTERVAL_MS !== 1 ? 's' : ''}`);
      await sleep(POLL_INTERVAL_MS);
    }
  } finally {
    await context.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});