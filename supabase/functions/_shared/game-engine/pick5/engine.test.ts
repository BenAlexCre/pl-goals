// Unit tests for Pick5Engine.validateEntry() — the pick-shape rules
// (GE-6: "Enforce the mode's pick-shape rules"). Uses a fake Supabase client
// that only implements the exact query chain validateEntry() issues
// (.from().select().eq().in()), same fake-client-over-real-DB approach the
// framework verification suite established for the DI boundary itself.
//
// available_players_by_gameweek's actual eligibility join (active squad +
// non-postponed fixture in that gameweek) is a live-DB concern, not something
// a unit test re-derives — that's covered by manual live verification (see
// session-log.md) and, longer-term, integration tests once ISSUE-16 gives
// this repo a test runner for that layer.

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { GameEngineContext } from '../contracts.ts'
import type { GameEntry } from '../types.ts'
import { Pick5Engine, PICK5_PICK_COUNT } from './engine.ts'
import { Pick5PrizePoolExceededError, Pick5ValidationError } from './errors.ts'

interface FakeEligiblePlayer {
  player_id: number
  position: string | null
}

function fakeContext(eligiblePlayers: FakeEligiblePlayer[]): GameEngineContext {
  const fakeSupabase = {
    from(table: string) {
      if (table !== 'available_players_by_gameweek') {
        throw new Error(`Unexpected table in test fake: ${table}`)
      }
      return {
        select() {
          return {
            eq(_column: string, _gameweekId: number) {
              return {
                in(_inColumn: string, playerIds: number[]) {
                  const idSet = new Set(playerIds)
                  const data = eligiblePlayers.filter((p) => idSet.has(p.player_id))
                  return Promise.resolve({ data, error: null })
                },
              }
            },
          }
        },
      }
    },
  }
  return { supabase: fakeSupabase as unknown as GameEngineContext['supabase'], now: () => new Date() }
}

function pendingEntry(overrides: Partial<GameEntry> = {}): GameEntry {
  return {
    id: 'entry-1',
    potId: 'pot-1',
    userId: 'user-1',
    gameweekId: 4,
    entryScope: 'gameweek',
    status: 'pending',
    payoutAmount: 0,
    settledAt: null,
    ...overrides,
  }
}

const OUTFIELD = (id: number): FakeEligiblePlayer => ({ player_id: id, position: 'Midfield' })

Deno.test('accepts exactly 5 eligible, non-goalkeeper picks', async () => {
  const engine = new Pick5Engine()
  const ctx = fakeContext([1, 2, 3, 4, 5].map(OUTFIELD))

  await engine.validateEntry(ctx, pendingEntry(), [
    { playerId: 1 }, { playerId: 2 }, { playerId: 3 }, { playerId: 4 }, { playerId: 5 },
  ])
  // No throw = pass.
})

Deno.test('accepts duplicate picks of the same player (up to 5x)', async () => {
  const engine = new Pick5Engine()
  const ctx = fakeContext([OUTFIELD(1)])

  await engine.validateEntry(ctx, pendingEntry(), Array(5).fill({ playerId: 1 }))
})

Deno.test('rejects fewer than 5 picks', async () => {
  const engine = new Pick5Engine()
  const ctx = fakeContext([1, 2, 3, 4].map(OUTFIELD))

  await assertRejects(
    () => engine.validateEntry(ctx, pendingEntry(), [{ playerId: 1 }, { playerId: 2 }, { playerId: 3 }, { playerId: 4 }]),
    Pick5ValidationError,
  )
})

Deno.test('rejects more than 5 picks', async () => {
  const engine = new Pick5Engine()
  const ctx = fakeContext([1, 2, 3, 4, 5, 6].map(OUTFIELD))

  await assertRejects(
    () => engine.validateEntry(ctx, pendingEntry(), [1, 2, 3, 4, 5, 6].map((id) => ({ playerId: id }))),
    Pick5ValidationError,
  )
})

Deno.test('rejects a pick for a goalkeeper', async () => {
  const engine = new Pick5Engine()
  const ctx = fakeContext([
    ...[1, 2, 3, 4].map(OUTFIELD),
    { player_id: 5, position: 'Goalkeeper' },
  ])

  await assertRejects(
    () => engine.validateEntry(
      ctx,
      pendingEntry(),
      [1, 2, 3, 4, 5].map((id) => ({ playerId: id })),
    ),
    Pick5ValidationError,
  )
})

Deno.test('rejects a pick for a coach', async () => {
  const engine = new Pick5Engine()
  const ctx = fakeContext([
    ...[1, 2, 3, 4].map(OUTFIELD),
    { player_id: 5, position: 'Coach' },
  ])

  await assertRejects(
    () => engine.validateEntry(
      ctx,
      pendingEntry(),
      [1, 2, 3, 4, 5].map((id) => ({ playerId: id })),
    ),
    Pick5ValidationError,
  )
})

Deno.test('rejects a player not returned by available_players_by_gameweek', async () => {
  const engine = new Pick5Engine()
  // Player 5 is missing from the "eligible" set entirely — e.g. not on an
  // active squad, or their team has no fixture this gameweek.
  const ctx = fakeContext([1, 2, 3, 4].map(OUTFIELD))

  await assertRejects(
    () => engine.validateEntry(
      ctx,
      pendingEntry(),
      [1, 2, 3, 4, 5].map((id) => ({ playerId: id })),
    ),
    Pick5ValidationError,
  )
})

Deno.test('rejects a malformed pick (missing playerId)', async () => {
  const engine = new Pick5Engine()
  const ctx = fakeContext([1, 2, 3, 4].map(OUTFIELD))

  await assertRejects(
    () => engine.validateEntry(
      ctx,
      pendingEntry(),
      [{ playerId: 1 }, { playerId: 2 }, { playerId: 3 }, { playerId: 4 }, {}],
    ),
    Pick5ValidationError,
  )
})

Deno.test('rejects an entry that is not pending', async () => {
  const engine = new Pick5Engine()
  const ctx = fakeContext([1, 2, 3, 4, 5].map(OUTFIELD))

  await assertRejects(
    () => engine.validateEntry(
      ctx,
      pendingEntry({ status: 'locked' }),
      [1, 2, 3, 4, 5].map((id) => ({ playerId: id })),
    ),
    Pick5ValidationError,
  )
})

Deno.test('rejects a season-scoped entry with no gameweekId', async () => {
  const engine = new Pick5Engine()
  const ctx = fakeContext([1, 2, 3, 4, 5].map(OUTFIELD))

  await assertRejects(
    () => engine.validateEntry(
      ctx,
      pendingEntry({ gameweekId: null, entryScope: 'season' }),
      [1, 2, 3, 4, 5].map((id) => ({ playerId: id })),
    ),
    Pick5ValidationError,
  )
})

// --- lockEntries() ---------------------------------------------------------
// Fake client covers the two-step query shape lockEntries() issues:
// .from('pots').select('id').eq('game_type', 'pick5'), then
// .from('game_entries').update(...).eq('gameweek_id', X).eq('status', 'pending')
//   .in('pot_id', potIds).select('id')
// The game_entries fake actually filters/mutates an in-memory row set rather
// than blindly returning canned data, so a test can prove the method's own
// filtering logic (gameweek, status, pot scope) is correct, not just that it
// issued *a* query.

interface FakeGameEntryRow {
  id: string
  pot_id: string
  gameweek_id: number
  status: string
}

