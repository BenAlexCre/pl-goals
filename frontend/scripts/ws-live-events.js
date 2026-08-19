import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as http from 'node:http';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SUPABASE_URL    = process.env.VITE_SUPABASE_URL    ?? process.env.SUPABASE_URL;
const SERVICE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL_MS = 60 * 1000; // 1 minute
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const MAX_SCRAPE_RETRIES = 2; // Phase 22 — one retry beyond the first attempt, per fixture, per cycle
const RETRY_DELAY_MS = 5000;
// Phase 22 — headless:false is a deliberate anti-Cloudflare-detection choice
// this script always made (see the persistent .chrome-profile/ context below,
// same reasoning) — headless Chromium has a different, more easily
// fingerprinted profile. Switching it unconditionally to save on needing a
// display would trade a known-working evasion posture for an unverified one.
// A worker host with no physical display should run this under a virtual
// framebuffer (`xvfb-run -a node ws-live-events.js`) instead — see
// docs/DEPLOYMENT.md — rather than this script silently changing its own
// fingerprint. Set WS_HEADLESS=true only if you have specific evidence
// headless is acceptable for your deployment.
const HEADLESS = process.env.WS_HEADLESS === 'true';
const HEALTH_PORT = Number(process.env.WS_HEALTH_PORT ?? 8787);

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ─── Phase 22: health state + minimal HTTP health endpoint ───────────────────
// Not a monitoring platform — the simplest thing that answers "is the worker
// alive, is the browser alive, what is it doing, when did it last succeed."
// No new dependency: Node's built-in http module.

const health = {
  startedAt: new Date().toISOString(),
  browserAlive: false,
  activeFixtureCount: 0,
  lastPollAt: null,
  lastSuccessfulScrapeAt: null,
  lastDbWriteAt: null,
  lastError: null,
  pollCount: 0,
};

function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.stringify({
      status: health.browserAlive ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor((Date.now() - new Date(health.startedAt).getTime()) / 1000),
      ...health,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(body);
  });
  server.listen(HEALTH_PORT, () => {
    console.log(`[health] Listening on :${HEALTH_PORT}/health`);
  });
  return server;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay(min = 1500, max = 3500) {
  return sleep(Math.floor(Math.random() * (max - min) + min));
}

