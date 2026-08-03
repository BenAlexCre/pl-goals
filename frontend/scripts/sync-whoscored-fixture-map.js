// scripts/sync-whoscored-fixture-map.js
//
// HOW TO ADD A NEW LEAGUE:
//   1. Add an entry to LEAGUE_CONFIGS below
//   2. Change ACTIVE_LEAGUE to the key you want to run
//   3. Run: node scripts/sync-whoscored-fixture-map.js
//
// That's it. No other changes needed.

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// ── League config registry ────────────────────────────────────────────────────
const LEAGUE_CONFIGS = {
  world_cup_2026: {
    label:         'FIFA World Cup 2026',
    tournamentUrl: 'https://www.whoscored.com/Regions/247/Tournaments/36/International-FIFA-World-Cup',
  },
  premier_league: {
    label:         'Premier League 2026/27',
    tournamentUrl: 'https://www.whoscored.com/Regions/252/Tournaments/2/England-Premier-League',
  },
  championship: {
    label:         'Championship 2025/26',
    tournamentUrl: 'https://www.whoscored.com/Regions/252/Tournaments/7/England-Championship',
  },
  la_liga: {
    label:         'La Liga 2025/26',
    tournamentUrl: 'https://www.whoscored.com/Regions/206/Tournaments/4/Spain-LaLiga',
  },
  serie_a: {
    label:         'Serie A 2025/26',
    tournamentUrl: 'https://www.whoscored.com/Regions/108/Tournaments/5/Italy-Serie-A',
  },
  bundesliga: {
    label:         'Bundesliga 2025/26',
    tournamentUrl: 'https://www.whoscored.com/Regions/81/Tournaments/3/Germany-Bundesliga',
  },
};

// ── CHANGE THIS TO SWITCH LEAGUE ─────────────────────────────────────────────
const ACTIVE_LEAGUE = 'premier_league';
// ─────────────────────────────────────────────────────────────────────────────

const LEAGUE = LEAGUE_CONFIGS[ACTIVE_LEAGUE];
if (!LEAGUE) {
  console.error(`Unknown league key: "${ACTIVE_LEAGUE}". Valid keys: ${Object.keys(LEAGUE_CONFIGS).join(', ')}`);
  process.exit(1);
}

// ── Env vars ──────────────────────────────────────────────────────────────────
const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ??
  process.env.SUPABASE_URL;

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_SERVICE_KEY ??
  process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing Supabase env vars. Keys found:', Object.keys(process.env).filter(k =>
    k.toLowerCase().includes('supabase')
  ));
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── Constants ────────────────────────────────────────────────────────────────
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Accept WS kickoff within ±3 hours of DB kickoff (covers timezone quirks)
const KICKOFF_WINDOW_MS = 3 * 60 * 60 * 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs = 1000, maxMs = 3000) {
  return sleep(Math.floor(Math.random() * (maxMs - minMs) + minMs));
}

