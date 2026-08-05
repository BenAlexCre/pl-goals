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

interface FakeDb {
  pick5PotIds: string[]
  gameEntries: { id: string; pot_id: string; user_id: string; gameweek_id: number; status: string; settled_at: string | null }[]
  entryPayments: { pot_id: string; user_id: string; gameweek_id: number; scope: string; is_paid: boolean }[]
  pick5Picks: { id: number; game_entry_id: string; result: string }[]
  gameEntryPick5: { game_entry_id: string; picks_won: number }[]
  potStandingsSnapshots: { pot_id: string; gameweek_id: number | null; user_id: string; rank: number; score: number }[]
}

function emptyFakeDb(overrides: Partial<FakeDb> = {}): FakeDb {
  return {
    pick5PotIds: [],
    gameEntries: [],
    entryPayments: [],
    pick5Picks: [],
    gameEntryPick5: [],
    potStandingsSnapshots: [],
    ...overrides,
  }
}

// deno-lint-ignore no-explicit-any
let fakeIdCounter = 1

function queryBuilder(getRows: () => any[], embedGameEntryPick5FromDb?: FakeDb) {
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
    // deno-lint-ignore no-explicit-any
    insert: (rows: Record<string, unknown>[]) => {
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
    update: (patch: Record<string, unknown>) => ({
      in: (col: string, vals: unknown[]) => {
        const set = new Set(vals)
        for (const row of getRows()) {
          if (set.has(row[col])) Object.assign(row, patch)
        }
        return Promise.resolve({ data: null, error: null })
      },
    }),
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
          return queryBuilder(() => db.pick5PotIds.map((id) => ({ id, game_type: 'pick5' })))
        case 'game_entries':
          return queryBuilder(() => db.gameEntries, db)
        case 'entry_payments':
          return queryBuilder(() => db.entryPayments)
        case 'pick5_picks':
          return queryBuilder(() => db.pick5Picks)
        case 'game_entry_pick5':
          return queryBuilder(() => db.gameEntryPick5)
        case 'pot_standings_snapshots':
          return queryBuilder(() => db.potStandingsSnapshots)
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

Deno.test('determineWinner returns the single rank-1 user of the most recent gameweek', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    potStandingsSnapshots: [
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: 3 },
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-b', rank: 2, score: 1 },
    ],
  })
  const ctx = fakeDbContext(db)

  const winners = await engine.determineWinner(ctx, 'pot-1')

  assertEquals(winners, ['user-a'])
})

Deno.test('determineWinner returns every tied rank-1 user, not just one (ISSUE-17\'s shared-rank rule)', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    potStandingsSnapshots: [
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: 3 },
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-b', rank: 1, score: 3 },
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-c', rank: 3, score: 1 },
    ],
  })
  const ctx = fakeDbContext(db)

  const winners = await engine.determineWinner(ctx, 'pot-1')

  assertEquals(new Set(winners), new Set(['user-a', 'user-b']))
  assertEquals(winners.length, 2)
})

Deno.test('determineWinner uses only the most recent gameweek, not every gameweek\'s rank-1', async () => {
  const engine = new Pick5Engine()
  const db = emptyFakeDb({
    potStandingsSnapshots: [
      // An earlier gameweek's winner must not leak into this gameweek's result.
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-old-winner', rank: 1, score: 5 },
      { pot_id: 'pot-1', gameweek_id: 5, user_id: 'user-old-winner', rank: 2, score: 1 },
      { pot_id: 'pot-1', gameweek_id: 5, user_id: 'user-new-winner', rank: 1, score: 4 },
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
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: 3 },
      // The overall row has the same rank/score shape but gameweek_id: null —
      // must never be mistaken for "the latest gameweek."
      { pot_id: 'pot-1', gameweek_id: null, user_id: 'user-a', rank: 1, score: 3 },
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
      { pot_id: 'pot-1', gameweek_id: 4, user_id: 'user-a', rank: 1, score: 3 },
      { pot_id: 'pot-2', gameweek_id: 4, user_id: 'user-b', rank: 1, score: 9 },
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
