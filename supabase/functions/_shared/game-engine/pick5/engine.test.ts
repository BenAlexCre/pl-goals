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
