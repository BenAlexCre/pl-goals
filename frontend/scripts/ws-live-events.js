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

// ─── Step 5b: player stats (Phase 25, review pass) ───────────────────────────
// `matchCentreData.home/away.players[].stats` is the SAME response
// `parseEvents()` above already reads — this only reads MORE of it. Each
// stat is a per-minute-keyed object (WhoScored's live-progress
// representation); only the value at the highest minute key is a real
// match total once stored, so `finalValue()` is the one place that
// collapses "progress over time" into "the match stat."

function finalValue(perMinuteObj) {
  if (!perMinuteObj || typeof perMinuteObj !== 'object') return null;
  const minutes = Object.keys(perMinuteObj)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
  if (minutes.length === 0) return null;
  const last = Math.max(...minutes);
  const value = perMinuteObj[String(last)];
  return typeof value === 'number' ? value : null;
}

function parsePlayerStats(matchData, dbFixtureId, playerMap, teamMap) {
  const rows = [];

  for (const side of ['home', 'away']) {
    const teamData = matchData?.[side];
    if (!teamData) continue;

    const wsTeamId = teamData.teamId ? String(teamData.teamId) : null;
    const dbTeamId = wsTeamId ? (teamMap.get(wsTeamId) ?? null) : null;
    if (!dbTeamId) continue; // unmapped team — skip rather than guess

    for (const p of teamData.players ?? []) {
      const wsPlayerId = p.playerId ? String(p.playerId) : null;
      const dbPlayerId = wsPlayerId ? (playerMap.get(wsPlayerId) ?? null) : null;
      if (!dbPlayerId) continue; // unmapped player — skip rather than guess

      const s = p.stats ?? {};
      rows.push({
        fixture_id: dbFixtureId,
        player_id: dbPlayerId,
        team_id: dbTeamId,
        rating: finalValue(s.ratings),
        is_first_eleven: !!p.isFirstEleven,
        is_man_of_the_match: !!p.isManOfTheMatch,
        shots_total: finalValue(s.shotsTotal),
        shots_on_target: finalValue(s.shotsOnTarget),
        shots_off_target: finalValue(s.shotsOffTarget),
        shots_blocked: finalValue(s.shotsBlocked),
        key_passes: finalValue(s.passesKey),
        dribbles_won: finalValue(s.dribblesWon),
        dribbles_attempted: finalValue(s.dribblesAttempted),
        dribble_success: finalValue(s.dribbleSuccess),
        dispossessed: finalValue(s.dispossessed),
        passes_total: finalValue(s.passesTotal),
        passes_accurate: finalValue(s.passesAccurate),
        pass_success: finalValue(s.passSuccess),
        fouls_committed: finalValue(s.foulsCommited),
        offsides_caught: finalValue(s.offsidesCaught),
        tackles_total: finalValue(s.tacklesTotal),
        tackles_won: finalValue(s.tackleSuccessful),
        tackle_success: finalValue(s.tackleSuccess),
        interceptions: finalValue(s.interceptions),
        clearances: finalValue(s.clearances),
        dribbled_past: finalValue(s.dribbledPast),
        aerials_total: finalValue(s.aerialsTotal),
        aerials_won: finalValue(s.aerialsWon),
        aerial_success: finalValue(s.aerialSuccess),
        touches: finalValue(s.touches),
        errors: finalValue(s.errors),
        total_saves: finalValue(s.totalSaves),
        parried_safe: finalValue(s.parriedSafe),
        parried_danger: finalValue(s.parriedDanger),
        raw_stats: s,
        synced_at: new Date().toISOString(),
      });
    }
  }

  return rows;
}

async function upsertPlayerStats(rows) {
  if (!rows.length) return 0;

  const { error } = await supabase
    .from('fixture_player_match_stats')
    .upsert(rows, { onConflict: 'fixture_id,player_id', ignoreDuplicates: false });

  if (error) {
    console.error(`    Player-stats upsert error: ${error.message}`);
    return 0;
  }
  return rows.length;
}

// Marks a fixture's stats as synced — gives real purpose to the
// stats_status/stats_last_synced_at columns migration 032 found already
// live on `fixtures` but unused by any application code ("scaffolding for
// a stats-sync lifecycle that was never finished"). Best-effort: a
// failure here must never fail the actual stats upsert above.
async function markFixtureStatsSynced(dbFixtureId) {
  const { error } = await supabase
    .from('fixtures')
    .update({ stats_status: 'synced', stats_last_synced_at: new Date().toISOString() })
    .eq('id', dbFixtureId);
  if (error) console.warn(`    Could not update fixtures.stats_status: ${error.message}`);
}