// WhoScored and football-data.org use different naming conventions for the
// same country in several cases. Map every known variant to one canonical
// form so namesMatch() compares apples to apples. Keys/values are already
// lowercase since normalizeName() lowercases before this lookup runs.
const COUNTRY_ALIASES = {
  turkiye: 'turkey',
  turkey: 'turkey',
  curacao: 'curacao', // accent stripped by normalizeName's [^a-z0-9] filter
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
  // Strip accents (e.g. "Curaçao" → "Curacao") BEFORE removing
  // non-alphanumerics, otherwise accented letters get deleted entirely
  // rather than reduced to their base letter ("curaçao" → "curaao", wrong).
  const lower = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const depunctuated = lower.replace(/[^a-z0-9]/g, '').trim();

  // Check country aliases BEFORE club-suffix stripping — the suffix regex
  // below strips "united" (e.g. "Manchester United" → "Manchester"), which
  // would also wrongly strip it from "United States" before the alias
  // lookup ever saw it (turning it into "states", not "unitedstates").
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

// ── Step 1: Get all fixture links across every stage/group ────────────────────
async function getTournamentFixtures(page) {
  console.log(`\nLoading: ${LEAGUE.label}`);
  console.log(`URL: ${LEAGUE.tournamentUrl}\n`);

  await page.goto(LEAGUE.tournamentUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(6000);

  // Check we actually landed on WhoScored (not a block/CAPTCHA page)
  const title = await page.title();
  console.log(`Page title: "${title}"`);
  if (title.toLowerCase().includes('access denied') || title.toLowerCase().includes('just a moment')) {
    console.error('WhoScored is blocking this request. Try logging in manually in the Chrome profile first.');
    console.error('Run: node scripts/ws-open-browser.js  (see bottom of this file for that helper)');
    process.exit(1);
  }

  // The tournament page only shows whichever single group/stage it happens to
  // land on by default (e.g. "Grp. C" for the World Cup) — NOT the full
  // tournament. The `stages` dropdown (id="stages") lists every group/stage
  // as its own URL. If present, visit each one and collect fixture links
  // from all of them. Falls back to scraping just the landing page if no
  // stages dropdown is found (e.g. league configs that don't use it).
  const stageUrls = await page.evaluate(() => {
    const select = document.querySelector('select#stages');
    if (!select) return [];
    return [...select.querySelectorAll('option')]
      .map((opt) => opt.value)
      .filter(Boolean);
  });

  const fixtures = [];
  const seen = new Set();

  function collectFixtureLinks(links) {
    for (const href of links) {
      const match = href.match(/\/Matches\/(\d+)\//i);
      if (!match) continue;
      const wsFixtureId = match[1];
      if (seen.has(wsFixtureId)) continue;
      seen.add(wsFixtureId);
      fixtures.push({ wsFixtureId, url: href });
    }
  }

  if (!stageUrls.length) {
  console.log('No stages dropdown found — paging week-by-week via #dayChangeBtn-next.');

  const NEXT_BTN_SELECTOR = '#dayChangeBtn-next';
  const MAX_CLICKS = 45; // season is 38 GWs; slack for split/rescheduled rounds
  const MAX_CONSECUTIVE_NO_NEW = 4; // stop early once we run off the end of the season

  let clicks = 0;
  let consecutiveNoNew = 0;

  // Landing page counts as week 0
  let links = await page.evaluate(() =>
    [...document.querySelectorAll('a')].map((a) => a.href).filter(Boolean)
  );
  collectFixtureLinks(links);
  console.log(`  Week 0 (landing): ${fixtures.length} fixtures so far`);

  while (clicks < MAX_CLICKS) {
    const btn = await page.$(NEXT_BTN_SELECTOR);
    if (!btn) {
      console.log('  Next-week button not found — stopping.');
      break;
    }

    const isDisabled = await btn.evaluate((el) =>
      el.disabled || el.getAttribute('aria-disabled') === 'true'
    );
    if (isDisabled) {
      console.log('  Next-week button disabled — reached end of season.');
      break;
    }

    const before = fixtures.length;
    await btn.click();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await randomDelay(1500, 3000);

    links = await page.evaluate(() =>
      [...document.querySelectorAll('a')].map((a) => a.href).filter(Boolean)
    );
    collectFixtureLinks(links);
    clicks++;

    const added = fixtures.length - before;
    console.log(`  Week ${clicks}: +${added} new fixtures (total ${fixtures.length})`);

    if (added === 0) {
      consecutiveNoNew++;
      if (consecutiveNoNew >= MAX_CONSECUTIVE_NO_NEW) {
        console.log(`  No new fixtures for ${MAX_CONSECUTIVE_NO_NEW} consecutive weeks — stopping.`);
        break;
      }
    } else {
      consecutiveNoNew = 0;
    }
  }

  console.log(`Found ${fixtures.length} fixture links after ${clicks} week-clicks`);
  return fixtures;
}

  console.log(`Found ${stageUrls.length} stages/groups — visiting each one...\n`);

  // Landing page's own links count as the first stage (avoids a wasted nav)
  const landingLinks = await page.evaluate(() =>
    [...document.querySelectorAll('a')].map((a) => a.href).filter(Boolean)
  );
  collectFixtureLinks(landingLinks);

  for (const stageUrl of stageUrls) {
    const fullUrl = stageUrl.startsWith('http')
      ? stageUrl
      : `https://www.whoscored.com${stageUrl}`;

    try {
      process.stdout.write(`  Stage: ${fullUrl} ... `);
      await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 60000 });
      await randomDelay(1000, 2000);

      const links = await page.evaluate(() =>
        [...document.querySelectorAll('a')].map((a) => a.href).filter(Boolean)
      );

      const before = fixtures.length;
      collectFixtureLinks(links);
      console.log(`+${fixtures.length - before} new fixtures (total ${fixtures.length})`);
    } catch (err) {
      console.log(`[ERROR] ${err.message}`);
    }
  }

  console.log(`\nFound ${fixtures.length} total fixture links across all stages`);
  return fixtures;
}

// ── Step 2: Extract matchCentreData from a match page ─────────────────────────
async function getMatchMeta(page, wsFixtureId) {
  // Always use the Live/Match-Centre URL — it always has matchCentreData
  const url = `https://www.whoscored.com/Matches/${wsFixtureId}/Live`;

  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await randomDelay(1500, 3500);

  const rawJson = await page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script:not([src])')];
    for (const s of scripts) {
      const text = s.textContent || '';
      if (text.includes('matchCentreData')) {
        // WhoScored renders this as a PROPERTY inside a larger object literal,
        // e.g.:  matchId: 1953859, matchCentreData: {"playerIdNameDictionary": ...}, otherKey: ...
        // It is NOT a standalone `matchCentreData = {...};` statement, and the
        // object can contain nested braces/strings — so we can't reliably grab
        // it with a single non-greedy regex. Instead: find where the value
        // starts, then walk forward counting brace depth (skipping over
        // anything inside quoted strings) until it balances back to zero.
        const keyIdx = text.indexOf('matchCentreData');
        const colonIdx = text.indexOf(':', keyIdx);
        if (colonIdx === -1) continue;

        let i = colonIdx + 1;
        while (i < text.length && /\s/.test(text[i])) i++;
        if (text[i] !== '{') continue; // value isn't an object — unexpected, skip

        const start = i;
        let depth = 0;
        let inString = false;
        let stringChar = '';
        let escaped = false;

        for (; i < text.length; i++) {
          const ch = text[i];

          if (inString) {
            if (escaped) {
              escaped = false;
            } else if (ch === '\\') {
              escaped = true;
            } else if (ch === stringChar) {
              inString = false;
            }
            continue;
          }

          if (ch === '"' || ch === "'") {
            inString = true;
            stringChar = ch;
            continue;
          }

          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) {
              return text.slice(start, i + 1);
            }
          }
        }
        // Unbalanced braces — fell off the end without closing. Skip this script block.
      }
    }
    return null;
  });

  // NOTE: matchCentreData itself has NO team-name fields — only teamId,
  // formations, stats, incidentEvents, shotZones, etc. (confirmed by
  // inspecting real payload keys). Team names are scraped from the DOM
  // breadcrumb dropdown below instead, since that's present and
  // consistently formatted whether the match is finished or upcoming.
  let data = null;
  if (rawJson) {
    try {
      data = JSON.parse(rawJson);
    } catch (e) {
      console.warn(`  [WARN] JSON parse error for WS ${wsFixtureId}: ${e.message}`);
    }
  }

  // The breadcrumb select has id="matches" and options formatted like
  // "Haiti-Scotland" — confirmed via DevTools inspection. Works on both
  // finished and not-yet-started match pages.
  //
  // Note: team display names from WhoScored avoid embedding a literal
  // hyphen in the name itself (e.g. "Bosnia and Herzegovina", not
  // "Bosnia-Herzegovina"), so splitting on the first "-" is safe in
  // practice. If a future case breaks this, the raw option text is
  // logged below to make the failure obvious rather than silent.
  const namesFromDom = await page.evaluate(() => {
    const select = document.querySelector('select#matches');
    if (!select) return null;

    // Prefer the option that's actually selected/current
    const opt = select.querySelector('option[selected]') ?? select.options?.[select.selectedIndex];
    const text = opt?.textContent?.trim();
    if (!text || !text.includes('-')) return { rawText: text ?? null };

    const idx = text.indexOf('-');
    return {
      rawText: text,
      homeName: text.slice(0, idx).trim(),
      awayName: text.slice(idx + 1).trim(),
    };
  });

  if (!namesFromDom?.homeName || !namesFromDom?.awayName) {
    // Save a screenshot so you can debug what WS actually returned
    await page.screenshot({ path: `debug-ws-${wsFixtureId}.png`, fullPage: true });
    console.warn(`  [SKIP] Could not extract team names from DOM for WS ${wsFixtureId}. Raw option text: "${namesFromDom?.rawText ?? 'none found'}" — screenshot saved`);
    return null;
  }

  const homeWsTeamId = data?.home?.teamId ? String(data.home.teamId) : null;
  const awayWsTeamId = data?.away?.teamId ? String(data.away.teamId) : null;

  // startTime comes back like "2026-06-14T02:00:00" — NO timezone suffix.
  // WhoScored displays kickoff in UTC, so treat it as explicit UTC rather
  // than letting `new Date(...)` interpret it in the local machine's zone.
  const kickoffRaw = data?.startTime ?? data?.startDate ?? null;
  const kickoff_utc = kickoffRaw ? new Date(`${kickoffRaw}Z`).toISOString() : null;

  return {
    kickoff_utc,
    homeName: namesFromDom.homeName,
    awayName: namesFromDom.awayName,
    homeWsTeamId,
    awayWsTeamId,
  };
}

