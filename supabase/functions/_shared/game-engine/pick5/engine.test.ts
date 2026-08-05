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
import { Pick5Engine } from './engine.ts'
import { Pick5ValidationError } from './errors.ts'

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
