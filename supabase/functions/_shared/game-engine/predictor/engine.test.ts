// Unit tests for PredictorEngine.validateEntry() — Milestone 6 Slice 2. Uses
// a fake Supabase client that only implements the exact query chains
// validateEntry() issues against gameweeks/fixtures/player_team_history,
// same fake-client-over-real-DB approach every other mode's test suite in
// this codebase established.

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { GameEngineContext } from '../contracts.ts'
import type { GameEntry } from '../types.ts'
import { PredictorEngine } from './engine.ts'
import { PredictorValidationError } from './errors.ts'

interface FakeState {
  gameweekExists?: boolean // defaults to true
  deadlineUtc: string | null // null = deadline not computed yet (never blocks)
  fixtureExists?: boolean // defaults to true
  fixtureGameweekId?: number // defaults to matching the requested gameweek
  homeTeamId?: number
  awayTeamId?: number
  playerOnTeam?: boolean // whether player_team_history has a matching active row
  now?: Date
}

const REQUESTED_GAMEWEEK_ID = 10
const REQUESTED_FIXTURE_ID = 500
const HOME_TEAM_ID = 100
const AWAY_TEAM_ID = 200

function fakeContext(state: FakeState): GameEngineContext {
  const fakeSupabase = {
    from(table: string) {
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
                  maybeSingle: () =>
                    Promise.resolve({
                      data:
                        state.fixtureExists === false
                          ? null
                          : {
                              gameweek_id: state.fixtureGameweekId ?? REQUESTED_GAMEWEEK_ID,
                              home_team_id: state.homeTeamId ?? HOME_TEAM_ID,
                              away_team_id: state.awayTeamId ?? AWAY_TEAM_ID,
                            },
                      error: null,
                    }),
                }
              },
            }
          },
        }
      }
      if (table === 'player_team_history') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      in() {
                        return {
                          maybeSingle: () =>
                            Promise.resolve({
                              data: state.playerOnTeam === false ? null : { team_id: state.homeTeamId ?? HOME_TEAM_ID },
                              error: null,
                            }),
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
  return { supabase: fakeSupabase as unknown as GameEngineContext['supabase'], now: () => state.now ?? new Date('2026-01-01T00:00:00Z') }
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

function validPick(overrides: Record<string, unknown> = {}) {
  return {
    gameweekId: REQUESTED_GAMEWEEK_ID,
    fixtureId: REQUESTED_FIXTURE_ID,
    predictedHomeScore: 2,
    predictedAwayScore: 1,
    goalscorerPlayerId: null,
    ...overrides,
  }
}

Deno.test('accepts a valid pick with no goalscorer', async () => {
  const engine = new PredictorEngine()
  const ctx = fakeContext({ deadlineUtc: '2026-06-01T00:00:00Z' })

  await engine.validateEntry(ctx, pendingEntry(), validPick())
})

Deno.test('accepts a valid pick with a goalscorer on the home team', async () => {
  const engine = new PredictorEngine()
  const ctx = fakeContext({ deadlineUtc: '2026-06-01T00:00:00Z', playerOnTeam: true })

  await engine.validateEntry(ctx, pendingEntry(), validPick({ goalscorerPlayerId: 999 }))
})

Deno.test('accepts a scoreline predicting a draw — no special representation needed', async () => {
  const engine = new PredictorEngine()
  const ctx = fakeContext({ deadlineUtc: '2026-06-01T00:00:00Z' })

  await engine.validateEntry(ctx, pendingEntry(), validPick({ predictedHomeScore: 1, predictedAwayScore: 1 }))
})

Deno.test('rejects an entry that is not pending', async () => {
  const engine = new PredictorEngine()
  const ctx = fakeContext({ deadlineUtc: '2026-06-01T00:00:00Z' })

  await assertRejects(
    () => engine.validateEntry(ctx, pendingEntry({ status: 'settled' }), validPick()),
    PredictorValidationError
  )
})

Deno.test('rejects a malformed pick (missing gameweekId)', async () => {
  const engine = new PredictorEngine()
  const ctx = fakeContext({ deadlineUtc: '2026-06-01T00:00:00Z' })
  const { gameweekId: _omit, ...malformed } = validPick()

  await assertRejects(() => engine.validateEntry(ctx, pendingEntry(), malformed), PredictorValidationError)
})

Deno.test('rejects a negative predicted score', async () => {
  const engine = new PredictorEngine()
  const ctx = fakeContext({ deadlineUtc: '2026-06-01T00:00:00Z' })

  await assertRejects(
    () => engine.validateEntry(ctx, pendingEntry(), validPick({ predictedHomeScore: -1 })),
    PredictorValidationError
  )
})

Deno.test('rejects a non-integer goalscorerPlayerId when one is provided', async () => {
  const engine = new PredictorEngine()
  const ctx = fakeContext({ deadlineUtc: '2026-06-01T00:00:00Z' })

  await assertRejects(
    () => engine.validateEntry(ctx, pendingEntry(), validPick({ goalscorerPlayerId: 'nine' })),
    PredictorValidationError
  )
})

Deno.test('rejects a nonexistent gameweek', async () => {
  const engine = new PredictorEngine()
  const ctx = fakeContext({ gameweekExists: false, deadlineUtc: null })

  await assertRejects(() => engine.validateEntry(ctx, pendingEntry(), validPick()), PredictorValidationError)
})

Deno.test('rejects a pick once the gameweek deadline has passed', async () => {
  const engine = new PredictorEngine()
  const ctx = fakeContext({ deadlineUtc: '2025-12-31T00:00:00Z', now: new Date('2026-01-01T00:00:00Z') })

  await assertRejects(() => engine.validateEntry(ctx, pendingEntry(), validPick()), PredictorValidationError)
})

Deno.test('accepts a pick when the deadline has not been computed yet (deadline_utc null)', async () => {
  const engine = new PredictorEngine()
  const ctx = fakeContext({ deadlineUtc: null })

  await engine.validateEntry(ctx, pendingEntry(), validPick())
})

Deno.test('rejects a nonexistent fixture', async () => {
  const engine = new PredictorEngine()
  const ctx = fakeContext({ deadlineUtc: '2026-06-01T00:00:00Z', fixtureExists: false })

  await assertRejects(() => engine.validateEntry(ctx, pendingEntry(), validPick()), PredictorValidationError)
})

Deno.test('rejects a fixture that does not belong to the requested gameweek', async () => {
  const engine = new PredictorEngine()
  const ctx = fakeContext({ deadlineUtc: '2026-06-01T00:00:00Z', fixtureGameweekId: 999 })

  await assertRejects(() => engine.validateEntry(ctx, pendingEntry(), validPick()), PredictorValidationError)
})

Deno.test('rejects a goalscorer who is not on either team in the fixture', async () => {
  const engine = new PredictorEngine()
  const ctx = fakeContext({ deadlineUtc: '2026-06-01T00:00:00Z', playerOnTeam: false })

  await assertRejects(
    () => engine.validateEntry(ctx, pendingEntry(), validPick({ goalscorerPlayerId: 999 })),
    PredictorValidationError
  )
})
