// Unit tests for LmsEngine.validateEntry() — Milestone 5 Slice 2. Uses a
// fake Supabase client that only implements the exact query chains
// validateEntry() issues against game_entry_lms/fixtures/lms_team_picks, same
// fake-client-over-real-DB approach Pick5Engine's own test suite established.

import { assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { GameEngineContext } from '../contracts.ts'
import type { GameEntry } from '../types.ts'
import { LmsEngine } from './engine.ts'
import { LmsValidationError } from './errors.ts'

interface FakeState {
  competitiveStatus: 'alive' | 'eliminated' | null // null = no game_entry_lms row found
  fixtureExists: boolean
  priorPickExists: boolean
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
  return { supabase: fakeSupabase as unknown as GameEngineContext['supabase'], now: () => new Date() }
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

Deno.test('lockEntries/calculateScore/settle/generateStandings/determineWinner/awardPrize/notifyUsers are not implemented yet', async () => {
  const engine = new LmsEngine()
  const ctx = fakeContext(ALIVE_WITH_FIXTURE_NO_PRIOR)

  await assertRejects(() => engine.lockEntries(ctx, 13))
  await assertRejects(() => engine.calculateScore(ctx, 13))
  await assertRejects(() => engine.settle(ctx, 13))
  await assertRejects(() => engine.generateStandings(ctx, 'pot-1'))
  await assertRejects(() => engine.determineWinner(ctx, 'pot-1'))
  await assertRejects(() => engine.awardPrize(ctx, 'pot-1'))
  await assertRejects(() => engine.notifyUsers(ctx, { userId: 'user-1', potId: 'pot-1', type: 'x' }))
})
