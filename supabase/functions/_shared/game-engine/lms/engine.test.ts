// Unit tests for LmsEngine.validateEntry() — Milestone 5 Slice 2. Uses a
// fake Supabase client that only implements the exact query chains
// validateEntry() issues against game_entry_lms/fixtures/lms_team_picks, same
// fake-client-over-real-DB approach Pick5Engine's own test suite established.

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { GameEngineContext } from '../contracts.ts'
import type { GameEntry } from '../types.ts'
import { LmsEngine } from './engine.ts'
import { LmsValidationError } from './errors.ts'

interface FakeState {
  competitiveStatus: 'alive' | 'eliminated' | null // null = no game_entry_lms row found
  fixtureExists: boolean
  priorPickExists: boolean
  deadlineUtc: string | null // null = gameweek's deadline not computed yet (never blocks)
  gameweekExists?: boolean // defaults to true
  now?: Date
}

function fakeContext(state: FakeState): GameEngineContext {
  const fakeSupabase = {
    from(table: string) {
      if (table === 'game_entry_lms') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: () =>
                    Promise.resolve({
                      data: state.competitiveStatus === null ? null : { competitive_status: state.competitiveStatus },
                      error: null,
                    }),
                }
              },
            }
          },
        }
      }
      if (table === 'gameweeks') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: () =>
                    Promise.resolve({
                      data: state.gameweekExists === false ? null : { deadline_utc: state.deadlineUtc },
                      error: null,
                    }),
                }
              },
            }
          },
        }
      }
      if (table === 'fixtures') {
        return {
          select() {
            return {
              eq() {
                return {
                  or() {
                    return {
                      maybeSingle: () =>
                        Promise.resolve({ data: state.fixtureExists ? { id: 1 } : null, error: null }),
                    }
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'lms_team_picks') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      neq() {
                        return {
                          maybeSingle: () =>
                            Promise.resolve({ data: state.priorPickExists ? { id: 1 } : null, error: null }),
                        }
                      },
                    }
                  },
                }
              },
            }
          },
        }
      }
      throw new Error(`Unexpected table in test fake: ${table}`)
    },
  }
  return {
    supabase: fakeSupabase as unknown as GameEngineContext['supabase'],
    now: () => state.now ?? new Date('2026-01-01T00:00:00Z'),
  }
}

function pendingEntry(overrides: Partial<GameEntry> = {}): GameEntry {
  return {
    id: 'entry-1',
    potId: 'pot-1',
    userId: 'user-1',
    gameweekId: null,
    entryScope: 'season',
    status: 'pending',
    payoutAmount: 0,
    settledAt: null,
    ...overrides,
  }
}

const ALIVE_WITH_FIXTURE_NO_PRIOR: FakeState = {
  competitiveStatus: 'alive',
  fixtureExists: true,
  priorPickExists: false,
  deadlineUtc: '2026-06-01T00:00:00Z', // in the future relative to the fake "now" above
}

Deno.test('accepts a valid pick: alive entry, team has a fixture, team never picked before', async () => {
  const engine = new LmsEngine()
  const ctx = fakeContext(ALIVE_WITH_FIXTURE_NO_PRIOR)

  await engine.validateEntry(ctx, pendingEntry(), { gameweekId: 13, teamId: 1 })
  // No throw = pass.
})

Deno.test('rejects an entry that is not pending', async () => {
  const engine = new LmsEngine()
  const ctx = fakeContext(ALIVE_WITH_FIXTURE_NO_PRIOR)

  await assertRejects(
    () => engine.validateEntry(ctx, pendingEntry({ status: 'locked' }), { gameweekId: 13, teamId: 1 }),
    LmsValidationError,
  )
})

Deno.test('rejects a malformed pick (missing teamId)', async () => {
  const engine = new LmsEngine()
  const ctx = fakeContext(ALIVE_WITH_FIXTURE_NO_PRIOR)

  await assertRejects(
    () => engine.validateEntry(ctx, pendingEntry(), { gameweekId: 13 }),
    LmsValidationError,
  )
})

Deno.test('rejects a malformed pick (gameweekId as a numeric string)', async () => {
  const engine = new LmsEngine()
  const ctx = fakeContext(ALIVE_WITH_FIXTURE_NO_PRIOR)

  await assertRejects(
    () => engine.validateEntry(ctx, pendingEntry(), { gameweekId: '13', teamId: 1 }),
    LmsValidationError,
  )
})

Deno.test('rejects when the entry has been eliminated', async () => {
  const engine = new LmsEngine()
  const ctx = fakeContext({ ...ALIVE_WITH_FIXTURE_NO_PRIOR, competitiveStatus: 'eliminated' })

  await assertRejects(
    () => engine.validateEntry(ctx, pendingEntry(), { gameweekId: 13, teamId: 1 }),
    LmsValidationError,
  )
})

Deno.test('rejects when no game_entry_lms extension row exists', async () => {
  const engine = new LmsEngine()
  const ctx = fakeContext({ ...ALIVE_WITH_FIXTURE_NO_PRIOR, competitiveStatus: null })

  await assertRejects(
    () => engine.validateEntry(ctx, pendingEntry(), { gameweekId: 13, teamId: 1 }),
    LmsValidationError,
  )
})

Deno.test('rejects a team with no fixture in the given gameweek', async () => {
  const engine = new LmsEngine()
  const ctx = fakeContext({ ...ALIVE_WITH_FIXTURE_NO_PRIOR, fixtureExists: false })

  await assertRejects(
    () => engine.validateEntry(ctx, pendingEntry(), { gameweekId: 13, teamId: 1 }),
    LmsValidationError,
  )
})