// ─── Step 6: lineup status (Phase 25, lineup status) ─────────────────────────
//
// A real, live-verified signal (not an assumption): for a fixture whose
// official lineups haven't been published yet, `matchCentreData` itself is
// the JSON literal `null` — confirmed by inspecting a real, not-yet-played
// Premier League fixture's own WhoScored page directly. `scrapeMatchCentreData()`
// already returns `null` for that (its own brace-matching only recognizes
// a `{`-shaped value right after the `matchCentreData:` key), and runOnce()
// already skips the whole fixture for that poll cycle when that happens —
// so by the time this function ever runs, `matchData` is guaranteed
// non-null. This function additionally requires each side's own `players`
// array to be non-empty before treating THAT side's lineup as "confirmed"
// — defensive, not just an "at least 11 players" headcount: an empty/
// missing array simply means this side isn't confirmed yet, no status is
// written for it, and no player is called Not in Squad on the strength of
// an incomplete response.
//
// Lineup CLASSIFICATION (`status: starting | bench`, and the `started`
// boolean) is written once and never regressed by a later substitution —
// a starter who's later subbed off keeps `status: starting`/`started:
// true` forever. This function skips any player whose EXISTING row is
// already 'sub_on'/'sub_off' (set by applySubstitutionUpdates() in a
// previous cycle) rather than re-asserting 'starting'/'bench' over it —
// `matchData.players[].isFirstEleven` doesn't change over the match, so
// re-running this upsert every poll cycle would otherwise silently
// overwrite an already-applied substitution back to its pre-substitution
// value.
function parseLineup(matchData, dbFixtureId, playerMap, teamMap, existingStatusByPlayer) {
  const rows = [];
  const confirmedTeamDbIds = new Set();
  const seenPlayerDbIds = new Set();

  for (const side of ['home', 'away']) {
    const teamData = matchData?.[side];
    const players = teamData?.players;
    if (!Array.isArray(players) || players.length === 0) continue; // not confirmed yet for this side

    const wsTeamId = teamData.teamId ? String(teamData.teamId) : null;
    const dbTeamId = wsTeamId ? (teamMap.get(wsTeamId) ?? null) : null;
    if (!dbTeamId) continue; // unmapped team — skip rather than guess

    confirmedTeamDbIds.add(dbTeamId);

    for (const p of players) {
      const wsPlayerId = p.playerId ? String(p.playerId) : null;
      const dbPlayerId = wsPlayerId ? (playerMap.get(wsPlayerId) ?? null) : null;
      if (!dbPlayerId) continue; // unmapped player — skip rather than guess

      seenPlayerDbIds.add(dbPlayerId);

      const existing = existingStatusByPlayer.get(dbPlayerId);
      if (existing === 'sub_on' || existing === 'sub_off') continue; // never regress an already-advanced status

      rows.push({
        fixture_id: dbFixtureId,
        player_id: dbPlayerId,
        team_id: dbTeamId,
        status: p.isFirstEleven ? 'starting' : 'bench',
        started: !!p.isFirstEleven,
      });
    }
  }

  return { rows, confirmedTeamDbIds, seenPlayerDbIds };
}

async function getExistingLineupStatuses(dbFixtureId) {
  const { data, error } = await supabase
    .from('fixture_player_status')
    .select('player_id, status')
    .eq('fixture_id', dbFixtureId);
  if (error) {
    console.warn(`    Could not read existing fixture_player_status: ${error.message}`);
    return new Map();
  }
  return new Map((data ?? []).map((r) => [r.player_id, r.status]));
}

