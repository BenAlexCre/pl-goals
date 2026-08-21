// scripts/sync-whoscored-events.js
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WORLD_CUP_URL = 'https://www.whoscored.com/Regions/247/Tournaments/36';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/125.0.0.0 Safari/537.36';

const EVENT_TYPE_MAP = {
  Goal: 'goal',
  OwnGoal: 'goal',
  Yellow: 'yellow_card',
  Red: 'red_card',
  YellowRed: 'second_yellow',
  SubOn: 'substitution',
  SubOff: 'substitution',
  Penalty: 'goal',
  MissedPenalty: 'missed_penalty',
};

const fixtureCache = new Map();
const teamCache = new Map();
const playerCache = new Map();

async function getFixtureId(wsFixtureId) {
  if (fixtureCache.has(wsFixtureId)) return fixtureCache.get(wsFixtureId);

  const { data, error } = await supabase
    .from('fixtures')
    .select('id')
    .eq('whoscored_fixture_id', wsFixtureId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`DB error looking up fixture ${wsFixtureId}:`, error.message);
  }

  const id = data?.id ?? null;
  fixtureCache.set(wsFixtureId, id);
  return id;
}

async function getTeamId(wsTeamId) {
  if (!wsTeamId) return null;
  if (teamCache.has(wsTeamId)) return teamCache.get(wsTeamId);

  const { data, error } = await supabase
    .from('teams')
    .select('id')
    .eq('provider_id', wsTeamId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`DB error looking up team ${wsTeamId}:`, error.message);
  }

  const id = data?.id ?? null;
  teamCache.set(wsTeamId, id);
  return id;
}

async function getPlayerId(wsPlayerId) {
  if (!wsPlayerId) return null;
  if (playerCache.has(wsPlayerId)) return playerCache.get(wsPlayerId);

  const { data, error } = await supabase
    .from('players')
    .select('id')
    .eq('provider_id', wsPlayerId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`DB error looking up player ${wsPlayerId}:`, error.message);
  }

  const id = data?.id ?? null;
  playerCache.set(wsPlayerId, id);
  return id;
}