Deno.test('rejects a team already picked in an earlier gameweek — no cycles, ever', async () => {
  const engine = new LmsEngine()
  const ctx = fakeContext({ ...ALIVE_WITH_FIXTURE_NO_PRIOR, priorPickExists: true })

  await assertRejects(
    () => engine.validateEntry(ctx, pendingEntry(), { gameweekId: 13, teamId: 1 }),
    LmsValidationError,
  )
})

Deno.test('rejects a nonexistent gameweek', async () => {
  const engine = new LmsEngine()
  const ctx = fakeContext({ ...ALIVE_WITH_FIXTURE_NO_PRIOR, gameweekExists: false })

  await assertRejects(
    () => engine.validateEntry(ctx, pendingEntry(), { gameweekId: 999, teamId: 1 }),
    LmsValidationError,
  )
})

Deno.test('rejects a pick once the gameweek deadline has passed', async () => {
  const engine = new LmsEngine()
  const ctx = fakeContext({
    ...ALIVE_WITH_FIXTURE_NO_PRIOR,
    deadlineUtc: '2026-01-01T00:00:00Z',
    now: new Date('2026-01-01T00:00:01Z'),
  })

  await assertRejects(
    () => engine.validateEntry(ctx, pendingEntry(), { gameweekId: 13, teamId: 1 }),
    LmsValidationError,
  )
})

Deno.test('accepts a pick when the deadline has not been computed yet (deadline_utc null)', async () => {
  const engine = new LmsEngine()
  const ctx = fakeContext({ ...ALIVE_WITH_FIXTURE_NO_PRIOR, deadlineUtc: null })

  await engine.validateEntry(ctx, pendingEntry(), { gameweekId: 13, teamId: 1 })
  // No throw = pass.
})

Deno.test('calculateScore/settle/generateStandings/determineWinner/awardPrize/notifyUsers are not implemented yet', async () => {
  const engine = new LmsEngine()
  const ctx = fakeContext(ALIVE_WITH_FIXTURE_NO_PRIOR)

  await assertRejects(() => engine.calculateScore(ctx, 13))
  await assertRejects(() => engine.settle(ctx, 13))
  await assertRejects(() => engine.generateStandings(ctx, 'pot-1'))
  await assertRejects(() => engine.determineWinner(ctx, 'pot-1'))
  await assertRejects(() => engine.awardPrize(ctx, 'pot-1'))
  await assertRejects(() => engine.notifyUsers(ctx, { userId: 'user-1', potId: 'pot-1', type: 'x' }))
})

// --- lockEntries() ----------------------------------------------------------
// Same in-memory-mutation fake approach Pick5Engine's own lockEntries tests
// use — proves the method's own filtering (gameweek, already-locked), not
// just that it issued *a* query.

interface FakePickRow {
  id: number
  gameweek_id: number
  locked_at: string | null
}

function fakeLockEntriesContext(picks: FakePickRow[]): GameEngineContext {
  const fakeSupabase = {
    from(table: string) {
      if (table !== 'lms_team_picks') {
        throw new Error(`Unexpected table in test fake: ${table}`)
      }
      return {
        update: (patch: { locked_at: string }) => ({
          eq: (_col: string, gameweekId: number) => ({
            is: (_col2: string, _val: null) => ({
              select: () => {
                const matched = picks.filter((p) => p.gameweek_id === gameweekId && p.locked_at === null)
                matched.forEach((p) => { p.locked_at = patch.locked_at })
                return Promise.resolve({ data: matched.map((p) => ({ id: p.id })), error: null })
              },
            }),
          }),
        }),
      }
    },
  }
  return { supabase: fakeSupabase as unknown as GameEngineContext['supabase'], now: () => new Date('2026-06-01T00:00:00Z') }
}

Deno.test('lockEntries locks not-yet-locked picks for the given gameweek and returns the count', async () => {
  const engine = new LmsEngine()
  const picks: FakePickRow[] = [
    { id: 1, gameweek_id: 13, locked_at: null },
    { id: 2, gameweek_id: 13, locked_at: null },
  ]
  const ctx = fakeLockEntriesContext(picks)

  const count = await engine.lockEntries(ctx, 13)

  assertEquals(count, 2)
  assertEquals(picks.every((p) => p.locked_at === '2026-06-01T00:00:00.000Z'), true)
})

Deno.test('lockEntries does not touch picks for a different gameweek', async () => {
  const engine = new LmsEngine()
  const picks: FakePickRow[] = [{ id: 1, gameweek_id: 14, locked_at: null }]
  const ctx = fakeLockEntriesContext(picks)

  const count = await engine.lockEntries(ctx, 13)

  assertEquals(count, 0)
  assertEquals(picks[0].locked_at, null)
})

Deno.test('lockEntries does not re-lock a pick that is already locked', async () => {
  const engine = new LmsEngine()
  const picks: FakePickRow[] = [{ id: 1, gameweek_id: 13, locked_at: '2020-01-01T00:00:00.000Z' }]
  const ctx = fakeLockEntriesContext(picks)

  const count = await engine.lockEntries(ctx, 13)

  assertEquals(count, 0)
  assertEquals(picks[0].locked_at, '2020-01-01T00:00:00.000Z')
})

Deno.test('lockEntries returns 0 when there are no picks at all for the gameweek', async () => {
  const engine = new LmsEngine()
  const ctx = fakeLockEntriesContext([])

  const count = await engine.lockEntries(ctx, 13)

  assertEquals(count, 0)
})
