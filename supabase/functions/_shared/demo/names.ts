// Phase 8C — small, static, offline name pools for demo data generation.
// No external service, no license concerns: plausible-sounding names, not
// real people or real player identities.

export const FIRST_NAMES = [
  'James', 'Liam', 'Noah', 'Oliver', 'Ethan', 'Lucas', 'Mason', 'Logan',
  'Harry', 'Jack', 'Charlie', 'George', 'Oscar', 'Leo', 'Freddie', 'Archie',
  'Theo', 'Alfie', 'Finn', 'Reuben', 'Kai', 'Elijah', 'Daniel', 'Michael',
  'Samuel', 'Benjamin', 'Joshua', 'David', 'Adam', 'Nathan', 'Marcus',
  'Isaac', 'Joseph', 'Ryan', 'Callum', 'Connor', 'Dylan', 'Aaron', 'Owen',
  'Tyler', 'Sofia', 'Emma', 'Olivia', 'Ava', 'Isabella', 'Mia', 'Amelia',
  'Charlotte', 'Grace', 'Chloe', 'Ella', 'Freya', 'Ruby', 'Lily', 'Evie',
  'Poppy', 'Ivy', 'Willow', 'Hannah', 'Zara',
] as const

export const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
  'Davis', 'Rodriguez', 'Martinez', 'Wilson', 'Anderson', 'Taylor',
  'Thomas', 'Moore', 'Jackson', 'Martin', 'Lee', 'Thompson', 'White',
  'Harris', 'Clark', 'Lewis', 'Walker', 'Hall', 'Allen', 'Young', 'King',
  'Wright', 'Scott', 'Green', 'Baker', 'Adams', 'Nelson', 'Carter',
  'Mitchell', 'Roberts', 'Turner', 'Phillips', 'Campbell', 'Parker',
  'Evans', 'Edwards', 'Collins', 'Stewart', 'Morris', 'Murphy', 'Cook',
  'Bailey', 'Cooper', 'Richardson', 'Kelly', 'Howard', 'Ward', 'Torres',
  'Peterson', 'Gray', 'Ramirez', 'James', 'Watson',
] as const

const CLUB_NOUNS = [
  'Athletic', 'United', 'City', 'Rovers', 'Wanderers', 'Town', 'County',
  'Albion', 'Rangers', 'Villa',
] as const

const CLUB_PLACES = [
  'Ashford', 'Bramwell', 'Castlegate', 'Denby', 'Elmhurst', 'Foxton',
  'Greybrook', 'Hartfield', 'Ironmoor', 'Kingswell',
] as const

export function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]
}

// Mulberry32 — tiny, seedable, deterministic PRNG (no crypto import needed;
// a demo run should be reproducible from its own config.seed if re-run for
// debugging, but never needs cryptographic randomness).
export function makeRng(seed: number): () => number {
  let a = seed
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randomPersonName(rng: () => number): { first: string; last: string } {
  return { first: pick(FIRST_NAMES, rng), last: pick(LAST_NAMES, rng) }
}

// Real bug caught live (Phase 9 — Demo Gameweek verification): this used
// to dedupe on the full `${place} ${noun}` name only, but shortName is
// just `place` alone — two teams could (and, confirmed live, did: "Ashford
// Villa"/"Ashford Town" both got shortName "Ashford") land the same
// shortName while having distinct full names, since only the full-name
// combination was checked for uniqueness. Every place in fixture/pick
// UI — FixtureCard, standings, LMS/Predictor pickers — renders shortName,
// so this was a real, visible "two different teams both display as
// 'Kingswell'" bug, not a cosmetic one. Deduping on the place itself
// (CLUB_PLACES has 10 entries, TEAM_COUNT is 8 — always enough headroom)
// guarantees shortName uniqueness, which also guarantees full-name
// uniqueness as a side effect.
export function randomClubName(rng: () => number, usedPlaces: Set<string>): { name: string; shortName: string } {
  for (let attempt = 0; attempt < 50; attempt++) {
    const place = pick(CLUB_PLACES, rng)
    if (!usedPlaces.has(place)) {
      usedPlaces.add(place)
      const noun = pick(CLUB_NOUNS, rng)
      return { name: `${place} ${noun}`, shortName: place }
    }
  }
  // Pool exhausted (shouldn't happen at demo scale — CLUB_PLACES has 10
  // entries) — fall back to a numbered place rather than looping forever,
  // still guaranteed unique.
  const place = `Demo Town ${usedPlaces.size + 1}`
  usedPlaces.add(place)
  return { name: `${place} FC`, shortName: place }
}

export function usernameFromName(first: string, last: string, suffix: number): string {
  return `${first}${last}${suffix}`.toLowerCase().replace(/[^a-z0-9_]/g, '')
}