async function upsertEvents(events) {
  if (!events.length) return;

  const { error } = await supabase
    .from('fixture_events')
    .upsert(events, {
      onConflict: 'fixture_id,provider_id',
      ignoreDuplicates: true,
    });

  if (error) {
    console.error('Upsert error:', error.message);
  } else {
    console.log(`✓ Upserted ${events.length} events`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(minMs = 800, maxMs = 2200) {
  return sleep(Math.floor(Math.random() * (maxMs - minMs) + minMs));
}

async function getWorldCupFixtures(page) {
  console.log(`→ Loading World Cup fixtures: ${WORLD_CUP_URL}`);

  await page.goto(WORLD_CUP_URL, {
    waitUntil: 'networkidle',
    timeout: 60000,
  });

  await page.waitForTimeout(5000);

  const links = await page.evaluate(() =>
    [...document.querySelectorAll('a')]
      .map(a => a.href)
      .filter(Boolean)
  );

  const fixtures = [];
  const seen = new Set();

  for (const href of links) {
    const match = href.match(/\/matches\/(\d+)\//i);
    if (!match) continue;

    const wsFixtureId = match[1];
    if (seen.has(wsFixtureId)) continue;

    seen.add(wsFixtureId);
    fixtures.push({ wsFixtureId, url: href });
  }

  console.log(`Found ${fixtures.length} fixtures`);
  return fixtures;
}

async function getMatchEvents(page, fixtureUrl, wsFixtureId) {
  if (!fixtureUrl.toLowerCase().includes('/live/') && !fixtureUrl.toLowerCase().includes('/show')) {
    fixtureUrl = fixtureUrl.replace(
      /\/Matches\/(\d+)\/?.*$/i,
      '/Matches/$1/Live/Match-Centre'
    );
  }

  console.log(`→ Scraping match ${wsFixtureId}`);
  await page.goto(fixtureUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await randomDelay(1200, 3000);

  const rawJson = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script:not([src])'));
    for (const s of scripts) {
      const text = s.textContent || '';
      if (text.includes('matchCentreData')) {
        const m = text.match(/matchCentreData\s*=\s*(\{.+?\});/s);
        if (m) return m[1];
      }
      if (text.includes('"incidents"')) {
        const m = text.match(/\{["']incidents["']:.+\}/s);
        if (m) return m[0];
      }
    }
    return null;
  });

  if (!rawJson) {
    console.warn(`⚠ No matchCentreData found for ${wsFixtureId}`);
    await page.screenshot({
      path: `debug-${wsFixtureId}.png`,
      fullPage: true
    });
    return null;
  }

  let data;
  try {
    data = JSON.parse(rawJson);
  } catch (e) {
    console.warn(`⚠ JSON parse error for ${wsFixtureId}: ${e.message}`);
    return null;
  }

  return {
    incidents: data.incidents ?? [],
    homeTeamId: String(data.home?.teamId ?? ''),
    awayTeamId: String(data.away?.teamId ?? ''),
  };
}

async function parseIncidents({ incidents, homeTeamId, awayTeamId, wsFixtureId, fixtureId }) {
  const events = [];

  for (const inc of incidents) {
    const incClass = inc.incidentType ?? inc.type ?? '';
    if (!EVENT_TYPE_MAP[incClass]) continue;

    const wsTeamId = inc.isHome !== false ? homeTeamId : awayTeamId;
    const teamId = await getTeamId(wsTeamId);

    if (!teamId) {
      console.warn(`⚠ Team ${wsTeamId} not found in DB — skipping incident`);
      continue;
    }

    const playerId = await getPlayerId(String(inc.playerId ?? ''));
    const assistPlayerId = await getPlayerId(String(inc.assistPlayerId ?? ''));

    const minute = inc.minute ?? 0;
    const extraMinute = inc.addedTime ?? inc.minuteExtra ?? null;

    const isOwnGoal = incClass === 'OwnGoal';
    const isPenalty = incClass === 'Penalty' || Boolean(inc.isPenalty);

    const incId = inc.id ?? inc.incidentId ?? null;
    const providerId = incId != null ? `${wsFixtureId}_${incId}` : `${wsFixtureId}_${incClass}_${minute}_${playerId ?? 'na'}`;

    events.push({
      fixture_id: fixtureId,
      player_id: playerId,
      team_id: teamId,
      event_type: EVENT_TYPE_MAP[incClass],
      minute,
      extra_minute: extraMinute,
      assist_player_id: assistPlayerId,
      is_own_goal: isOwnGoal,
      is_penalty: isPenalty,
      provider_id: providerId,
      provider_raw: inc,
    });
  }

  return events;
}

async function main() {
  const context = await chromium.launchPersistentContext('./chrome-profile', {
    headless: false,
    channel: 'chrome',
    userAgent: USER_AGENT,
  });

  await context.addInitScript(
    "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
  );

  const page = await context.newPage();

  try {
    const fixtures = await getWorldCupFixtures(page);

    if (!fixtures.length) {
      console.log('No fixtures found — the tournament page may not be live yet.');
      return;
    }

    let totalEvents = 0;

    for (const fix of fixtures) {
      const { wsFixtureId, url } = fix;

      const fixtureId = await getFixtureId(wsFixtureId);
      if (!fixtureId) {
        console.warn(`⚠ Fixture ${wsFixtureId} not mapped in DB — skipping`);
        continue;
      }

      try {
        const result = await getMatchEvents(page, url, wsFixtureId);
        if (!result) continue;

        const { incidents, homeTeamId, awayTeamId } = result;
        console.log(`incidents=${incidents.length} home=${homeTeamId} away=${awayTeamId}`);

        const events = await parseIncidents({
          incidents,
          homeTeamId,
          awayTeamId,
          wsFixtureId,
          fixtureId,
        });

        await upsertEvents(events);
        totalEvents += events.length;
      } catch (err) {
        console.error(`✗ Error on fixture ${wsFixtureId}:`, err.message);
      }

      await randomDelay(2000, 4000);
    }

    console.log(`\n✓ Done — ${totalEvents} total events processed`);
  } finally {
    await context.close();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});