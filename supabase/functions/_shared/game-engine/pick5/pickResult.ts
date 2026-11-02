// ISSUE-85 (2026-11-02) — a Pick 5 pick's DISPLAYED result, from the state of
// its own player's fixture(s) in the gameweek, not of the gameweek as a whole.
//
// Previously: if no fixture anywhere in the gameweek was live, every pick
// below its goal threshold read 'lost' — including picks whose player had not
// played yet (between the deadline and kickoff, or a Sunday player on a
// Saturday evening).
//
// This only decides `pick5_picks.result`. Winners, standings and prizes use
// `picks_won` (goals >= threshold), which is unchanged.
//
// "Expected" fixtures exclude postponed/cancelled ones — the same exclusion the
// gameweek-completion rule uses (business-rules.md § Gameweek lifecycle).
// Status is read from the fixture row, never inferred from the clock, so a
// delayed kickoff stays 'pending' until the provider reports it live.

export type FixtureStatus = 'scheduled' | 'tbd' | 'live' | 'finished' | 'postponed' | 'cancelled'
export type PickResult = 'pending' | 'winning' | 'losing' | 'won' | 'lost'

export function derivePickResult(input: {
  goals: number
  threshold: number
  /** The player's team's fixtures in this gameweek (normally one; two in a double gameweek). */
  teamFixtureStatuses: string[]
}): PickResult {
  const met = input.goals >= input.threshold
  const expected = input.teamFixtureStatuses.filter((s) => s !== 'postponed' && s !== 'cancelled')

  // No expected match this gameweek (all postponed/cancelled), or no fixture
  // data for the player's team: nothing has been played, so it cannot be lost.
  // Goals can only exist if a match was played, so meeting the threshold is a win.
  if (expected.length === 0) return met ? 'won' : 'pending'

  if (expected.every((s) => s === 'finished')) return met ? 'won' : 'lost'

  // In progress: a live match, or a double gameweek with one match played.
  if (expected.some((s) => s === 'live' || s === 'finished')) return met ? 'winning' : 'losing'

  // Not started (scheduled, unconfirmed 'tbd', delayed, or suspended — which the
  // provider mapping reports as 'tbd'). Goals before a suspension still count.
  return met ? 'winning' : 'pending'
}