// ── Step 3: Fetch DB fixtures that don't yet have a WS ID ─────────────────────
async function getUnmappedFixtures() {
  const { data: fixtures, error: fxErr } = await supabase
    .from('fixtures')
    .select('id, kickoff_utc, whoscored_fixture_id, home_team_id, away_team_id');

  if (fxErr) throw new Error(`DB fetch failed: ${fxErr.message}`);

  console.log(`Total fixtures in DB: ${fixtures?.length ?? 0}`);

  const notYetMapped = (fixtures ?? []).filter((f) => !f.whoscored_fixture_id);

  // Knockout-stage fixtures whose teams aren't determined yet (e.g. "Winner
  // of Group A vs Winner of Group B") have null home_team_id/away_team_id.
  // They can never be name-matched, so exclude them from this run entirely
  // rather than letting them clutter the [NO MATCH] output — they'll be
  // pickup-able once fullSyncInsert.js re-syncs after those teams are known.
  const unmapped = notYetMapped.filter((f) => f.home_team_id && f.away_team_id);
  const undetermined = notYetMapped.length - unmapped.length;

  console.log(`Already mapped: ${(fixtures?.length ?? 0) - notYetMapped.length}`);
  console.log(`Need mapping:   ${unmapped.length}`);
  if (undetermined > 0) {
    console.log(`Skipped (teams not yet determined): ${undetermined}`);
  }

  if (!unmapped.length) return [];

  const teamIds = [
    ...new Set([
      ...unmapped.map((f) => f.home_team_id),
      ...unmapped.map((f) => f.away_team_id),
    ].filter(Boolean))
  ];

  const { data: teams, error: teamErr } = await supabase
    .from('teams')
    .select('id, name, short_name, whoscoredteamid')
    .in('id', teamIds);

  if (teamErr) throw new Error(`Teams fetch failed: ${teamErr.message}`);

  const teamMap = new Map((teams ?? []).map((t) => [t.id, t]));

  return unmapped.map((f) => ({
    ...f,
    home_team: teamMap.get(f.home_team_id) ?? null,
    away_team: teamMap.get(f.away_team_id) ?? null,
  }));
}