// Map WhoScored incident type/satisfier → event_type text value.
//
// Phase 22 fix — CRITICAL, previously-undiscovered bug: this returned
// SCREAMING_SNAKE_CASE ('GOAL', 'YELLOW_CARD', ...), but every real
// consumer of fixture_events.event_type uses lowercase snake_case —
// business-rules.md's own documented rule ("event_type in ('goal',
// 'penalty')"), the Match Centre views in
// supabase/migrations/025_match_centre_views.sql ("fe.event_type =
// 'goal'", "in ('yellow_card', 'red_card', 'second_yellow')"), the demo
// pipeline's own CHECK constraint (migration 026), and
// FixtureEventsTimeline.jsx's EVENT_ICON lookup table all agree on
// lowercase — this script alone disagreed. The practical impact: Pick 5
// scoring reads player_fixture_goals, a materialized view filtered on
// `fe.event_type in ('goal', 'penalty') and not fe.is_own_goal` — an
// uppercase 'GOAL' row would never match that filter, so even a fully
// working, unblocked, correctly-deduplicated scrape would have silently
// scored zero goals for every player, forever, with no error anywhere.
function mapEventType(type, satisfier) {
  if (type === 'Goal') {
    if (satisfier === 'goalOwn')       return 'goal';
    if (satisfier === 'penaltyScored') return 'goal';
    return 'goal';
  }
  if (type === 'Card') {
    if (satisfier === 'yellowCard')  return 'yellow_card';
    if (satisfier === 'secondYellow') return 'second_yellow';
    if (satisfier === 'redCard')     return 'red_card';
  }
  if (type === 'SubstitutionOn')  return 'sub_on';
  if (type === 'SubstitutionOff') return 'sub_off';
  return type.toLowerCase();
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
  const tracked = new Set(['goal', 'yellow_card', 'second_yellow', 'red_card', 'sub_on', 'sub_off']);
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

// ─── Step 5: Upsert events — safe to re-run every 1 min ─────────────────────

async function upsertEvents(events) {
  if (!events.length) return 0;

  // Upsert on the natural uniqueness of a fixture event. The required
  // unique constraint (`fixtureevents_uniq`) previously existed only
  // out-of-band on this project's own local database — formalized in
  // `supabase/migrations/031_fixture_events_uniqueness.sql` (Phase 22),
  // so a fresh deployment now actually gets it too, matching what this
  // upsert has always assumed.
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

// ─── Step 3b: scrape with one retry — a single failed page load/network blip
// shouldn't cost this fixture an entire 1-minute cycle ────────────────────────

async function scrapeWithRetry(page, wsFixtureId) {
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_SCRAPE_RETRIES; attempt++) {
    try {
      return await scrapeMatchCentreData(page, wsFixtureId);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_SCRAPE_RETRIES) {
        console.warn(`    Attempt ${attempt} failed (${err.message}) — retrying in ${RETRY_DELAY_MS}ms`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  throw lastErr;
}

// ─── Poll once across all live fixtures ──────────────────────────────────────

async function runOnce(page, playerMap, teamMap) {
  health.lastPollAt = new Date().toISOString();
  health.pollCount++;

  const liveFixtures = await getLiveFixtures();
  health.activeFixtureCount = liveFixtures.length;

  if (!liveFixtures.length) {
    console.log(`[${new Date().toISOString()}] No live fixtures in window.`);
    return;
  }

  console.log(`[${new Date().toISOString()}] ${liveFixtures.length} live fixture(s):`);

  for (const fixture of liveFixtures) {
    const { id: dbId, whoscored_fixture_id: wsId, status } = fixture;
    console.log(`  → DB:${dbId}  WS:${wsId}  status:${status}`);

    try {
      const matchData = await scrapeWithRetry(page, wsId);
      if (!matchData) {
        console.log('    No matchCentreData found — skipping.');
        continue;
      }
      health.lastSuccessfulScrapeAt = new Date().toISOString();

      const events = parseEvents(matchData, dbId, playerMap, teamMap);
      console.log(`    Parsed ${events.length} trackable events`);

      const upserted = await upsertEvents(events);
      console.log(`    Upserted ${upserted} rows into fixture_events`);
      if (upserted > 0) health.lastDbWriteAt = new Date().toISOString();

      await randomDelay(2000, 4000);
    } catch (err) {
      health.lastError = { message: err.message, at: new Date().toISOString(), wsFixtureId: wsId };
      console.error(`    ERROR scraping WS ${wsId} after ${MAX_SCRAPE_RETRIES} attempts: ${err.message}`);
    }
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log(`WhoScored Live Events Poller — polls every ${POLL_INTERVAL_MS / 1000}s, headless=${HEADLESS}`);
  console.log('='.repeat(60));

  const healthServer = startHealthServer();

  const context = await chromium.launchPersistentContext('.chrome-profile', {
    headless: HEADLESS,
    channel:  'chrome',
    userAgent: USER_AGENT,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  health.browserAlive = true;

  const page = await context.newPage();

  // Build lookup maps once at startup; refresh every 30 mins
  let playerMap = await buildPlayerMap();
  let teamMap   = await buildTeamMap();
  let lastRefresh = Date.now();
  console.log(`Player map: ${playerMap.size} entries | Team map: ${teamMap.size} entries`);

  let stopping = false;
  let shutdownResolve;
  const shutdownSignal = new Promise((resolve) => { shutdownResolve = resolve; });

  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    console.log(`\n[shutdown] Received ${signal} — closing browser context and health server...`);
    health.browserAlive = false;
    shutdownResolve();
  }
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  try {
    while (!stopping) {
      // Refresh maps every 30 minutes in case new players/teams were synced
      if (Date.now() - lastRefresh > 30 * 60 * 1000) {
        playerMap   = await buildPlayerMap();
        teamMap     = await buildTeamMap();
        lastRefresh = Date.now();
        console.log(`[refresh] Maps rebuilt — players:${playerMap.size} teams:${teamMap.size}`);
      }

      try {
        await runOnce(page, playerMap, teamMap);
      } catch (err) {
        // A failure inside runOnce's own per-fixture try/catch already
        // isolates one bad fixture from the rest of that cycle — this
        // outer catch is for anything unexpected escaping runOnce itself
        // (e.g. a DB error in getLiveFixtures), so one bad cycle doesn't
        // kill the whole process the way an uncaught main() rejection did
        // before.
        health.lastError = { message: err.message, at: new Date().toISOString() };
        console.error(`[cycle] Unexpected error, continuing to next poll: ${err.message}`);
      }

      console.log(`[wait] Next poll in ${POLL_INTERVAL_MS / 1000}s`);
      await Promise.race([sleep(POLL_INTERVAL_MS), shutdownSignal]);
    }
  } finally {
    await context.close();
    healthServer.close();
    console.log('[shutdown] Clean exit.');
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});