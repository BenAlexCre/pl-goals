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

export function randomClubName(rng: () => number, usedNames: Set<string>): { name: string; shortName: string } {
  for (let attempt = 0; attempt < 50; attempt++) {
    const place = pick(CLUB_PLACES, rng)
    const noun = pick(CLUB_NOUNS, rng)
    const name = `${place} ${noun}`
    if (!usedNames.has(name)) {
      usedNames.add(name)
      return { name, shortName: place }
    }
  }
  // Pool exhausted (shouldn't happen at demo scale) — fall back to a
  // numbered name rather than looping forever.
  const name = `Demo Town FC ${usedNames.size + 1}`
  usedNames.add(name)
  return { name, shortName: name }
}

export function usernameFromName(first: string, last: string, suffix: number): string {
  return `${first}${last}${suffix}`.toLowerCase().replace(/[^a-z0-9_]/g, '')
}