// ── Step 4: Match a WS fixture to a DB fixture ────────────────────────────────
function findDbMatch(meta, dbFixtures) {
  if (!meta?.homeName || !meta?.awayName) return null;

  // FIX: was `meta.kickoffUtc` (camelCase, always undefined) — the
  // object built in getMatchMeta uses `kickoff_utc` (snake_case).
  // That bug meant this kickoff-window safety net never actually ran,
  // and matching silently fell back to pure name-matching across ALL
  // remaining DB fixtures every time — much more error-prone, and the
  // likely cause of widespread [NO MATCH] / wrong-match results.
  const candidates = meta.kickoff_utc
    ? dbFixtures.filter((f) => {
        const diff = Math.abs(
          new Date(f.kickoff_utc).getTime() - new Date(meta.kickoff_utc).getTime()
        );
        return diff < KICKOFF_WINDOW_MS;
      })
    : dbFixtures;

  return candidates.find((f) => {
    const homeMatch =
      namesMatch(f.home_team?.name, meta.homeName) ||
      namesMatch(f.home_team?.short_name, meta.homeName);
    const awayMatch =
      namesMatch(f.away_team?.name, meta.awayName) ||
      namesMatch(f.away_team?.short_name, meta.awayName);
    return homeMatch && awayMatch;
  }) ?? null;
}