// A roster player (player_team_history, active) for a CONFIRMED team who
// wasn't named anywhere in that team's own confirmed squad list this
// cycle is genuinely not in today's matchday squad — never applied to a
// team whose lineup isn't confirmed yet (confirmedTeamDbIds only contains
// teams parseLineup() actually saw a non-empty players array for).
async function computeNotInSquadRows(dbFixtureId, confirmedTeamDbIds, seenPlayerDbIds, existingStatusByPlayer) {
  if (confirmedTeamDbIds.size === 0) return [];

  const { data, error } = await supabase
    .from('player_team_history')
    .select('player_id, team_id')
    .eq('is_active', true)
    .in('team_id', [...confirmedTeamDbIds]);
  if (error) {
    console.warn(`    Could not read roster for not-in-squad check: ${error.message}`);
    return [];
  }

  const rows = [];
  for (const row of data ?? []) {
    if (seenPlayerDbIds.has(row.player_id)) continue;
    if (existingStatusByPlayer.get(row.player_id) === 'not_in_squad') continue; // already recorded, no-op
    rows.push({
      fixture_id: dbFixtureId,
      player_id: row.player_id,
      team_id: row.team_id,
      status: 'not_in_squad',
      started: false,
    });
  }
  return rows;
}

async function upsertLineupRows(rows) {
  if (!rows.length) return 0;
  const { error } = await supabase
    .from('fixture_player_status')
    .upsert(rows, { onConflict: 'fixture_id,player_id', ignoreDuplicates: false });
  if (error) {
    console.error(`    Lineup upsert error: ${error.message}`);
    return 0;
  }
  return rows.length;
}

// Cross-references the SAME `events` this cycle already parsed via
// parseEvents() above (no second scrape/query) — sub_on/sub_off events
// UPDATE the player's existing row (never insert; a substitution can only
// happen to a player who already has a lineup row) with the event-state
// overlay + minute, deliberately NOT touching `started` (the durable
// lineup fact) either direction.
async function applySubstitutionUpdates(events, dbFixtureId) {
  let updated = 0;
  for (const ev of events) {
    if (ev.event_type !== 'sub_on' && ev.event_type !== 'sub_off') continue;
    if (!ev.player_id) continue;

    const minuteColumn = ev.event_type === 'sub_on' ? 'came_on_minute' : 'went_off_minute';
    const { error, count } = await supabase
      .from('fixture_player_status')
      .update({ status: ev.event_type, [minuteColumn]: ev.minute }, { count: 'exact' })
      .eq('fixture_id', dbFixtureId)
      .eq('player_id', ev.player_id);

    if (error) {
      console.warn(`    Could not apply substitution update for player ${ev.player_id}: ${error.message}`);
      continue;
    }
    if (count > 0) updated += count;
  }
  return updated;
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

      // Lineup status is intentionally isolated in its own try/catch,
      // separate from events/player-stats above and below — a lineup
      // parsing problem for this fixture must not prevent the (already
      // proven, unrelated) events/stats ingestion from completing for the
      // exact same fixture this same cycle.
      try {
        const existingStatusByPlayer = await getExistingLineupStatuses(dbId);
        const { rows: lineupRows, confirmedTeamDbIds, seenPlayerDbIds } =
          parseLineup(matchData, dbId, playerMap, teamMap, existingStatusByPlayer);
        const notInSquadRows = await computeNotInSquadRows(dbId, confirmedTeamDbIds, seenPlayerDbIds, existingStatusByPlayer);
        const lineupUpserted = await upsertLineupRows([...lineupRows, ...notInSquadRows]);
        const subUpdated = await applySubstitutionUpdates(events, dbId);
        if (lineupUpserted > 0 || subUpdated > 0) {
          console.log(`    Lineup: ${lineupUpserted} row(s) upserted, ${subUpdated} substitution update(s)`);
          health.lastDbWriteAt = new Date().toISOString();
        }
      } catch (lineupErr) {
        console.error(`    ERROR processing lineup status for WS ${wsId}: ${lineupErr.message}`);
      }

      const playerStatsRows = parsePlayerStats(matchData, dbId, playerMap, teamMap);
      const statsUpserted = await upsertPlayerStats(playerStatsRows);
      console.log(`    Upserted ${statsUpserted} player-stat rows`);
      if (statsUpserted > 0) {
        health.lastDbWriteAt = new Date().toISOString();
        await markFixtureStatsSynced(dbId);
      }

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
    // Phase 23 — confirmed by direct container testing (`docker stop`):
    // without this, the process doesn't reliably drop out of the event
    // loop on its own after a graceful shutdown (a lingering Chrome/Xvfb
    // child handle, not investigated further since forcing exit here is
    // simple and safe), so the host's stop grace period expires and it
    // gets SIGKILLed instead — the shutdown work above still completes
    // correctly either way, but this makes the exit prompt and
    // deterministic rather than relying on it.
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});