function fakeLockEntriesContext(
  pick5PotIds: string[],
  gameEntries: FakeGameEntryRow[]
): GameEngineContext & { gameEntriesQueried: () => boolean } {
  let gameEntriesQueried = false
  const fakeSupabase = {
    from(table: string) {
      if (table === 'pots') {
        return {
          select: () => ({
            eq: (_col: string, _val: string) => Promise.resolve({ data: pick5PotIds.map((id) => ({ id })), error: null }),
          }),
        }
      }
      if (table === 'game_entries') {
        gameEntriesQueried = true
        return {
          update: (patch: { status: string }) => ({
            eq: (_col1: string, gameweekId: number) => ({
              eq: (_col2: string, fromStatus: string) => ({
                in: (_col3: string, potIds: string[]) => ({
                  select: () => {
                    const potIdSet = new Set(potIds)
                    const matched = gameEntries.filter(
                      (e) => e.gameweek_id === gameweekId && e.status === fromStatus && potIdSet.has(e.pot_id)
                    )
                    matched.forEach((e) => { e.status = patch.status })
                    return Promise.resolve({ data: matched.map((e) => ({ id: e.id })), error: null })
                  },
                }),
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table in test fake: ${table}`)
    },
  }
  return {
    supabase: fakeSupabase as unknown as GameEngineContext['supabase'],
    now: () => new Date(),
    gameEntriesQueried: () => gameEntriesQueried,
  }
}

Deno.test('lockEntries locks pending pick5 entries for the given gameweek', async () => {
  const engine = new Pick5Engine()
  const entries: FakeGameEntryRow[] = [
    { id: 'e1', pot_id: 'pot-pick5', gameweek_id: 4, status: 'pending' },
    { id: 'e2', pot_id: 'pot-pick5', gameweek_id: 4, status: 'pending' },
  ]
  const ctx = fakeLockEntriesContext(['pot-pick5'], entries)

  const count = await engine.lockEntries(ctx, 4)

  assertEquals(count, 2)
  assertEquals(entries.every((e) => e.status === 'locked'), true)
})

Deno.test('lockEntries does not touch entries for a different gameweek', async () => {
  const engine = new Pick5Engine()
  const entries: FakeGameEntryRow[] = [
    { id: 'e1', pot_id: 'pot-pick5', gameweek_id: 4, status: 'pending' },
    { id: 'e2', pot_id: 'pot-pick5', gameweek_id: 5, status: 'pending' },
  ]
  const ctx = fakeLockEntriesContext(['pot-pick5'], entries)

  const count = await engine.lockEntries(ctx, 4)

  assertEquals(count, 1)
  assertEquals(entries.find((e) => e.id === 'e1')?.status, 'locked')
  assertEquals(entries.find((e) => e.id === 'e2')?.status, 'pending')
})

Deno.test('lockEntries only transitions entries that are currently pending', async () => {
  const engine = new Pick5Engine()
  const entries: FakeGameEntryRow[] = [
    { id: 'e1', pot_id: 'pot-pick5', gameweek_id: 4, status: 'locked' },
    { id: 'e2', pot_id: 'pot-pick5', gameweek_id: 4, status: 'void' },
    { id: 'e3', pot_id: 'pot-pick5', gameweek_id: 4, status: 'settled' },
    { id: 'e4', pot_id: 'pot-pick5', gameweek_id: 4, status: 'pending' },
  ]
  const ctx = fakeLockEntriesContext(['pot-pick5'], entries)

  const count = await engine.lockEntries(ctx, 4)

  assertEquals(count, 1)
  assertEquals(entries.find((e) => e.id === 'e4')?.status, 'locked')
})

Deno.test('lockEntries never touches entries belonging to a non-pick5 pot', async () => {
  const engine = new Pick5Engine()
  // Same gameweek_id and status as a real pick5 entry — only pot_id differs.
  // Proves the explicit pot scoping (not just "gameweek_id is non-null") is
  // what's actually gating this, per the GE-18 isolation invariant.
  const entries: FakeGameEntryRow[] = [
    { id: 'e1', pot_id: 'pot-other-mode', gameweek_id: 4, status: 'pending' },
  ]
  const ctx = fakeLockEntriesContext(['pot-pick5'], entries)

  const count = await engine.lockEntries(ctx, 4)

  assertEquals(count, 0)
  assertEquals(entries[0].status, 'pending')
})

Deno.test('lockEntries returns 0 without querying game_entries when there are no pick5 pots', async () => {
  const engine = new Pick5Engine()
  const ctx = fakeLockEntriesContext([], [])

  const count = await engine.lockEntries(ctx, 4)

  assertEquals(count, 0)
  assertEquals(ctx.gameEntriesQueried(), false)
})

// --- calculateScore() --------------------------------------------------
// Fake client models the full chain: pots -> fixtures (live check) ->
// game_entries (locked, in scope) -> pick5_picks (select, then upsert) ->
// player_fixture_goals (select) -> game_entry_pick5 (upsert). State is
// in-memory and mutated by the fake's upsert handlers, so tests assert on
// the actual resulting rows, not just that a query was issued.

interface FakeScorePick {
  id: number
  game_entry_id: string
  player_id: number
  pick_position: number
  goal_threshold: number
  goals_scored: number
  result: string
}

interface FakeScoreEntryPick5 {
  game_entry_id: string
  picks_won: number
}

interface FakeScoreState {
  pick5PotIds: string[]
  liveFixtureExists: boolean
  lockedEntryIds: string[]
  picks: FakeScorePick[]
  goalsByPlayer: Record<number, number>
  entryPick5Rows: FakeScoreEntryPick5[]
}

function fakeCalculateScoreContext(state: FakeScoreState): GameEngineContext {
  const fakeSupabase = {
    from(table: string) {
      if (table === 'pots') {
        return { select: () => ({ eq: () => Promise.resolve({ data: state.pick5PotIds.map((id) => ({ id })), error: null }) }) }
      }
      if (table === 'fixtures') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: state.liveFixtureExists ? [{ id: 1 }] : [], error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'game_entries') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: () => Promise.resolve({ data: state.lockedEntryIds.map((id) => ({ id })), error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'pick5_picks') {
        return {
          select: () => ({
            in: (_col: string, entryIds: string[]) => {
              const idSet = new Set(entryIds)
              return Promise.resolve({ data: state.picks.filter((p) => idSet.has(p.game_entry_id)), error: null })
            },
          }),
          upsert: (rows: Array<{ id: number; goals_scored: number; result: string }>) => {
            for (const row of rows) {
              const existing = state.picks.find((p) => p.id === row.id)
              if (existing) Object.assign(existing, row)
            }
            return Promise.resolve({ data: rows, error: null })
          },
        }
      }
      if (table === 'player_fixture_goals') {
        return {
          select: () => ({
            eq: () => ({
              in: (_col: string, playerIds: number[]) => {
                const rows = playerIds
                  .filter((id) => id in state.goalsByPlayer)
                  .map((id) => ({ player_id: id, goals: state.goalsByPlayer[id] }))
                return Promise.resolve({ data: rows, error: null })
              },
            }),
          }),
        }
      }
      if (table === 'game_entry_pick5') {
        return {
          upsert: (rows: Array<{ game_entry_id: string; picks_won: number }>) => {
            for (const row of rows) {
              const existing = state.entryPick5Rows.find((e) => e.game_entry_id === row.game_entry_id)
              if (existing) existing.picks_won = row.picks_won
              else state.entryPick5Rows.push({ game_entry_id: row.game_entry_id, picks_won: row.picks_won })
            }
            return Promise.resolve({ data: rows, error: null })
          },
        }
      }
      throw new Error(`Unexpected table in test fake: ${table}`)
    },
  }
  return { supabase: fakeSupabase as unknown as GameEngineContext['supabase'], now: () => new Date() }
}

Deno.test('calculateScore marks a pick won/lost correctly for a finished gameweek', async () => {
  const engine = new Pick5Engine()
  const state: FakeScoreState = {
    pick5PotIds: ['pot-1'],
    liveFixtureExists: false,
    lockedEntryIds: ['entry-1'],
    picks: [
      { id: 1, game_entry_id: 'entry-1', player_id: 100, pick_position: 1, goal_threshold: 1, goals_scored: 0, result: 'pending' },
      { id: 2, game_entry_id: 'entry-1', player_id: 200, pick_position: 2, goal_threshold: 1, goals_scored: 0, result: 'pending' },
    ],
    goalsByPlayer: { 100: 2 }, // player 200 has no row at all -> 0 goals
    entryPick5Rows: [{ game_entry_id: 'entry-1', picks_won: 0 }],
  }
  const ctx = fakeCalculateScoreContext(state)

  await engine.calculateScore(ctx, 4)

  assertEquals(state.picks[0].result, 'won')
  assertEquals(state.picks[0].goals_scored, 2)
  assertEquals(state.picks[1].result, 'lost')
  assertEquals(state.picks[1].goals_scored, 0)
  assertEquals(state.entryPick5Rows[0].picks_won, 1)
})

Deno.test('calculateScore uses winning/losing (not won/lost) while a fixture is still live', async () => {
  const engine = new Pick5Engine()
  const state: FakeScoreState = {
    pick5PotIds: ['pot-1'],
    liveFixtureExists: true,
    lockedEntryIds: ['entry-1'],
    picks: [
      { id: 1, game_entry_id: 'entry-1', player_id: 100, pick_position: 1, goal_threshold: 1, goals_scored: 0, result: 'pending' },
    ],
    goalsByPlayer: { 100: 1 },
    entryPick5Rows: [{ game_entry_id: 'entry-1', picks_won: 0 }],
  }
  const ctx = fakeCalculateScoreContext(state)

  await engine.calculateScore(ctx, 4)

  assertEquals(state.picks[0].result, 'winning')
})

Deno.test('calculateScore counts every duplicate pick of the same player that meets threshold', async () => {
  const engine = new Pick5Engine()
  const state: FakeScoreState = {
    pick5PotIds: ['pot-1'],
    liveFixtureExists: false,
    lockedEntryIds: ['entry-1'],
    picks: [
      { id: 1, game_entry_id: 'entry-1', player_id: 100, pick_position: 1, goal_threshold: 2, goals_scored: 0, result: 'pending' },
      { id: 2, game_entry_id: 'entry-1', player_id: 100, pick_position: 2, goal_threshold: 2, goals_scored: 0, result: 'pending' },
    ],
    goalsByPlayer: { 100: 2 },
    entryPick5Rows: [{ game_entry_id: 'entry-1', picks_won: 0 }],
  }
  const ctx = fakeCalculateScoreContext(state)

  await engine.calculateScore(ctx, 4)

  assertEquals(state.picks[0].result, 'won')
  assertEquals(state.picks[1].result, 'won')
  assertEquals(state.entryPick5Rows[0].picks_won, 2)
})

Deno.test('calculateScore never touches entries that are not locked', async () => {
  const engine = new Pick5Engine()
  const state: FakeScoreState = {
    pick5PotIds: ['pot-1'],
    liveFixtureExists: false,
    lockedEntryIds: [], // e.g. the one entry for this gameweek is still 'pending'
    picks: [
      { id: 1, game_entry_id: 'entry-1', player_id: 100, pick_position: 1, goal_threshold: 1, goals_scored: 0, result: 'pending' },
    ],
    goalsByPlayer: { 100: 5 },
    entryPick5Rows: [],
  }
  const ctx = fakeCalculateScoreContext(state)

  await engine.calculateScore(ctx, 4)

  assertEquals(state.picks[0].result, 'pending', 'a non-locked entry\'s picks must be left untouched')
})

Deno.test('calculateScore is a no-op when there are no pick5 pots', async () => {
  const engine = new Pick5Engine()
  const state: FakeScoreState = {
    pick5PotIds: [],
    liveFixtureExists: false,
    lockedEntryIds: ['entry-1'],
    picks: [{ id: 1, game_entry_id: 'entry-1', player_id: 100, pick_position: 1, goal_threshold: 1, goals_scored: 0, result: 'pending' }],
    goalsByPlayer: { 100: 5 },
    entryPick5Rows: [],
  }
  const ctx = fakeCalculateScoreContext(state)

  await engine.calculateScore(ctx, 4)

  assertEquals(state.picks[0].result, 'pending')
})

Deno.test('calculateScore is a no-op when there are no picks for any locked entry', async () => {
  const engine = new Pick5Engine()
  const state: FakeScoreState = {
    pick5PotIds: ['pot-1'],
    liveFixtureExists: false,
    lockedEntryIds: ['entry-1'],
    picks: [],
    goalsByPlayer: {},
    entryPick5Rows: [],
  }
  const ctx = fakeCalculateScoreContext(state)

  // Must not throw even though there's nothing to score.
  await engine.calculateScore(ctx, 4)

  assertEquals(state.entryPick5Rows.length, 0)
})

// --- settle() and generateStandings() -------------------------------------
// settle() calls generateStandings() internally (GE-8.4: "GE->>GE:
// generateStandings(...)" is a self-call, not a separate dispatcher step —
// see the comment on settle() itself). A fake that only understood settle()'s
// own query shapes would silently no-op the generateStandings() call inside
// it (fetching `undefined`, since an un-modeled table/chain resolves to
// nothing) — passing tests without proving the integration actually works.
// This fake instead models real in-memory tables with a small generic query
// builder (chainable .select/.eq/.in/.update/.upsert, and thenable at any
// point, matching how the real supabase-js builder behaves) so both
// methods' real query shapes are genuinely exercised.

interface FakePotFeeConfig {
  entry_fee?: number
  admin_fee_type?: string
  admin_fee_amount?: number | null
  admin_fee_percentage?: number | null
  charity_fee_type?: string
  charity_fee_amount?: number | null
  charity_fee_percentage?: number | null
  // Product rule revision, 2026-08-09 (jackpot/rollover) — optional so
  // every pre-existing test that only cares about fee math keeps working
  // with sensible defaults (below).
  league_id?: number
  season_id?: number
  name?: string
  created_by?: string
  carry_over_amount?: number
  rollover_generation?: number
}

interface FakePotRow {
  id: string
  game_type: string
  status: string
  league_id: number
  season_id: number
  name: string
  created_by: string
  entry_fee: number
  admin_fee_type: string
  admin_fee_amount: number | null
  admin_fee_percentage: number | null
  charity_fee_type: string
  charity_fee_amount: number | null
  charity_fee_percentage: number | null
  carry_over_amount: number
  rollover_generation: number
  rollover_source_pot_id: string | null
  // Corrections pass, 2026-08-10 — createPick5RolloverPot() now resolves
  // and sets both, never leaves them null.
  start_gameweek_id?: number | null
  end_gameweek_id?: number | null
}

interface FakeDb {
  pick5PotIds: string[]
  // Optional per-pot overrides for awardPrize()'s pots.select(...) lookup —
  // any pick5PotIds entry not listed here gets entry_fee: 0, every fee
  // type: 'none' (matches this table's real column defaults), so every
  // existing test written before Slice 8 keeps working unchanged. Used to
  // auto-derive `pots` (below) at construction time — see emptyFakeDb().
  potFeeConfig: Record<string, FakePotFeeConfig>
  // Product rule revision, 2026-08-09 — a real, mutable pots table (unlike
  // pick5PotIds/potFeeConfig, which are read-only view sugar this method
  // still supports for backward compatibility). Needed because
  // createPick5RolloverPot() both inserts a new row here and queries by
  // rollover_source_pot_id, neither of which a computed-per-query view can
  // support. Auto-populated from pick5PotIds/potFeeConfig unless a test
  // supplies `pots` directly (for full control over league_id/season_id/
  // an existing rollover link, etc.).
  pots: FakePotRow[]
  gameEntries: { id: string; pot_id: string; user_id: string; gameweek_id: number; status: string; settled_at: string | null; payout_amount?: number }[]
  entryPayments: { pot_id: string; user_id: string; gameweek_id: number; scope: string; is_paid: boolean }[]
  pick5Picks: { id: number; game_entry_id: string; result: string }[]
  gameEntryPick5: { game_entry_id: string; picks_won: number }[]
  potStandingsSnapshots: { pot_id: string; gameweek_id: number | null; user_id: string; rank: number; score: number }[]
  potPrizes: {
    id: string
    pot_id: string
    scope: string
    gameweek_id: number | null
    gross_amount: number
    admin_fee_amount: number
    charity_fee_amount: number
    is_settled: boolean
    settled_at: string | null
    // Product rule revision, 2026-08-09 — optional so every pre-existing
    // row literal (implicitly "not a rollover") keeps working unchanged;
    // undefined is falsy, identical to explicit false for every read this
    // engine does against it.
    rollover?: boolean
  }[]
  // Product rule revision, 2026-08-09 — needed for
  // isFinalGameweekOfSeason() (a pot's own league/season's real final
  // gameweek) and resolveNextSeasonLeague()'s "which season comes next"
  // resolution.
  gameweeks: { id: number; league_id: number; season_id: number; number: number }[]
  leagues: { id: number; name: string; country: string; season_id: number }[]
  seasons: { id: number; year_start: number }[]
  notifications: { id: number; user_id: string; pot_id: string | null; type: string; payload: Record<string, unknown> | null }[]
  // Slice 9: lets a test simulate the notifications insert failing, to prove
  // awardPrize() isolates that failure from the money it already wrote —
  // every other fake table always succeeds, so this is opt-in per test.
  notificationsShouldFail: boolean
  // Hardening sprint, 2026-08-06: failure-injection flags for the two
  // partial-write risks the architecture review identified. Patch-aware
  // (not a blanket per-table flag) because game_entries.update() is called
  // for three different purposes in this file (void, settle, payout) —
  // a blanket flag would fail all three indiscriminately and make it
  // impossible to test one step failing while the others still succeed.
  entriesVoidShouldFail: boolean
  picksVoidShouldFail: boolean
  potPrizesWriteShouldFail: boolean
}

function emptyFakeDb(overrides: Partial<FakeDb> = {}): FakeDb {
  const pick5PotIds = overrides.pick5PotIds ?? []
  const potFeeConfig = overrides.potFeeConfig ?? {}

  // Auto-derive `pots` from the existing pick5PotIds/potFeeConfig sugar
  // unless a test supplies `pots` explicitly — every test written before
  // this revision only ever set the former, and gets identical defaults
  // to what the old computed-view fake used to synthesize.
  const derivedPots: FakePotRow[] = pick5PotIds.map((id) => {
    const cfg = potFeeConfig[id] ?? {}
    return {
      id,
      game_type: 'pick5',
      status: 'active',
      league_id: cfg.league_id ?? 1,
      season_id: cfg.season_id ?? 1,
      name: cfg.name ?? `Test Pot ${id}`,
      created_by: cfg.created_by ?? 'organiser-1',
      entry_fee: cfg.entry_fee ?? 0,
      admin_fee_type: cfg.admin_fee_type ?? 'none',
      admin_fee_amount: cfg.admin_fee_amount ?? null,
      admin_fee_percentage: cfg.admin_fee_percentage ?? null,
      charity_fee_type: cfg.charity_fee_type ?? 'none',
      charity_fee_amount: cfg.charity_fee_amount ?? null,
      charity_fee_percentage: cfg.charity_fee_percentage ?? null,
      carry_over_amount: cfg.carry_over_amount ?? 0,
      rollover_generation: cfg.rollover_generation ?? 0,
      rollover_source_pot_id: null,
    }
  })

  return {
    pick5PotIds,
    potFeeConfig,
    pots: overrides.pots ?? derivedPots,
    gameEntries: [],
    entryPayments: [],
    pick5Picks: [],
    gameEntryPick5: [],
    potStandingsSnapshots: [],
    potPrizes: [],
    gameweeks: [],
    leagues: [],
    seasons: [],
    notifications: [],
    notificationsShouldFail: false,
    entriesVoidShouldFail: false,
    picksVoidShouldFail: false,
    potPrizesWriteShouldFail: false,
    ...overrides,
  }
}

// deno-lint-ignore no-explicit-any
let fakeIdCounter = 1

function queryBuilder(
  getRows: () => any[],
  embedGameEntryPick5FromDb?: FakeDb,
  insertShouldFail?: () => boolean,
  updateShouldFail?: (patch: Record<string, unknown>) => boolean
) {
  // deno-lint-ignore no-explicit-any
  const filters: ((row: any) => boolean)[] = []
  let orderSpec: { col: string; ascending: boolean } | null = null
  let limitCount: number | null = null

  // deno-lint-ignore no-explicit-any
  function resolveRows(): any[] {
    let rows = getRows().filter((row) => filters.every((f) => f(row)))
    if (embedGameEntryPick5FromDb) {
      rows = rows.map((row) => ({
        ...row,
        game_entry_pick5: embedGameEntryPick5FromDb.gameEntryPick5
          .filter((p) => p.game_entry_id === row.id)
          .map((p) => ({ picks_won: p.picks_won })),
      }))
    }
    if (orderSpec) {
      const { col, ascending } = orderSpec
      rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (ascending ? 1 : -1))
    }
    if (limitCount !== null) {
      rows = rows.slice(0, limitCount)
    }
    return rows
  }

  // deno-lint-ignore no-explicit-any
  const builder: any = {
    select: (_cols?: string) => builder,
    eq: (col: string, val: unknown) => {
      filters.push((row) => row[col] === val)
      return builder
    },
    is: (col: string, val: unknown) => {
      filters.push((row) => row[col] === val)
      return builder
    },
    not: (col: string, op: string, val: unknown) => {
      if (op !== 'is') throw new Error(`Fake queryBuilder.not() only supports 'is', got: ${op}`)
      filters.push((row) => row[col] !== val)
      return builder
    },
    in: (col: string, vals: unknown[]) => {
      const set = new Set(vals)
      filters.push((row) => set.has(row[col]))
      return builder
    },
    order: (col: string, opts?: { ascending?: boolean }) => {
      orderSpec = { col, ascending: opts?.ascending ?? true }
      return builder
    },
    limit: (n: number) => {
      limitCount = n
      return builder
    },
    maybeSingle: () => {
      const rows = resolveRows()
      if (rows.length > 1) {
        throw new Error('Fake queryBuilder.maybeSingle() matched more than one row')
      }
      return Promise.resolve({ data: rows[0] ?? null, error: null })
    },
    single: () => {
      const rows = resolveRows()
      if (rows.length !== 1) {
        return Promise.resolve({
          data: null,
          error: { message: `Fake queryBuilder.single() expected exactly 1 row, got ${rows.length}` },
        })
      }
      return Promise.resolve({ data: rows[0], error: null })
    },
    // deno-lint-ignore no-explicit-any
    // deno-lint-ignore no-explicit-any
    insert: (rowOrRows: Record<string, unknown> | Record<string, unknown>[]) => {
      if (insertShouldFail?.()) {
        return Promise.resolve({ data: null, error: { message: 'Fake queryBuilder.insert() simulated failure' } })
      }
      // Real supabase-js accepts either a single object or an array — this
      // codebase uses both shapes (e.g. get-or-create-pick5-entry inserts a
      // single object; generateStandings() inserts an array).
      const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
      const table = getRows()
      for (const row of rows) {
        table.push({ id: fakeIdCounter++, ...row })
      }
      return Promise.resolve({ data: rows, error: null })
    },
    // deno-lint-ignore no-explicit-any
    then: (resolve: (v: { data: any; error: null }) => void) => {
      resolve({ data: resolveRows(), error: null })
    },
    // deno-lint-ignore no-explicit-any
    update: (patch: Record<string, unknown>) => {
      // Supports both .update(patch).in(col, vals) and
      // .update(patch).eq(a, x).eq(b, y).eq(c, z) — awardPrize()'s payout
      // write filters by three separate .eq() calls, not a single .in(),
      // unlike every earlier update call in this codebase.
      // deno-lint-ignore no-explicit-any
      const updateFilters: ((row: any) => boolean)[] = []
      // deno-lint-ignore no-explicit-any
      const updateBuilder: any = {
        eq: (col: string, val: unknown) => {
          updateFilters.push((row) => row[col] === val)
          return updateBuilder
        },
        in: (col: string, vals: unknown[]) => {
          const set = new Set(vals)
          updateFilters.push((row) => set.has(row[col]))
          return updateBuilder
        },
        then: (resolve: (v: { data: null; error: { message: string } | null }) => void) => {
          if (updateShouldFail?.(patch)) {
            resolve({ data: null, error: { message: 'Fake queryBuilder.update() simulated failure' } })
            return
          }
          for (const row of getRows()) {
            if (updateFilters.every((f) => f(row))) Object.assign(row, patch)
          }
          resolve({ data: null, error: null })
        },
      }
      return updateBuilder
    },
    // deno-lint-ignore no-explicit-any
    upsert: (rows: Record<string, unknown>[], opts: { onConflict: string }) => {
      // Only ever called with onConflict: 'id' or another real, non-partial
      // unique/PK column in this codebase (see engine.ts's
      // upsertStandingsGroup() comment for why pot_standings_snapshots
      // specifically never upserts against its two partial unique indexes
      // directly) — plain column-equality matching is correct here.
      const conflictCols = opts.onConflict.split(',')
      const table = getRows()
      for (const row of rows) {
        const existing = table.find((r) => conflictCols.every((c) => r[c] === row[c]))
        if (existing) Object.assign(existing, row)
        else table.push({ ...row })
      }
      return Promise.resolve({ data: rows, error: null })
    },
  }
  return builder
}

function fakeDbContext(db: FakeDb, now: () => Date = () => new Date('2026-08-05T12:00:00Z')): GameEngineContext {
  const fakeSupabase = {
    from(table: string) {
      switch (table) {
        case 'pots':
          // Product rule revision, 2026-08-09: a real, mutable table (see
          // FakeDb.pots's own comment) — supports getPick5PotIds()'s
          // game_type filter and the fee-config lookup exactly as the old
          // computed view did, plus createPick5RolloverPot()'s insert and
          // its rollover_source_pot_id idempotency lookup, which a
          // per-query-computed view could never support (an insert into a
          // fresh array every call is thrown away immediately).
          return queryBuilder(() => db.pots)
        case 'game_entries':
          return queryBuilder(() => db.gameEntries, db, undefined, (patch) => db.entriesVoidShouldFail === true && patch.status === 'void')
        case 'entry_payments':
          return queryBuilder(() => db.entryPayments)
        case 'pick5_picks':
          return queryBuilder(() => db.pick5Picks, undefined, undefined, () => db.picksVoidShouldFail === true)
        case 'game_entry_pick5':
          return queryBuilder(() => db.gameEntryPick5)
        case 'pot_standings_snapshots':
          return queryBuilder(() => db.potStandingsSnapshots)
        case 'pot_prizes':
          return queryBuilder(
            () => db.potPrizes,
            undefined,
            () => db.potPrizesWriteShouldFail === true,
            () => db.potPrizesWriteShouldFail === true
          )
        case 'gameweeks':
          return queryBuilder(() => db.gameweeks)
        case 'leagues':
          return queryBuilder(() => db.leagues)
        case 'seasons':
          return queryBuilder(() => db.seasons)
        case 'notifications':
          return queryBuilder(() => db.notifications, undefined, () => db.notificationsShouldFail)
        default:
          throw new Error(`Unexpected table in test fake: ${table}`)
      }
    },
  }
  return { supabase: fakeSupabase as unknown as GameEngineContext['supabase'], now }
}

Deno.test('settle marks a paid entry settled with a settled_at timestamp', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    gameEntries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', gameweek_id: 4, status: 'locked', settled_at: null }],
    entryPayments: [{ pot_id: 'pot-1', user_id: 'user-1', gameweek_id: 4, scope: 'gameweek', is_paid: true }],
  })
  const ctx = fakeDbContext(db)

  await engine.settle(ctx, 4)

  assertEquals(db.gameEntries[0].status, 'settled')
  assertEquals(db.gameEntries[0].settled_at, '2026-08-05T12:00:00.000Z')
})

Deno.test('settle voids an unpaid entry and its picks', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    gameEntries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', gameweek_id: 4, status: 'locked', settled_at: null }],
    entryPayments: [{ pot_id: 'pot-1', user_id: 'user-1', gameweek_id: 4, scope: 'gameweek', is_paid: false }],
    pick5Picks: [
      { id: 1, game_entry_id: 'entry-1', result: 'won' },
      { id: 2, game_entry_id: 'entry-1', result: 'lost' },
    ],
  })
  const ctx = fakeDbContext(db)

  await engine.settle(ctx, 4)

  assertEquals(db.gameEntries[0].status, 'void')
  assertEquals(db.gameEntries[0].settled_at, null, 'a voided entry is never marked settled')
  assertEquals(db.pick5Picks[0].result, 'void')
  assertEquals(db.pick5Picks[1].result, 'void')
})

// --- settle() partial-write retry-safety (hardening sprint, 2026-08-06) ---
// The architecture review found that voiding entries BEFORE voiding their
// picks meant a failure on the picks write left the entry permanently
// 'void' with un-voided picks and no way to retry (the entries query
// selects by status='locked', which a voided entry no longer matches).
// Fixed by voiding picks first. These tests prove the fix from both angles.

Deno.test('settle: if voiding picks fails, the entry is untouched and stays retryable', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    gameEntries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', gameweek_id: 4, status: 'locked', settled_at: null }],
    entryPayments: [{ pot_id: 'pot-1', user_id: 'user-1', gameweek_id: 4, scope: 'gameweek', is_paid: false }],
    pick5Picks: [{ id: 1, game_entry_id: 'entry-1', result: 'won' }],
  })
  db.picksVoidShouldFail = true

  await assertRejects(() => engine.settle(fakeDbContext(db), 4))

  assertEquals(db.gameEntries[0].status, 'locked', 'the entry was never touched — still selectable by a retry')
  assertEquals(db.pick5Picks[0].result, 'won', 'the pick write itself failed, so it is unchanged')

  // Retry: same call, this time the write succeeds.
  db.picksVoidShouldFail = false
  await engine.settle(fakeDbContext(db), 4)
  assertEquals(db.gameEntries[0].status, 'void')
  assertEquals(db.pick5Picks[0].result, 'void')
})

Deno.test('settle: if voiding the entry fails after its picks were already voided, a retry still finds and finishes it', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    gameEntries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', gameweek_id: 4, status: 'locked', settled_at: null }],
    entryPayments: [{ pot_id: 'pot-1', user_id: 'user-1', gameweek_id: 4, scope: 'gameweek', is_paid: false }],
    pick5Picks: [{ id: 1, game_entry_id: 'entry-1', result: 'won' }],
  })
  db.entriesVoidShouldFail = true

  await assertRejects(() => engine.settle(fakeDbContext(db), 4))

  // The picks write (which now runs first) already succeeded and durably
  // stuck, even though the overall call failed and threw.
  assertEquals(db.pick5Picks[0].result, 'void')
  assertEquals(db.gameEntries[0].status, 'locked', 'still locked — this is the property that makes the retry below possible')

  // This is the actual bug the review found: with the OLD write order
  // (entries first), this entry would now be permanently 'void' with an
  // un-voided pick, and this retry would silently find nothing to do
  // (status='locked' no longer matches it). With the fix, it's still
  // 'locked', so the retry correctly finds it, re-voids its (already-void)
  // picks harmlessly, and this time succeeds in voiding the entry too.
  db.entriesVoidShouldFail = false
  await engine.settle(fakeDbContext(db), 4)
  assertEquals(db.gameEntries[0].status, 'void')
  assertEquals(db.pick5Picks[0].result, 'void')
})

Deno.test('settle voids an entry with no entry_payments row at all (defaults to unpaid)', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    gameEntries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', gameweek_id: 4, status: 'locked', settled_at: null }],
    // no entry_payments row at all — must default to "unpaid", not throw or skip
    pick5Picks: [{ id: 1, game_entry_id: 'entry-1', result: 'won' }],
  })
  const ctx = fakeDbContext(db)

  await engine.settle(ctx, 4)

  assertEquals(db.gameEntries[0].status, 'void')
  assertEquals(db.pick5Picks[0].result, 'void')
})

Deno.test('settle handles a mix of paid and unpaid entries independently and correctly', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    gameEntries: [
      { id: 'entry-paid', pot_id: 'pot-1', user_id: 'user-paid', gameweek_id: 4, status: 'locked', settled_at: null },
      { id: 'entry-unpaid', pot_id: 'pot-1', user_id: 'user-unpaid', gameweek_id: 4, status: 'locked', settled_at: null },
    ],
    entryPayments: [
      { pot_id: 'pot-1', user_id: 'user-paid', gameweek_id: 4, scope: 'gameweek', is_paid: true },
      { pot_id: 'pot-1', user_id: 'user-unpaid', gameweek_id: 4, scope: 'gameweek', is_paid: false },
    ],
  })
  const ctx = fakeDbContext(db)

  await engine.settle(ctx, 4)

  assertEquals(db.gameEntries.find((e) => e.id === 'entry-paid')?.status, 'settled')
  assertEquals(db.gameEntries.find((e) => e.id === 'entry-unpaid')?.status, 'void')
})

Deno.test('settle never touches an entry that is not locked', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    gameEntries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', gameweek_id: 4, status: 'pending', settled_at: null }],
    entryPayments: [{ pot_id: 'pot-1', user_id: 'user-1', gameweek_id: 4, scope: 'gameweek', is_paid: true }],
  })
  const ctx = fakeDbContext(db)

  await engine.settle(ctx, 4)

  assertEquals(db.gameEntries[0].status, 'pending', 'a non-locked entry must be left exactly as-is')
})

Deno.test('settle never touches entries belonging to a non-pick5 pot', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-pick5'],
    gameEntries: [{ id: 'entry-1', pot_id: 'pot-other-mode', user_id: 'user-1', gameweek_id: 4, status: 'locked', settled_at: null }],
    entryPayments: [{ pot_id: 'pot-other-mode', user_id: 'user-1', gameweek_id: 4, scope: 'gameweek', is_paid: true }],
  })
  const ctx = fakeDbContext(db)

  await engine.settle(ctx, 4)

  assertEquals(db.gameEntries[0].status, 'locked')
})

Deno.test('settle is a no-op when there are no pick5 pots', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    gameEntries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', gameweek_id: 4, status: 'locked', settled_at: null }],
  })
  const ctx = fakeDbContext(db)

  await engine.settle(ctx, 4)

  assertEquals(db.gameEntries[0].status, 'locked')
})

Deno.test('settle is a no-op when there are no locked entries for the gameweek', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({ pick5PotIds: ['pot-1'] })
  const ctx = fakeDbContext(db)

  // Must not throw even though there's nothing to settle.
  await engine.settle(ctx, 4)

  assertEquals(db.gameEntries.length, 0)
})

Deno.test('settle writes gameweek AND overall pot_standings_snapshots after settling', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    gameEntries: [
      { id: 'entry-a', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'locked', settled_at: null },
      { id: 'entry-b', pot_id: 'pot-1', user_id: 'user-b', gameweek_id: 4, status: 'locked', settled_at: null },
    ],
    entryPayments: [
      { pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, scope: 'gameweek', is_paid: true },
      { pot_id: 'pot-1', user_id: 'user-b', gameweek_id: 4, scope: 'gameweek', is_paid: true },
    ],
    gameEntryPick5: [
      { game_entry_id: 'entry-a', picks_won: 3 },
      { game_entry_id: 'entry-b', picks_won: 1 },
    ],
  })
  const ctx = fakeDbContext(db)

  await engine.settle(ctx, 4)

  // Proves settle() actually invoked generateStandings() itself, not just
  // that generateStandings() works when called directly — the whole point
  // of this test, per the fake's own header comment.
  const gwRows = db.potStandingsSnapshots.filter((r) => r.gameweek_id === 4)
  assertEquals(gwRows.length, 2)
  assertEquals(gwRows.find((r) => r.user_id === 'user-a')?.rank, 1)
  assertEquals(gwRows.find((r) => r.user_id === 'user-b')?.rank, 2)

  const overallRows = db.potStandingsSnapshots.filter((r) => r.gameweek_id === null)
  assertEquals(overallRows.length, 2)
  assertEquals(overallRows.find((r) => r.user_id === 'user-a')?.score, 3)
})

Deno.test('settle does not call generateStandings for a pot with no entries this gameweek', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1', 'pot-2'],
    gameEntries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', gameweek_id: 4, status: 'locked', settled_at: null }],
    entryPayments: [{ pot_id: 'pot-1', user_id: 'user-1', gameweek_id: 4, scope: 'gameweek', is_paid: true }],
  })
  const ctx = fakeDbContext(db)

  await engine.settle(ctx, 4)

  assertEquals(
    db.potStandingsSnapshots.every((r) => r.pot_id === 'pot-1'),
    true,
    'pot-2 had no entries in this settle() call and must not appear in the snapshots at all'
  )
})

Deno.test('settle isolates one pot\'s awardPrize failure so other pots in the same gameweek still get standings and prizes', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-bad', 'pot-good'],
    potFeeConfig: {
      // admin fee (20) exceeds gross (entry_fee 10 x 1 entry = 10) -> Pick5PrizePoolExceededError
      'pot-bad': { entry_fee: 10, admin_fee_type: 'fixed', admin_fee_amount: 20 },
      'pot-good': { entry_fee: 10 },
    },
    gameEntries: [
      { id: 'entry-bad', pot_id: 'pot-bad', user_id: 'user-bad', gameweek_id: 4, status: 'locked', settled_at: null },
      { id: 'entry-good', pot_id: 'pot-good', user_id: 'user-good', gameweek_id: 4, status: 'locked', settled_at: null },
    ],
    entryPayments: [
      { pot_id: 'pot-bad', user_id: 'user-bad', gameweek_id: 4, scope: 'gameweek', is_paid: true },
      { pot_id: 'pot-good', user_id: 'user-good', gameweek_id: 4, scope: 'gameweek', is_paid: true },
    ],
  })
  const ctx = fakeDbContext(db)

  await assertRejects(() => engine.settle(ctx, 4), Error, 'pot-bad')

  assertEquals(
    db.potPrizes.some((p) => p.pot_id === 'pot-good'),
    true,
    'the unrelated, correctly-configured pot must still be awarded despite pot-bad failing'
  )
  assertEquals(
    db.potPrizes.some((p) => p.pot_id === 'pot-bad'),
    false,
    'the misconfigured pot correctly has no prize row — its own pre-check already prevented that write'
  )
  assertEquals(
    db.potStandingsSnapshots.some((s) => s.pot_id === 'pot-good'),
    true,
    'the unrelated pot\'s standings must still be generated'
  )
  assertEquals(
    db.gameEntries.find((e) => e.id === 'entry-good')?.status,
    'settled',
    'entry finalization (voiding/settling) for both pots already happened before the per-pot loop and is unaffected either way'
  )
})

// --- generateStandings() (direct calls, not via settle()) -----------------

Deno.test('generateStandings ranks by cumulative picks_won, ties sharing a rank (ISSUE-17)', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    gameEntries: [
      { id: 'e1', pot_id: 'pot-1', user_id: 'user-1st', gameweek_id: 4, status: 'settled', settled_at: 'x' },
      { id: 'e2', pot_id: 'pot-1', user_id: 'user-tied-a', gameweek_id: 4, status: 'settled', settled_at: 'x' },
      { id: 'e3', pot_id: 'pot-1', user_id: 'user-tied-b', gameweek_id: 4, status: 'settled', settled_at: 'x' },
      { id: 'e4', pot_id: 'pot-1', user_id: 'user-last', gameweek_id: 4, status: 'settled', settled_at: 'x' },
    ],
    gameEntryPick5: [
      { game_entry_id: 'e1', picks_won: 5 },
      { game_entry_id: 'e2', picks_won: 3 },
      { game_entry_id: 'e3', picks_won: 3 },
      { game_entry_id: 'e4', picks_won: 1 },
    ],
  })
  const ctx = fakeDbContext(db)

  const result = await engine.generateStandings(ctx, 'pot-1')

  const byUser = (id: string) => result.find((r) => r.userId === id && r.gameweekId === 4)
  assertEquals(byUser('user-1st')?.rank, 1)
  assertEquals(byUser('user-tied-a')?.rank, 2)
  assertEquals(byUser('user-tied-b')?.rank, 2, 'ties share a rank — no tiebreak, per the repo owner\'s decision')
  assertEquals(byUser('user-last')?.rank, 4, 'the rank after a 2-way tie skips ahead (standard competition ranking)')
})

Deno.test('generateStandings excludes void entries entirely from the leaderboard', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    gameEntries: [
      { id: 'e1', pot_id: 'pot-1', user_id: 'user-settled', gameweek_id: 4, status: 'settled', settled_at: 'x' },
      { id: 'e2', pot_id: 'pot-1', user_id: 'user-void', gameweek_id: 4, status: 'void', settled_at: null },
    ],
    gameEntryPick5: [
      { game_entry_id: 'e1', picks_won: 1 },
      { game_entry_id: 'e2', picks_won: 5 }, // would rank 1st on picks alone — must not appear at all
    ],
  })
  const ctx = fakeDbContext(db)

  const result = await engine.generateStandings(ctx, 'pot-1')

  assertEquals(result.some((r) => r.userId === 'user-void'), false)
  assertEquals(result.find((r) => r.userId === 'user-settled')?.rank, 1)
})

Deno.test('generateStandings computes the overall row as the sum across every settled gameweek', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    gameEntries: [
      { id: 'e1', pot_id: 'pot-1', user_id: 'user-1', gameweek_id: 4, status: 'settled', settled_at: 'x' },
      { id: 'e2', pot_id: 'pot-1', user_id: 'user-1', gameweek_id: 5, status: 'settled', settled_at: 'x' },
    ],
    gameEntryPick5: [
      { game_entry_id: 'e1', picks_won: 2 },
      { game_entry_id: 'e2', picks_won: 3 },
    ],
  })
  const ctx = fakeDbContext(db)

  const result = await engine.generateStandings(ctx, 'pot-1')

  const overall = result.find((r) => r.userId === 'user-1' && r.gameweekId === null)
  assertEquals(overall?.score, 5)
  const gw4 = result.find((r) => r.userId === 'user-1' && r.gameweekId === 4)
  assertEquals(gw4?.score, 2, 'the per-gameweek row must still show just that gameweek\'s score, not the cumulative total')
})

Deno.test('generateStandings is idempotent — a second call updates rows in place rather than duplicating them', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    gameEntries: [{ id: 'e1', pot_id: 'pot-1', user_id: 'user-1', gameweek_id: 4, status: 'settled', settled_at: 'x' }],
    gameEntryPick5: [{ game_entry_id: 'e1', picks_won: 2 }],
  })
  const ctx = fakeDbContext(db)

  await engine.generateStandings(ctx, 'pot-1')
  await engine.generateStandings(ctx, 'pot-1')

  assertEquals(db.potStandingsSnapshots.length, 2, 'one gameweek row + one overall row, not four')
})

Deno.test('generateStandings returns an empty array and writes nothing when the pot has no settled entries', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb()
  const ctx = fakeDbContext(db)

  const result = await engine.generateStandings(ctx, 'pot-1')

  assertEquals(result, [])
  assertEquals(db.potStandingsSnapshots.length, 0)
})

// --- determineWinner() -----------------------------------------------------

// Product rule revision, 2026-08-09 (docs/decisions.md § Pick 5 jackpot
// and season rollover): a winner is now whoever scored EXACTLY
// PICK5_PICK_COUNT (5/5), not merely rank 1 — every test below reflects
// that. The rank-1-with-a-tie-break mechanics (ISSUE-17) are unchanged
// and still exercised (rankWithTies() itself isn't touched by this
// revision), just no longer conflated with "winning."

Deno.test('determineWinner returns the user who scored exactly 5/5, not merely the best score of the week', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    potStandingsSnapshots: [
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT },
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-b', rank: 2, score: 1 },
    ],
  })
  const ctx = fakeDbContext(db)

  const winners = await engine.determineWinner(ctx, 'pot-1')

  assertEquals(winners, ['user-a'])
})

Deno.test('determineWinner returns an empty array when the week\'s best score is rank 1 but not 5/5 — nobody wins a merely-good week', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    potStandingsSnapshots: [
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: 4 },
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-b', rank: 2, score: 3 },
    ],
  })
  const ctx = fakeDbContext(db)

  const winners = await engine.determineWinner(ctx, 'pot-1')

  assertEquals(winners, [])
})

Deno.test('determineWinner returns every simultaneous 5/5 achiever, not just one', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    potStandingsSnapshots: [
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT },
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-b', rank: 1, score: PICK5_PICK_COUNT },
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-c', rank: 3, score: 3 },
    ],
  })
  const ctx = fakeDbContext(db)

  const winners = await engine.determineWinner(ctx, 'pot-1')

  assertEquals(new Set(winners), new Set(['user-a', 'user-b']))
  assertEquals(winners.length, 2)
})

Deno.test('determineWinner uses only the most recent gameweek, not every gameweek\'s 5/5s', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    potStandingsSnapshots: [
      // An earlier gameweek's winner must not leak into this gameweek's result.
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-old-winner', rank: 1, score: PICK5_PICK_COUNT },
      { pot_id: 'pot-1', gameweek_id: 5, user_id: 'user-old-winner', rank: 2, score: 1 },
      { pot_id: 'pot-1', gameweek_id: 5, user_id: 'user-new-winner', rank: 1, score: PICK5_PICK_COUNT },
    ],
  })
  const ctx = fakeDbContext(db)

  const winners = await engine.determineWinner(ctx, 'pot-1')

  assertEquals(winners, ['user-new-winner'])
})

Deno.test('determineWinner ignores the overall (gameweek_id: null) row when finding the most recent gameweek', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    potStandingsSnapshots: [
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT },
      // The overall row has the same rank/score shape but gameweek_id: null —
      // must never be mistaken for "the latest gameweek."
      { pot_id: 'pot-1', gameweek_id: null, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT },
    ],
  })
  const ctx = fakeDbContext(db)

  const winners = await engine.determineWinner(ctx, 'pot-1')

  assertEquals(winners, ['user-a'])
})

Deno.test('determineWinner scopes strictly to the given pot', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    potStandingsSnapshots: [
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT },
      { pot_id: 'pot-2', gameweek_id: 4, user_id: 'user-b', rank: 1, score: PICK5_PICK_COUNT },
    ],
  })
  const ctx = fakeDbContext(db)

  const winners = await engine.determineWinner(ctx, 'pot-1')

  assertEquals(winners, ['user-a'])
})

Deno.test('determineWinner returns an empty array when the pot has no standings at all', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb()
  const ctx = fakeDbContext(db)

  const winners = await engine.determineWinner(ctx, 'pot-1')

  assertEquals(winners, [])
})

// --- awardPrize() -----------------------------------------------------

Deno.test('awardPrize computes gross = entry_fee x settled count and awards the sole 5/5 winner the full net', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    potFeeConfig: { 'pot-1': { entry_fee: 10 } }, // no deductions configured
    gameEntries: [
      { id: 'entry-a', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' },
      { id: 'entry-b', pot_id: 'pot-1', user_id: 'user-b', gameweek_id: 4, status: 'settled', settled_at: 'x' },
    ],
    potStandingsSnapshots: [
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT },
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-b', rank: 2, score: 1 },
    ],
  })
  const ctx = fakeDbContext(db)

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.potPrizes.length, 1)
  assertEquals(db.potPrizes[0].gross_amount, 20) // 10 x 2 settled entries, no carry-in
  assertEquals(db.potPrizes[0].admin_fee_amount, 0)
  assertEquals(db.potPrizes[0].charity_fee_amount, 0)
  assertEquals(db.potPrizes[0].is_settled, true)
  assertEquals(db.potPrizes[0].rollover, false, 'a real winner resets the jackpot, not a rollover')
  assertEquals(db.gameEntries.find((e) => e.user_id === 'user-a')?.payout_amount, 20)
  assertEquals(db.gameEntries.find((e) => e.user_id === 'user-b')?.payout_amount, undefined, 'only the winner gets a payout')
})

Deno.test('awardPrize applies a fixed admin fee correctly', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    potFeeConfig: { 'pot-1': { entry_fee: 10, admin_fee_type: 'fixed', admin_fee_amount: 5 } },
    gameEntries: [{ id: 'entry-a', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' }],
    potStandingsSnapshots: [{ pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT }],
  })
  const ctx = fakeDbContext(db)

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.potPrizes[0].gross_amount, 10)
  assertEquals(db.potPrizes[0].admin_fee_amount, 5)
  assertEquals(db.gameEntries[0].payout_amount, 5) // net = 10 - 5
})

Deno.test('awardPrize applies a percentage charity fee correctly', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    potFeeConfig: { 'pot-1': { entry_fee: 20, charity_fee_type: 'percentage', charity_fee_percentage: 15 } },
    gameEntries: [
      { id: 'entry-a', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' },
      { id: 'entry-b', pot_id: 'pot-1', user_id: 'user-b', gameweek_id: 4, status: 'settled', settled_at: 'x' },
    ],
    potStandingsSnapshots: [
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT },
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-b', rank: 2, score: 1 },
    ],
  })
  const ctx = fakeDbContext(db)

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.potPrizes[0].gross_amount, 40) // 20 x 2
  assertEquals(db.potPrizes[0].charity_fee_amount, 6) // 15% of 40
  assertEquals(db.gameEntries.find((e) => e.user_id === 'user-a')?.payout_amount, 34) // 40 - 6
})

Deno.test('awardPrize applies both admin fee (fixed) and charity fee (percentage) together', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    potFeeConfig: {
      'pot-1': {
        entry_fee: 25,
        admin_fee_type: 'fixed',
        admin_fee_amount: 25,
        charity_fee_type: 'percentage',
        charity_fee_percentage: 5,
      },
    },
    gameEntries: [
      { id: 'entry-a', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' },
      { id: 'entry-b', pot_id: 'pot-1', user_id: 'user-b', gameweek_id: 4, status: 'settled', settled_at: 'x' },
      { id: 'entry-c', pot_id: 'pot-1', user_id: 'user-c', gameweek_id: 4, status: 'settled', settled_at: 'x' },
      { id: 'entry-d', pot_id: 'pot-1', user_id: 'user-d', gameweek_id: 4, status: 'settled', settled_at: 'x' },
    ],
    potStandingsSnapshots: [
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT },
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-b', rank: 2, score: 2 },
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-c', rank: 3, score: 1 },
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-d', rank: 3, score: 1 },
    ],
  })
  const ctx = fakeDbContext(db)

  await engine.awardPrize(ctx, 'pot-1')

  // gross = 25 x 4 = 100; admin fee = 25 (fixed); charity fee = 5% of 100 = 5; net = 70
  assertEquals(db.potPrizes[0].gross_amount, 100)
  assertEquals(db.potPrizes[0].admin_fee_amount, 25)
  assertEquals(db.potPrizes[0].charity_fee_amount, 5)
  assertEquals(db.gameEntries.find((e) => e.user_id === 'user-a')?.payout_amount, 70)
})

Deno.test('awardPrize splits an evenly-dividing net pool equally across multiple simultaneous 5/5 winners', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    potFeeConfig: { 'pot-1': { entry_fee: 10.01 } },
    gameEntries: [
      { id: 'entry-a', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' },
      { id: 'entry-b', pot_id: 'pot-1', user_id: 'user-b', gameweek_id: 4, status: 'settled', settled_at: 'x' },
      { id: 'entry-c', pot_id: 'pot-1', user_id: 'user-c', gameweek_id: 4, status: 'settled', settled_at: 'x' },
    ],
    potStandingsSnapshots: [
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT },
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-b', rank: 1, score: PICK5_PICK_COUNT },
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-c', rank: 1, score: PICK5_PICK_COUNT },
    ],
  })
  const ctx = fakeDbContext(db)

  await engine.awardPrize(ctx, 'pot-1')

  // gross = net = 10.01 x 3 = 30.03; divides evenly, 10.01 each, zero remainder.
  assertEquals(db.potPrizes[0].gross_amount, 30.03)
  const payouts = ['user-a', 'user-b', 'user-c'].map((u) => db.gameEntries.find((e) => e.user_id === u)?.payout_amount)
  assertEquals(payouts, [10.01, 10.01, 10.01])
})

Deno.test('awardPrize floors an unevenly-dividing net split (the actual remainder case)', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    // entry_fee 10, admin fee fixed 1 -> net 29 split 3 ways = 9.666... -> 9.66 each, 0.02 unallocated
    potFeeConfig: { 'pot-1': { entry_fee: 10, admin_fee_type: 'fixed', admin_fee_amount: 1 } },
    gameEntries: [
      { id: 'entry-a', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' },
      { id: 'entry-b', pot_id: 'pot-1', user_id: 'user-b', gameweek_id: 4, status: 'settled', settled_at: 'x' },
      { id: 'entry-c', pot_id: 'pot-1', user_id: 'user-c', gameweek_id: 4, status: 'settled', settled_at: 'x' },
    ],
    potStandingsSnapshots: [
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT },
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-b', rank: 1, score: PICK5_PICK_COUNT },
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-c', rank: 1, score: PICK5_PICK_COUNT },
    ],
  })
  const ctx = fakeDbContext(db)

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.potPrizes[0].gross_amount, 30)
  assertEquals(db.potPrizes[0].admin_fee_amount, 1)
  const payouts = ['user-a', 'user-b', 'user-c'].map((u) => db.gameEntries.find((e) => e.user_id === u)?.payout_amount)
  assertEquals(payouts, [9.66, 9.66, 9.66], 'floor(29/3) = 9.66 each; the leftover 0.02 is paid to no one')
})

// Product rule revision, 2026-08-09 (docs/decisions.md § Pick 5 jackpot
// and season rollover) — replaces the old "throws Pick5NoEligibleWinnersError"
// test: zero winners is now the normal case, not an error.
Deno.test('awardPrize does not throw, pays nobody, and marks the week rollover=true when nobody hits 5/5', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    potFeeConfig: { 'pot-1': { entry_fee: 10 } },
    gameEntries: [{ id: 'entry-a', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' }],
    potStandingsSnapshots: [{ pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: 3 }],
    // No gameweeks row for this pot's league/season — isFinalGameweekOfSeason()
    // correctly finds no match (id !== undefined) and returns false, so this
    // stays a mid-season carry, not a season-end rollover-pot trigger.
  })
  const ctx = fakeDbContext(db)

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.potPrizes.length, 1)
  assertEquals(db.potPrizes[0].gross_amount, 10, 'this week\'s own fresh gross, no carry-in yet')
  assertEquals(db.potPrizes[0].is_settled, true)
  assertEquals(db.potPrizes[0].rollover, true)
  assertEquals(db.gameEntries[0].payout_amount, undefined, 'nobody hit 5/5, nobody is paid')
  assertEquals(db.pots.filter((p) => p.rollover_source_pot_id === 'pot-1').length, 0, 'not the season\'s final gameweek — no rollover pot created')
})

Deno.test('awardPrize throws Pick5PrizePoolExceededError and writes nothing when fees exceed the gross pool', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    // gross = 10 x 1 = 10; admin fee 8 (fixed) + charity fee 5 (fixed) = 13 > gross
    potFeeConfig: {
      'pot-1': { entry_fee: 10, admin_fee_type: 'fixed', admin_fee_amount: 8, charity_fee_type: 'fixed', charity_fee_amount: 5 },
    },
    gameEntries: [{ id: 'entry-a', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' }],
    potStandingsSnapshots: [{ pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT }],
  })
  const ctx = fakeDbContext(db)

  await assertRejects(() => engine.awardPrize(ctx, 'pot-1'), Pick5PrizePoolExceededError)
  assertEquals(db.potPrizes.length, 0, 'no pot_prizes row should be written when the calculation is rejected')
  assertEquals(db.gameEntries[0].payout_amount, undefined)
})

Deno.test('awardPrize is idempotent — a second call against an already-settled prize is a safe no-op (winner case)', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    potFeeConfig: { 'pot-1': { entry_fee: 10 } },
    gameEntries: [{ id: 'entry-a', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' }],
    potStandingsSnapshots: [{ pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT }],
  })
  const ctx = fakeDbContext(db)

  await engine.awardPrize(ctx, 'pot-1')
  assertEquals(db.potPrizes.length, 1)
  const firstPrizeId = db.potPrizes[0].id
  assertEquals(db.gameEntries[0].payout_amount, 10)

  // Mutate the underlying entries as if something changed — a real re-run
  // must NOT recompute or overwrite an already-settled prize.
  db.gameEntries[0].payout_amount = undefined
  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.potPrizes.length, 1, 'must not create a second pot_prizes row')
  assertEquals(db.potPrizes[0].id, firstPrizeId)
  assertEquals(db.gameEntries[0].payout_amount, undefined, 'a no-op does not re-write the payout either')
})

Deno.test('awardPrize is idempotent — a second call against an already-settled no-winner (rollover) week is also a safe no-op', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    potFeeConfig: { 'pot-1': { entry_fee: 10 } },
    gameEntries: [{ id: 'entry-a', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' }],
    potStandingsSnapshots: [{ pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: 2 }],
  })
  const ctx = fakeDbContext(db)

  await engine.awardPrize(ctx, 'pot-1')
  assertEquals(db.potPrizes.length, 1)
  const firstPrizeId = db.potPrizes[0].id
  const firstGross = db.potPrizes[0].gross_amount

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.potPrizes.length, 1, 'must not create a second pot_prizes row')
  assertEquals(db.potPrizes[0].id, firstPrizeId)
  assertEquals(db.potPrizes[0].gross_amount, firstGross, 'must not recompute/re-carry on a repeat call')
})

// --- Jackpot accumulation (Design A, 2026-08-09) --------------------------
// docs/decisions.md § Pick 5 jackpot and season rollover: an unclaimed
// week's net prize carries into the next gameweek's pool, on top of that
// gameweek's own fresh entry fees, repeating until someone hits 5/5.

Deno.test('awardPrize carries an unclaimed week\'s net prize into the next gameweek as carryIn, added on top of that week\'s own fresh gross', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    potFeeConfig: { 'pot-1': { entry_fee: 10 } },
    gameEntries: [
      { id: 'entry-gw4', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' },
      { id: 'entry-gw5', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 5, status: 'settled', settled_at: 'x' },
    ],
    potStandingsSnapshots: [
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: 3 }, // no 5/5 in GW4
    ],
  })
  const ctx = fakeDbContext(db)

  // GW4 settles first: nobody hit 5/5, gross=10 (1 entry x 10), net=10 carries.
  await engine.awardPrize(ctx, 'pot-1')
  assertEquals(db.potPrizes[0].gross_amount, 10)
  assertEquals(db.potPrizes[0].rollover, true)

  // GW5: another no-winner week. Its own fresh gross is 10 (1 entry), plus
  // the GW4 carry-in of 10 -> gross_amount should be 20, still unclaimed.
  db.potStandingsSnapshots.push({ pot_id: 'pot-1', gameweek_id: 5, user_id: 'user-a', rank: 1, score: 2 })
  await engine.awardPrize(ctx, 'pot-1')

  const gw5Prize = db.potPrizes.find((p) => p.gameweek_id === 5)
  assertEquals(gw5Prize?.gross_amount, 20, 'GW4\'s unclaimed net (10) + GW5\'s own fresh gross (10)')
  assertEquals(gw5Prize?.rollover, true)
})

Deno.test('awardPrize accumulates across THREE consecutive no-winner weeks before a winner claims the full jackpot', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    potFeeConfig: { 'pot-1': { entry_fee: 10 } },
    gameEntries: [
      { id: 'entry-gw4', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' },
      { id: 'entry-gw5', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 5, status: 'settled', settled_at: 'x' },
      { id: 'entry-gw6', pot_id: 'pot-1', user_id: 'user-b', gameweek_id: 6, status: 'settled', settled_at: 'x' },
    ],
    potStandingsSnapshots: [{ pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: 1 }],
  })
  const ctx = fakeDbContext(db)

  await engine.awardPrize(ctx, 'pot-1') // GW4: no winner, gross=net=10 carries

  db.potStandingsSnapshots.push({ pot_id: 'pot-1', gameweek_id: 5, user_id: 'user-a', rank: 1, score: 4 })
  await engine.awardPrize(ctx, 'pot-1') // GW5: no winner, gross = 10(carry) + 10(fresh) = 20 carries

  // GW6: user-b hits 5/5 — should win the FULL accumulated jackpot (30),
  // not just GW6's own 10.
  db.potStandingsSnapshots.push({ pot_id: 'pot-1', gameweek_id: 6, user_id: 'user-b', rank: 1, score: PICK5_PICK_COUNT })
  await engine.awardPrize(ctx, 'pot-1')

  const gw6Prize = db.potPrizes.find((p) => p.gameweek_id === 6)
  assertEquals(gw6Prize?.gross_amount, 30, '10 (GW4) + 10 (GW5) + 10 (GW6) — all three weeks\' entry fees, nobody claimed until now')
  assertEquals(gw6Prize?.rollover, false)
  assertEquals(db.gameEntries.find((e) => e.id === 'entry-gw6')?.payout_amount, 30, 'the winner gets the ENTIRE accumulated jackpot, not just this week\'s own gross')
})

Deno.test('awardPrize resets the jackpot after a winner — the following gameweek starts fresh with only its own entry fees', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    potFeeConfig: { 'pot-1': { entry_fee: 10 } },
    gameEntries: [
      { id: 'entry-gw4', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' },
      { id: 'entry-gw5', pot_id: 'pot-1', user_id: 'user-b', gameweek_id: 5, status: 'settled', settled_at: 'x' },
    ],
    potStandingsSnapshots: [{ pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT }],
  })
  const ctx = fakeDbContext(db)

  await engine.awardPrize(ctx, 'pot-1') // GW4: user-a wins 10, jackpot resets

  db.potStandingsSnapshots.push({ pot_id: 'pot-1', gameweek_id: 5, user_id: 'user-b', rank: 1, score: 3 })
  await engine.awardPrize(ctx, 'pot-1') // GW5: nobody wins — should carry only ITS OWN gross, not GW4's already-claimed money

  const gw5Prize = db.potPrizes.find((p) => p.gameweek_id === 5)
  assertEquals(gw5Prize?.gross_amount, 10, 'GW4 was claimed (rollover=false) — GW5 starts fresh with only its own entry fees')
})

Deno.test('awardPrize applies fees only to this week\'s fresh gross, never re-taxing an already-net carried-forward balance', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    // 10% admin fee — if it were (wrongly) re-applied to the carried balance
    // too, GW5's fee would be 10% of 20 (2), not 10% of GW5's own fresh
    // gross alone (1).
    potFeeConfig: { 'pot-1': { entry_fee: 10, admin_fee_type: 'percentage', admin_fee_percentage: 10 } },
    gameEntries: [
      { id: 'entry-gw4', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' },
      { id: 'entry-gw5', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 5, status: 'settled', settled_at: 'x' },
    ],
    potStandingsSnapshots: [{ pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: 1 }],
  })
  const ctx = fakeDbContext(db)

  await engine.awardPrize(ctx, 'pot-1') // GW4: gross=10, admin fee=1 (10% of 10), net=9 carries
  assertEquals(db.potPrizes[0].admin_fee_amount, 1)
  assertEquals(db.potPrizes[0].gross_amount - db.potPrizes[0].admin_fee_amount, 9)

  db.potStandingsSnapshots.push({ pot_id: 'pot-1', gameweek_id: 5, user_id: 'user-a', rank: 1, score: 2 })
  await engine.awardPrize(ctx, 'pot-1') // GW5: fresh gross=10, carry-in=9 (already net) -> gross_amount stored = 19

  const gw5Prize = db.potPrizes.find((p) => p.gameweek_id === 5)
  assertEquals(gw5Prize?.gross_amount, 19, 'carry-in (9, already net) + GW5\'s own fresh gross (10)')
  assertEquals(gw5Prize?.admin_fee_amount, 1, 'fee is 10% of GW5\'s OWN fresh gross (10) only, not 10% of the combined 19')
})

// --- Season-end rollover (rule 2, 2026-08-09) ------------------------------

Deno.test('awardPrize automatically creates a draft rollover pot in next season\'s league when the season\'s final gameweek has no winner', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    potFeeConfig: {
      'pot-1': { entry_fee: 10, league_id: 1, season_id: 1, name: 'Office Pool', created_by: 'organiser-1' },
    },
    gameEntries: [{ id: 'entry-a', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 38, status: 'settled', settled_at: 'x' }],
    potStandingsSnapshots: [{ pot_id: 'pot-1', gameweek_id: 38, user_id: 'user-a', rank: 1, score: 4 }], // no 5/5
    gameweeks: [
      { id: 4, league_id: 1, season_id: 1, number: 1 },
      { id: 38, league_id: 1, season_id: 1, number: 38 }, // the season's real final gameweek
      // Next season's own calendar — resolveSeasonGameweekBounds() reads
      // these to populate the rollover pot's start/end gameweek.
      { id: 101, league_id: 2, season_id: 2, number: 1 },
      { id: 102, league_id: 2, season_id: 2, number: 2 },
      { id: 138, league_id: 2, season_id: 2, number: 38 },
    ],
    leagues: [
      { id: 1, name: 'Premier League', country: 'England', season_id: 1 },
      { id: 2, name: 'Premier League', country: 'England', season_id: 2 }, // next season, same league
    ],
    seasons: [
      { id: 1, year_start: 2025 },
      { id: 2, year_start: 2026 },
    ],
  })
  const ctx = fakeDbContext(db)

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.potPrizes[0].rollover, true)
  const rolloverPot = db.pots.find((p) => p.rollover_source_pot_id === 'pot-1')
  assertEquals(rolloverPot?.game_type, 'pick5')
  assertEquals(rolloverPot?.status, 'draft', 'created but never auto-activated — the organiser reviews and activates it later')
  assertEquals(rolloverPot?.league_id, 2, 'targets next season\'s matching league, not the same one')
  assertEquals(rolloverPot?.season_id, 2)
  assertEquals(rolloverPot?.carry_over_amount, 10, 'the entire unclaimed jackpot carries to the new pot')
  assertEquals(rolloverPot?.name, 'Office Pool (Rollover #1)')
  assertEquals(rolloverPot?.rollover_generation, 1)
  assertEquals(rolloverPot?.entry_fee, 10, 'fee configuration is copied from the source pot')
  assertEquals(rolloverPot?.start_gameweek_id, 101, 'resolved to next season\'s first gameweek, never left null')
  assertEquals(rolloverPot?.end_gameweek_id, 138, 'resolved to next season\'s final gameweek, never left null')
})

Deno.test('awardPrize does not create a rollover pot mid-season, even with no winner, if the gameweek is not the season\'s final one', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    potFeeConfig: { 'pot-1': { entry_fee: 10, league_id: 1, season_id: 1 } },
    gameEntries: [{ id: 'entry-a', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' }],
    potStandingsSnapshots: [{ pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: 4 }],
    gameweeks: [
      { id: 4, league_id: 1, season_id: 1, number: 4 },
      { id: 38, league_id: 1, season_id: 1, number: 38 }, // a later gameweek exists — GW4 is not the final one
    ],
  })
  const ctx = fakeDbContext(db)

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.potPrizes[0].rollover, true, 'still carries forward like any other no-winner week')
  assertEquals(db.pots.filter((p) => p.rollover_source_pot_id === 'pot-1').length, 0, 'no rollover pot — this was not the season\'s final gameweek')
})

Deno.test('awardPrize\'s rollover-pot creation is idempotent — a retry after a partial failure does not create a duplicate', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    potFeeConfig: { 'pot-1': { entry_fee: 10, league_id: 1, season_id: 1, name: 'Office Pool' } },
    gameEntries: [{ id: 'entry-a', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 38, status: 'settled', settled_at: 'x' }],
    potStandingsSnapshots: [{ pot_id: 'pot-1', gameweek_id: 38, user_id: 'user-a', rank: 1, score: 4 }],
    gameweeks: [{ id: 38, league_id: 1, season_id: 1, number: 38 }],
    leagues: [
      { id: 1, name: 'Premier League', country: 'England', season_id: 1 },
      { id: 2, name: 'Premier League', country: 'England', season_id: 2 },
    ],
    seasons: [
      { id: 1, year_start: 2025 },
      { id: 2, year_start: 2026 },
    ],
    // Simulates a prior attempt that created the rollover pot but failed
    // before reaching the trailing pot_prizes write (the exact partial-
    // failure window the hardening-sprint write-ordering discipline
    // protects) — this gameweek's own pot_prizes row does not exist yet.
    pots: [
      {
        id: 'pot-1',
        game_type: 'pick5',
        status: 'active',
        league_id: 1,
        season_id: 1,
        name: 'Office Pool',
        created_by: 'organiser-1',
        entry_fee: 10,
        admin_fee_type: 'none',
        admin_fee_amount: null,
        admin_fee_percentage: null,
        charity_fee_type: 'none',
        charity_fee_amount: null,
        charity_fee_percentage: null,
        carry_over_amount: 0,
        rollover_generation: 0,
        rollover_source_pot_id: null,
      },
      {
        id: 'pot-1-rollover',
        game_type: 'pick5',
        status: 'draft',
        league_id: 2,
        season_id: 2,
        name: 'Office Pool (Rollover #1)',
        created_by: 'organiser-1',
        entry_fee: 10,
        admin_fee_type: 'none',
        admin_fee_amount: null,
        admin_fee_percentage: null,
        charity_fee_type: 'none',
        charity_fee_amount: null,
        charity_fee_percentage: null,
        carry_over_amount: 10,
        rollover_generation: 1,
        rollover_source_pot_id: 'pot-1',
      },
    ],
  })
  const ctx = fakeDbContext(db)

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.pots.filter((p) => p.rollover_source_pot_id === 'pot-1').length, 1, 'the retry must not create a second rollover pot')
  assertEquals(db.potPrizes.length, 1, 'the retry still finishes the interrupted work — the trailing pot_prizes write')
  assertEquals(db.potPrizes[0].is_settled, true)
})

Deno.test('a freshly-created rollover pot\'s own first gameweek picks up pots.carry_over_amount as its carryIn', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-2'],
    potFeeConfig: { 'pot-2': { entry_fee: 10, carry_over_amount: 50 } }, // e.g. rolled over from last season
    gameEntries: [{ id: 'entry-a', pot_id: 'pot-2', user_id: 'user-a', gameweek_id: 1, status: 'settled', settled_at: 'x' }],
    potStandingsSnapshots: [{ pot_id: 'pot-2', gameweek_id: 1, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT }],
    // No pot_prizes rows exist yet for pot-2 — this really is its first gameweek.
  })
  const ctx = fakeDbContext(db)

  await engine.awardPrize(ctx, 'pot-2')

  assertEquals(db.potPrizes[0].gross_amount, 60, 'carry_over_amount (50) + this gameweek\'s own fresh gross (10)')
  assertEquals(db.gameEntries[0].payout_amount, 60, 'the winner gets the carried-over amount plus this gameweek\'s own prize')
})

// --- awardPrize() partial-write retry-safety (hardening sprint, 2026-08-06) ---
// Same correction already applied to LmsEngine.awardPrize(): the pot_prizes
// write (is_settled=true) now runs LAST, after the payout loop, instead of
// first. Before this fix, a payout failing partway (or the pot_prizes write
// itself failing right after) would leave is_settled permanently true with
// the payout work undone/incomplete and no way to retry — every future call
// would short-circuit at the idempotency check. These tests prove the fix.

Deno.test('awardPrize: if the trailing pot_prizes write fails, the payout already written stays, and a retry finishes cleanly', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    potFeeConfig: { 'pot-1': { entry_fee: 10 } },
    gameEntries: [{ id: 'entry-a', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' }],
    potStandingsSnapshots: [{ pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT }],
  })
  db.potPrizesWriteShouldFail = true
  const ctx = fakeDbContext(db)

  await assertRejects(() => engine.awardPrize(ctx, 'pot-1'))

  assertEquals(db.gameEntries[0].payout_amount, 10, 'the payout already landed before the trailing write failed')
  assertEquals(db.potPrizes.length, 0, 'pot_prizes was never sealed — this is what makes the retry below possible')

  // With the OLD ordering (pot_prizes written FIRST, is_settled=true before
  // any payout), is_settled would already be true at this point, and this
  // retry would incorrectly short-circuit as "already done" — permanently,
  // since nothing would ever un-set it. With the fix, the idempotency check
  // correctly finds no settled prize yet and proceeds.
  db.potPrizesWriteShouldFail = false
  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.potPrizes.length, 1)
  assertEquals(db.potPrizes[0].is_settled, true)
  assertEquals(db.gameEntries[0].payout_amount, 10, 'unchanged by the retry — the same value is safely re-applied')
})

Deno.test('awardPrize: a pot_prizes write failure throws a generic Error, not Pick5PrizePoolExceededError', async () => {
  // Bug found while making the correction above: the update/insert error
  // handlers used to throw Pick5PrizePoolExceededError for ANY write
  // failure, not just the fee-exceeds-gross case that error class actually
  // describes — a caller catching it to mean "fix this pot's fee config"
  // would misdiagnose an unrelated database/network failure the same way.
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    potFeeConfig: { 'pot-1': { entry_fee: 10 } },
    gameEntries: [{ id: 'entry-a', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' }],
    potStandingsSnapshots: [{ pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT }],
  })
  db.potPrizesWriteShouldFail = true
  const ctx = fakeDbContext(db)

  let caught: unknown
  try {
    await engine.awardPrize(ctx, 'pot-1')
  } catch (err) {
    caught = err
  }

  assertEquals(caught instanceof Error, true)
  assertEquals(
    caught instanceof Pick5PrizePoolExceededError,
    false,
    'a write failure is not a fee-configuration problem — Pick5PrizePoolExceededError is reserved for the netAmount < 0 pre-check'
  )
})

Deno.test('awardPrize is a no-op when the pot has no settled gameweek at all', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({ pick5PotIds: ['pot-1'], potFeeConfig: { 'pot-1': { entry_fee: 10 } } })
  const ctx = fakeDbContext(db)

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.potPrizes.length, 0)
})

// --- notifyUsers() -----------------------------------------------------

Deno.test('notifyUsers writes a notification row with the given type and payload', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb()
  const ctx = fakeDbContext(db)

  await engine.notifyUsers(ctx, { userId: 'user-a', potId: 'pot-1', type: 'pick5.prize_awarded', payload: { gameweekId: 4, amount: 20 } })

  assertEquals(db.notifications.length, 1)
  assertEquals(db.notifications[0].user_id, 'user-a')
  assertEquals(db.notifications[0].pot_id, 'pot-1')
  assertEquals(db.notifications[0].type, 'pick5.prize_awarded')
  assertEquals(db.notifications[0].payload, { gameweekId: 4, amount: 20 })
})

Deno.test('notifyUsers throws when the write fails', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({ notificationsShouldFail: true })
  const ctx = fakeDbContext(db)

  await assertRejects(() => engine.notifyUsers(ctx, { userId: 'user-a', potId: 'pot-1', type: 'pick5.prize_awarded' }))
})

// --- awardPrize() -> notifyUsers() wiring (Slice 9) ---------------------

Deno.test('awardPrize writes a pick5.prize_awarded notification for the sole winner', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    potFeeConfig: { 'pot-1': { entry_fee: 10 } },
    gameEntries: [{ id: 'entry-a', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' }],
    potStandingsSnapshots: [{ pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT }],
  })
  const ctx = fakeDbContext(db)

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.notifications.length, 1)
  assertEquals(db.notifications[0].user_id, 'user-a')
  assertEquals(db.notifications[0].pot_id, 'pot-1')
  assertEquals(db.notifications[0].type, 'pick5.prize_awarded')
  assertEquals(db.notifications[0].payload, { gameweekId: 4, amount: 10 })
})

Deno.test('awardPrize writes one notification per winner when there are multiple tied winners', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    potFeeConfig: { 'pot-1': { entry_fee: 10 } },
    gameEntries: [
      { id: 'entry-a', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' },
      { id: 'entry-b', pot_id: 'pot-1', user_id: 'user-b', gameweek_id: 4, status: 'settled', settled_at: 'x' },
    ],
    potStandingsSnapshots: [
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT },
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-b', rank: 1, score: PICK5_PICK_COUNT },
    ],
  })
  const ctx = fakeDbContext(db)

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.notifications.length, 2)
  const notifiedUsers = db.notifications.map((n) => n.user_id).sort()
  assertEquals(notifiedUsers, ['user-a', 'user-b'])
})

Deno.test('awardPrize does not write a duplicate notification on an idempotent second call', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    potFeeConfig: { 'pot-1': { entry_fee: 10 } },
    gameEntries: [{ id: 'entry-a', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' }],
    potStandingsSnapshots: [{ pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT }],
  })
  const ctx = fakeDbContext(db)

  await engine.awardPrize(ctx, 'pot-1')
  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.notifications.length, 1, 'the idempotent no-op path returns before ever calling notifyUsers()')
})

Deno.test('awardPrize still awards the prize and payout when the notification write fails', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    pick5PotIds: ['pot-1'],
    potFeeConfig: { 'pot-1': { entry_fee: 10 } },
    gameEntries: [{ id: 'entry-a', pot_id: 'pot-1', user_id: 'user-a', gameweek_id: 4, status: 'settled', settled_at: 'x' }],
    potStandingsSnapshots: [{ pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: PICK5_PICK_COUNT }],
    notificationsShouldFail: true,
  })
  const ctx = fakeDbContext(db)

  // Must not throw — a notification failure is never allowed to surface as
  // an awardPrize() failure, let alone undo money already written.
  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.potPrizes.length, 1)
  assertEquals(db.potPrizes[0].is_settled, true)
  assertEquals(db.gameEntries[0].payout_amount, 10)
  assertEquals(db.notifications.length, 0, 'the failed write never lands in the table, but that does not block the payout above')
})

Deno.test('does not double-count a duplicate pick as two eligibility lookups failing', async () => {
  const engine = new Pick5Engine()
  let inCallCount = 0
  const ctx: GameEngineContext = {
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: (_col: string, ids: number[]) => {
              inCallCount++
              assertEquals(ids.length, 1, 'duplicate playerIds should be de-duplicated before querying')
              return Promise.resolve({ data: [{ player_id: 1, position: 'Midfield' }], error: null })
            },
          }),
        }),
      }),
    } as unknown as GameEngineContext['supabase'],
    now: () => new Date(),
  }

  await engine.validateEntry(ctx, pendingEntry(), Array(5).fill({ playerId: 1 }))
  assertEquals(inCallCount, 1)
})