// ── Step 5: Write IDs back to DB ──────────────────────────────────────────────
async function writeWsIds(dbFixtureId, wsFixtureId, homeTeamId, homeWsTeamId, awayTeamId, awayWsTeamId) {
  const { error: fxErr } = await supabase
    .from('fixtures')
    .update({ whoscored_fixture_id: wsFixtureId })
    .eq('id', dbFixtureId);

  if (fxErr) {
    console.error(`  [ERROR] Writing fixture WS ID: ${fxErr.message}`);
    return false;
  }

  if (homeTeamId && homeWsTeamId) {
    await supabase
      .from('teams')
      .update({ whoscoredteamid: homeWsTeamId })
      .eq('id', homeTeamId)
      .is('whoscoredteamid', null);
  }

  if (awayTeamId && awayWsTeamId) {
    await supabase
      .from('teams')
      .update({ whoscoredteamid: awayWsTeamId })
      .eq('id', awayTeamId)
      .is('whoscoredteamid', null);
  }

  return true;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(60));
  console.log(`WhoScored Fixture Map — ${LEAGUE.label}`);
  console.log('='.repeat(60));

  const dbFixtures = await getUnmappedFixtures();

  if (!dbFixtures.length) {
    console.log('\nAll fixtures already have WS IDs — nothing to do.');
    return;
  }

  const context = await chromium.launchPersistentContext('.chrome-profile', {
    headless: false,
    channel: 'chrome',
    userAgent: USER_AGENT,
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  let mapped = 0;
  let skipped = 0;
  let noMatch = 0;

  try {
    const wsFixtures = await getTournamentFixtures(page);

    if (!wsFixtures.length) {
      console.log('\nNo fixture links found on tournament page.');
      console.log('The tournament may not have started yet, or WhoScored blocked the request.');
      return;
    }

    console.log(`\nMatching ${wsFixtures.length} WS fixtures against ${dbFixtures.length} DB fixtures...\n`);

    // Working copy — we remove matched fixtures so later iterations are faster
    const remaining = [...dbFixtures];

    for (const { wsFixtureId, url } of wsFixtures) {
      if (!remaining.length) {
        console.log('All DB fixtures matched — stopping early.');
        break;
      }

      try {
        process.stdout.write(`  WS ${wsFixtureId} ... `);
        const meta = await getMatchMeta(page, wsFixtureId);

        if (!meta) {
          skipped++;
          continue;
        }

        const dbMatch = findDbMatch(meta, remaining);

        if (!dbMatch) {
          console.log(`[NO MATCH] ${meta.homeName} vs ${meta.awayName} @ ${meta.kickoff_utc ?? 'unknown time'}`);
          noMatch++;
        } else {
          const ok = await writeWsIds(
            dbMatch.id,
            wsFixtureId,
            dbMatch.home_team?.id,
            meta.homeWsTeamId,
            dbMatch.away_team?.id,
            meta.awayWsTeamId
          );

          if (ok) {
            console.log(`[OK] ${meta.homeName} vs ${meta.awayName} → DB fixture ${dbMatch.id}`);
            mapped++;
            const idx = remaining.findIndex((f) => f.id === dbMatch.id);
            if (idx !== -1) remaining.splice(idx, 1);
          }
        }
      } catch (err) {
        console.log(`[ERROR] ${err.message}`);
        skipped++;
      }

      await randomDelay(2000, 4500);
    }

    console.log('\n' + '='.repeat(60));
    console.log(`DONE  mapped: ${mapped}  no-match: ${noMatch}  errors/skipped: ${skipped}`);

    if (remaining.length) {
      console.log(`\n${remaining.length} DB fixtures still unmatched:`);
      for (const f of remaining) {
        console.log(`  DB ${f.id} | ${f.home_team?.name} vs ${f.away_team?.name} | ${f.kickoff_utc}`);
      }
    }

    console.log('='.repeat(60));
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});