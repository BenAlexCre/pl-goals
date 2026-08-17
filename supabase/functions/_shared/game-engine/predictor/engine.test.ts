// Unit tests for PredictorEngine.validateEntry() — Milestone 6 Slice 2. Uses
// a fake Supabase client that only implements the exact query chains
// validateEntry() issues against gameweeks/fixtures/player_team_history,
// same fake-client-over-real-DB approach every other mode's test suite in
// this codebase established.

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { GameEngineContext } from '../contracts.ts'
import type { GameEntry } from '../types.ts'
import { PredictorEngine } from './engine.ts'
import { PredictorPrizePoolExceededError, PredictorValidationError } from './errors.ts'

interface FakeState {
  gameweekExists?: boolean // defaults to true
  deadlineUtc: string | null // null = deadline not computed yet (never blocks)
  gameweekNumber?: number // defaults to 10 — the requested pick's gameweek number
  fixtureExists?: boolean // defaults to true
  fixtureGameweekId?: number // defaults to matching the requested gameweek
  homeTeamId?: number
  awayTeamId?: number
  playerOnTeam?: boolean // whether player_team_history has a matching active row
  now?: Date
  // Phase 7 — Competition Configuration UX Polish. A "Custom competition"
  // pot's bounds — undefined/null means unbounded, matching every pot
  // created before this change and every non-Custom pot after it.
  potStartGameweekId?: number | null
  potEndGameweekId?: number | null
  startGameweekNumber?: number
  endGameweekNumber?: number
}

const REQUESTED_GAMEWEEK_ID = 10
const REQUESTED_FIXTURE_ID = 500
const HOME_TEAM_ID = 100
const AWAY_TEAM_ID = 200
const START_GAMEWEEK_ID = 8
const END_GAMEWEEK_ID = 20

function fakeContext(state: FakeState): GameEngineContext {
  const fakeSupabase = {
    from(table: string) {
      if (table === 'gameweeks') {
        return {
          select() {
            return {
              eq(_column: string, id: number) {
                return {
                  maybeSingle: () => {
                    if (id === REQUESTED_GAMEWEEK_ID) {
                      return Promise.resolve({
                        data:
                          state.gameweekExists === false
                            ? null
                            : { number: state.gameweekNumber ?? 10, deadline_utc: state.deadlineUtc },
                        error: null,
                      })
                    }
                    if (id === state.potStartGameweekId) {
                      return Promise.resolve({ data: { number: state.startGameweekNumber ?? 5 }, error: null })
                    }
                    if (id === state.potEndGameweekId) {
                      return Promise.resolve({ data: { number: state.endGameweekNumber ?? 30 }, error: null })
                    }
                    return Promise.resolve({ data: null, error: null })
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'pots') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        start_gameweek_id: state.potStartGameweekId ?? null,
                        end_gameweek_id: state.potEndGameweekId ?? null,
                      },
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

// Phase 7 — Competition Configuration UX Polish. A "Custom competition"
// pot's start_gameweek_id/end_gameweek_id now genuinely bound which
// gameweeks can be predicted for, mirroring LMS's own entry-window
// enforcement pattern. The default "Two half-season" pot never sets
// start_gameweek_id, so it's unaffected by the start-bound tests below.

Deno.test('rejects a pick for a gameweek before the pot\'s custom start gameweek', async () => {
  const engine = new PredictorEngine()
  const ctx = fakeContext({
    deadlineUtc: '2026-06-01T00:00:00Z',
    gameweekNumber: 4,
    potStartGameweekId: START_GAMEWEEK_ID,
    startGameweekNumber: 8,
  })

  await assertRejects(
    () => engine.validateEntry(ctx, pendingEntry(), validPick()),
    PredictorValidationError,
    "before this competition's start gameweek"
  )
})

Deno.test('accepts a pick exactly at the pot\'s custom start gameweek', async () => {
  const engine = new PredictorEngine()
  const ctx = fakeContext({
    deadlineUtc: '2026-06-01T00:00:00Z',
    gameweekNumber: 8,
    potStartGameweekId: START_GAMEWEEK_ID,
    startGameweekNumber: 8,
  })

  await engine.validateEntry(ctx, pendingEntry(), validPick())
})

Deno.test('rejects a pick for a gameweek after the pot\'s final gameweek', async () => {
  const engine = new PredictorEngine()
  const ctx = fakeContext({
    deadlineUtc: '2026-06-01T00:00:00Z',
    gameweekNumber: 25,
    potEndGameweekId: END_GAMEWEEK_ID,
    endGameweekNumber: 20,
  })

  await assertRejects(
    () => engine.validateEntry(ctx, pendingEntry(), validPick()),
    PredictorValidationError,
    "after this competition's final gameweek"
  )
})

Deno.test('accepts a pick exactly at the pot\'s final gameweek', async () => {
  const engine = new PredictorEngine()
  const ctx = fakeContext({
    deadlineUtc: '2026-06-01T00:00:00Z',
    gameweekNumber: 20,
    potEndGameweekId: END_GAMEWEEK_ID,
    endGameweekNumber: 20,
  })

  await engine.validateEntry(ctx, pendingEntry(), validPick())
})

Deno.test('a pot with no custom bounds accepts any gameweek whose deadline has not passed', async () => {
  const engine = new PredictorEngine()
  const ctx = fakeContext({ deadlineUtc: '2026-06-01T00:00:00Z', gameweekNumber: 37 })

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

// --- lockEntries() -------------------------------------------------------
// Milestone 6 Slice 3. Same fake-shape and same four scenarios as
// LmsEngine.lockEntries()'s own test suite (not copied blindly — the same
// mechanism, predictor_fixture_picks.locked_at, drives the same four
// behaviors: lock what's due and unlocked, leave other gameweeks alone,
// don't re-lock, no-op when there's nothing to lock).

interface FakePickRow {
  id: number
  gameweek_id: number
  locked_at: string | null
}

function fakeLockEntriesContext(picks: FakePickRow[]): GameEngineContext {
  const fakeSupabase = {
    from(table: string) {
      if (table !== 'predictor_fixture_picks') {
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
  const engine = new PredictorEngine()
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
  const engine = new PredictorEngine()
  const picks: FakePickRow[] = [{ id: 1, gameweek_id: 14, locked_at: null }]
  const ctx = fakeLockEntriesContext(picks)

  const count = await engine.lockEntries(ctx, 13)

  assertEquals(count, 0)
  assertEquals(picks[0].locked_at, null)
})

Deno.test('lockEntries does not re-lock a pick that is already locked', async () => {
  const engine = new PredictorEngine()
  const picks: FakePickRow[] = [{ id: 1, gameweek_id: 13, locked_at: '2020-01-01T00:00:00.000Z' }]
  const ctx = fakeLockEntriesContext(picks)

  const count = await engine.lockEntries(ctx, 13)

  assertEquals(count, 0)
  assertEquals(picks[0].locked_at, '2020-01-01T00:00:00.000Z')
})

Deno.test('lockEntries returns 0 when there are no picks at all for the gameweek', async () => {
  const engine = new PredictorEngine()
  const ctx = fakeLockEntriesContext([])

  const count = await engine.lockEntries(ctx, 13)

  assertEquals(count, 0)
})

// --- calculateScore() -----------------------------------------------------
// A small in-memory relational fake (fixtures/predictor_fixture_picks/
// game_entries/pots/player_fixture_goals/game_entry_predictor), same
// approach in spirit as LmsEngine's own calculateScore() fake — mutate real
// rows so a test can assert on them directly, rather than intercepting
// individual write calls.

interface FakeFixture { id: number; gameweek_id: number; status: string; home_goals: number; away_goals: number }
interface FakePredictorPick {
  id: number
  game_entry_id: string
  gameweek_id: number
  fixture_id: number
  predicted_home_score: number
  predicted_away_score: number
  goalscorer_player_id: number | null
  points_awarded: number | null
  is_exact_score: boolean
  scorer_bonus_awarded: boolean
}
interface FakeCalcGameEntry { id: string; pot_id: string; status: string }
interface FakeCalcPot {
  id: string
  predictor_exact_score_points: number
  predictor_correct_result_points: number
  predictor_scorer_bonus_points: number
  predictor_scorer_scope: 'fixture_only' | 'gameweek_wide'
}
interface FakePlayerFixtureGoal { player_id: number; fixture_id: number; gameweek_id: number; goals: number }
interface FakeGameEntryPredictor { game_entry_id: string; total_points: number; exact_score_count: number; correct_scorer_count: number }

interface FakeCalcDb {
  fixtures: FakeFixture[]
  predictor_fixture_picks: FakePredictorPick[]
  game_entries: FakeCalcGameEntry[]
  pots: FakeCalcPot[]
  player_fixture_goals: FakePlayerFixtureGoal[]
  game_entry_predictor: FakeGameEntryPredictor[]
}

function defaultPot(overrides: Partial<FakeCalcPot> = {}): FakeCalcPot {
  return {
    id: 'pot-1',
    predictor_exact_score_points: 5,
    predictor_correct_result_points: 3,
    predictor_scorer_bonus_points: 2,
    predictor_scorer_scope: 'gameweek_wide',
    ...overrides,
  }
}

function fakeCalcContext(db: FakeCalcDb): GameEngineContext {
  // deno-lint-ignore no-explicit-any
  function queryBuilder(getRows: () => any[]) {
    // deno-lint-ignore no-explicit-any
    const filters: ((row: any) => boolean)[] = []
    let limitCount: number | null = null
    // deno-lint-ignore no-explicit-any
    const builder: any = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push((row) => row[col] === val)
        return builder
      },
      in: (col: string, vals: unknown[]) => {
        const set = new Set(vals)
        filters.push((row) => set.has(row[col]))
        return builder
      },
      not: (col: string, op: string, val: unknown) => {
        if (op !== 'is') throw new Error(`Fake queryBuilder.not() only supports 'is', got: ${op}`)
        filters.push((row) => row[col] !== val)
        return builder
      },
      limit: (n: number) => {
        limitCount = n
        return builder
      },
      // deno-lint-ignore no-explicit-any
      upsert: (rows: Record<string, unknown>[], opts: { onConflict: string }) => {
        const conflictCols = opts.onConflict.split(',')
        const table = getRows()
        for (const row of rows) {
          const existing = table.find((r) => conflictCols.every((c) => r[c] === row[c]))
          if (existing) Object.assign(existing, row)
          else table.push({ ...row })
        }
        return Promise.resolve({ data: rows, error: null })
      },
      // deno-lint-ignore no-explicit-any
      then: (resolve: (v: { data: any; error: null }) => void) => {
        let rows = getRows().filter((row) => filters.every((f) => f(row)))
        if (limitCount !== null) rows = rows.slice(0, limitCount)
        resolve({ data: rows, error: null })
      },
    }
    return builder
  }

  const fakeSupabase = {
    from(table: keyof FakeCalcDb) {
      return queryBuilder(() => db[table])
    },
  }
  return { supabase: fakeSupabase as unknown as GameEngineContext['supabase'], now: () => new Date('2026-06-01T00:00:00Z') }
}

function baseCalcDb(overrides: Partial<FakeCalcDb> = {}): FakeCalcDb {
  return {
    fixtures: [{ id: 500, gameweek_id: 13, status: 'finished', home_goals: 2, away_goals: 1 }],
    predictor_fixture_picks: [],
    game_entries: [{ id: 'entry-1', pot_id: 'pot-1', status: 'pending' }],
    pots: [defaultPot()],
    player_fixture_goals: [],
    game_entry_predictor: [{ game_entry_id: 'entry-1', total_points: 0, exact_score_count: 0, correct_scorer_count: 0 }],
    ...overrides,
  }
}

function basePick(overrides: Partial<FakePredictorPick> = {}): FakePredictorPick {
  return {
    id: 1,
    game_entry_id: 'entry-1',
    gameweek_id: 13,
    fixture_id: 500,
    predicted_home_score: 0,
    predicted_away_score: 0,
    goalscorer_player_id: null,
    points_awarded: null,
    is_exact_score: false,
    scorer_bonus_awarded: false,
    ...overrides,
  }
}

Deno.test('calculateScore does nothing when no fixture in the gameweek has started', async () => {
  const engine = new PredictorEngine()
  const db = baseCalcDb({
    fixtures: [{ id: 500, gameweek_id: 13, status: 'scheduled', home_goals: 0, away_goals: 0 }],
    predictor_fixture_picks: [basePick()],
  })
  const ctx = fakeCalcContext(db)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.predictor_fixture_picks[0].points_awarded, null)
})

Deno.test('calculateScore leaves a live (not yet finished) fixture\'s pick unresolved', async () => {
  const engine = new PredictorEngine()
  const db = baseCalcDb({
    fixtures: [{ id: 500, gameweek_id: 13, status: 'live', home_goals: 1, away_goals: 0 }],
    predictor_fixture_picks: [basePick({ predicted_home_score: 1, predicted_away_score: 0 })],
  })
  const ctx = fakeCalcContext(db)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.predictor_fixture_picks[0].points_awarded, null)
})

Deno.test('calculateScore leaves a postponed fixture\'s pick unresolved, same as LmsEngine\'s own stance', async () => {
  const engine = new PredictorEngine()
  const db = baseCalcDb({
    fixtures: [
      { id: 500, gameweek_id: 13, status: 'postponed', home_goals: 0, away_goals: 0 },
      { id: 501, gameweek_id: 13, status: 'finished', home_goals: 0, away_goals: 0 }, // so the gameweek-level early-exit doesn't short-circuit
    ],
    predictor_fixture_picks: [basePick({ fixture_id: 500 })],
  })
  const ctx = fakeCalcContext(db)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.predictor_fixture_picks[0].points_awarded, null)
})

Deno.test('calculateScore awards exact-score points for a correct scoreline (pot default: 5)', async () => {
  const engine = new PredictorEngine()
  const db = baseCalcDb({
    predictor_fixture_picks: [basePick({ predicted_home_score: 2, predicted_away_score: 1 })],
  })
  const ctx = fakeCalcContext(db)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.predictor_fixture_picks[0].points_awarded, 5)
  assertEquals(db.predictor_fixture_picks[0].is_exact_score, true)
})

Deno.test('calculateScore awards correct-result points for the right winner but wrong scoreline (pot default: 3)', async () => {
  const engine = new PredictorEngine()
  const db = baseCalcDb({
    predictor_fixture_picks: [basePick({ predicted_home_score: 3, predicted_away_score: 1 })], // actual is 2-1, same winner, wrong score
  })
  const ctx = fakeCalcContext(db)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.predictor_fixture_picks[0].points_awarded, 3)
  assertEquals(db.predictor_fixture_picks[0].is_exact_score, false)
})

Deno.test('calculateScore correctly scores a predicted draw against an actual draw as a correct result', async () => {
  const engine = new PredictorEngine()
  const db = baseCalcDb({
    fixtures: [{ id: 500, gameweek_id: 13, status: 'finished', home_goals: 1, away_goals: 1 }],
    predictor_fixture_picks: [basePick({ predicted_home_score: 2, predicted_away_score: 2 })], // predicted a draw, got a draw, wrong exact score
  })
  const ctx = fakeCalcContext(db)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.predictor_fixture_picks[0].points_awarded, 3)
})

Deno.test('calculateScore awards zero points for a wrong result entirely', async () => {
  const engine = new PredictorEngine()
  const db = baseCalcDb({
    predictor_fixture_picks: [basePick({ predicted_home_score: 0, predicted_away_score: 3 })], // predicted away win, actual home win
  })
  const ctx = fakeCalcContext(db)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.predictor_fixture_picks[0].points_awarded, 0)
})

Deno.test('calculateScore: missing (null) goalscorer prediction never awards a bonus and never penalises the base points', async () => {
  const engine = new PredictorEngine()
  const db = baseCalcDb({
    predictor_fixture_picks: [basePick({ predicted_home_score: 2, predicted_away_score: 1, goalscorer_player_id: null })],
  })
  const ctx = fakeCalcContext(db)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.predictor_fixture_picks[0].points_awarded, 5) // still full exact-score credit
  assertEquals(db.predictor_fixture_picks[0].scorer_bonus_awarded, false)
})

Deno.test('calculateScore: correct goalscorer (fixture_only scope) adds the bonus on top of exact-score points', async () => {
  const engine = new PredictorEngine()
  const db = baseCalcDb({
    pots: [defaultPot({ predictor_scorer_scope: 'fixture_only' })],
    predictor_fixture_picks: [basePick({ predicted_home_score: 2, predicted_away_score: 1, goalscorer_player_id: 999 })],
    player_fixture_goals: [{ player_id: 999, fixture_id: 500, gameweek_id: 13, goals: 1 }],
  })
  const ctx = fakeCalcContext(db)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.predictor_fixture_picks[0].points_awarded, 7) // 5 exact + 2 bonus
  assertEquals(db.predictor_fixture_picks[0].scorer_bonus_awarded, true)
})

Deno.test('calculateScore: fixture_only scope does NOT award the bonus for a goal scored in a different fixture the same gameweek', async () => {
  const engine = new PredictorEngine()
  const db = baseCalcDb({
    fixtures: [
      { id: 500, gameweek_id: 13, status: 'finished', home_goals: 2, away_goals: 1 },
      { id: 501, gameweek_id: 13, status: 'finished', home_goals: 1, away_goals: 0 },
    ],
    pots: [defaultPot({ predictor_scorer_scope: 'fixture_only' })],
    predictor_fixture_picks: [basePick({ predicted_home_score: 2, predicted_away_score: 1, goalscorer_player_id: 999 })],
    player_fixture_goals: [{ player_id: 999, fixture_id: 501, gameweek_id: 13, goals: 1 }], // scored, but in the OTHER fixture
  })
  const ctx = fakeCalcContext(db)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.predictor_fixture_picks[0].points_awarded, 5) // exact-score only, no bonus
  assertEquals(db.predictor_fixture_picks[0].scorer_bonus_awarded, false)
})

Deno.test('calculateScore: gameweek_wide scope DOES award the bonus for a goal scored in a different fixture the same gameweek', async () => {
  const engine = new PredictorEngine()
  const db = baseCalcDb({
    fixtures: [
      { id: 500, gameweek_id: 13, status: 'finished', home_goals: 2, away_goals: 1 },
      { id: 501, gameweek_id: 13, status: 'finished', home_goals: 1, away_goals: 0 },
    ],
    pots: [defaultPot({ predictor_scorer_scope: 'gameweek_wide' })],
    predictor_fixture_picks: [basePick({ predicted_home_score: 2, predicted_away_score: 1, goalscorer_player_id: 999 })],
    player_fixture_goals: [{ player_id: 999, fixture_id: 501, gameweek_id: 13, goals: 1 }],
  })
  const ctx = fakeCalcContext(db)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.predictor_fixture_picks[0].points_awarded, 7) // 5 exact + 2 bonus, scored anywhere in the gameweek
  assertEquals(db.predictor_fixture_picks[0].scorer_bonus_awarded, true)
})

Deno.test('calculateScore respects a pot\'s own configured point values, not the platform default', async () => {
  const engine = new PredictorEngine()
  const db = baseCalcDb({
    pots: [defaultPot({ predictor_exact_score_points: 10, predictor_correct_result_points: 4, predictor_scorer_bonus_points: 1 })],
    predictor_fixture_picks: [basePick({ predicted_home_score: 2, predicted_away_score: 1, goalscorer_player_id: 999 })],
    player_fixture_goals: [{ player_id: 999, fixture_id: 500, gameweek_id: 13, goals: 1 }],
  })
  const ctx = fakeCalcContext(db)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.predictor_fixture_picks[0].points_awarded, 11) // 10 exact + 1 bonus, this pot's own configured values
})

Deno.test('calculateScore updates game_entry_predictor as a full recompute (SUM/COUNT) across every resolved pick, not an increment', async () => {
  const engine = new PredictorEngine()
  const db = baseCalcDb({
    fixtures: [
      { id: 500, gameweek_id: 13, status: 'finished', home_goals: 2, away_goals: 1 },
      { id: 600, gameweek_id: 14, status: 'finished', home_goals: 0, away_goals: 0 },
    ],
    predictor_fixture_picks: [
      // Already resolved in an earlier gameweek's calculateScore() call.
      { id: 1, game_entry_id: 'entry-1', gameweek_id: 14, fixture_id: 600, predicted_home_score: 0, predicted_away_score: 0, goalscorer_player_id: null, points_awarded: 3, is_exact_score: false, scorer_bonus_awarded: false },
      // This gameweek's pick, not yet resolved.
      basePick({ id: 2, gameweek_id: 13, fixture_id: 500, predicted_home_score: 2, predicted_away_score: 1 }),
    ],
  })
  const ctx = fakeCalcContext(db)

  await engine.calculateScore(ctx, 13)

  const stats = db.game_entry_predictor.find((s) => s.game_entry_id === 'entry-1')
  assertEquals(stats?.total_points, 8) // 3 (gameweek 14, untouched by this call) + 5 (gameweek 13, just resolved)
  assertEquals(stats?.exact_score_count, 1)
})

Deno.test('calculateScore is safe to call repeatedly — same input produces the same output, no double-counting', async () => {
  const engine = new PredictorEngine()
  const db = baseCalcDb({
    predictor_fixture_picks: [basePick({ predicted_home_score: 2, predicted_away_score: 1, goalscorer_player_id: 999 })],
    player_fixture_goals: [{ player_id: 999, fixture_id: 500, gameweek_id: 13, goals: 1 }],
  })
  const ctx = fakeCalcContext(db)

  await engine.calculateScore(ctx, 13)
  const afterFirst = db.game_entry_predictor.find((s) => s.game_entry_id === 'entry-1')?.total_points
  await engine.calculateScore(ctx, 13)
  const afterSecond = db.game_entry_predictor.find((s) => s.game_entry_id === 'entry-1')?.total_points
  await engine.calculateScore(ctx, 13)
  const afterThird = db.game_entry_predictor.find((s) => s.game_entry_id === 'entry-1')?.total_points

  assertEquals(afterFirst, 7)
  assertEquals(afterSecond, 7)
  assertEquals(afterThird, 7)
})

Deno.test('calculateScore does nothing when there are no picks at all for the gameweek', async () => {
  const engine = new PredictorEngine()
  const db = baseCalcDb({ predictor_fixture_picks: [] })
  const ctx = fakeCalcContext(db)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.game_entry_predictor[0].total_points, 0)
})

// Cross-slice correction, 2026-08-08 (docs/decisions.md § calculateScore()
// must not mutate a voided entry) — settle() never touches
// predictor_fixture_picks, so a voided entry's not-yet-resolved pick could
// previously still be freshly scored, and its points folded into
// game_entry_predictor's totals, by a later calculateScore() call. These
// two tests reproduce that and confirm the game_entries.status = 'pending'
// filter added to calculateScore() closes it.
Deno.test('calculateScore does not resolve a pick belonging to a voided entry', async () => {
  const engine = new PredictorEngine()
  const db = baseCalcDb({
    game_entries: [{ id: 'entry-1', pot_id: 'pot-1', status: 'void' }],
    predictor_fixture_picks: [basePick({ predicted_home_score: 2, predicted_away_score: 1 })], // exact match with the default fixture (2-1)
  })
  const ctx = fakeCalcContext(db)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.predictor_fixture_picks[0].points_awarded, null) // left unresolved, not scored
  assertEquals(db.predictor_fixture_picks[0].is_exact_score, false)
})

Deno.test('calculateScore does not fold a voided entry\'s points into game_entry_predictor', async () => {
  const engine = new PredictorEngine()
  const db = baseCalcDb({
    game_entries: [{ id: 'entry-1', pot_id: 'pot-1', status: 'void' }],
    predictor_fixture_picks: [basePick({ predicted_home_score: 2, predicted_away_score: 1, points_awarded: null })],
    game_entry_predictor: [{ game_entry_id: 'entry-1', total_points: 0, exact_score_count: 0, correct_scorer_count: 0 }],
  })
  const ctx = fakeCalcContext(db)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.game_entry_predictor[0].total_points, 0) // untouched — the entry never enters affectedEntryIds
})

// --- settle() ---------------------------------------------------------
// A small in-memory relational fake (pots/game_entries/entry_payments),
// same in-memory-mutate-real-rows approach as the calculateScore() fake
// above. Only these three tables — settle() (Slice 5) deliberately never
// touches predictor_fixture_picks or game_entry_predictor at all (see the
// method's own doc comment for why: no void-capable column exists on
// predictor_fixture_picks, and exclusion from any ranked output is
// generateStandings()'s job, a later slice).

interface FakeSettlePot {
  id: string
  game_type: string
  end_gameweek_id?: number | null
  // awardPrize() (Slice 8) fee/entry-fee configuration — same shared,
  // mode-agnostic pots columns Pick5Engine's/LmsEngine's own awardPrize()
  // already read (GE-4.1).
  entry_fee?: number
  admin_fee_type?: 'none' | 'fixed' | 'percentage'
  admin_fee_amount?: number | null
  admin_fee_percentage?: number | null
  charity_fee_type?: 'none' | 'fixed' | 'percentage'
  charity_fee_amount?: number | null
  charity_fee_percentage?: number | null
}
interface FakeSettleGameEntry { id: string; pot_id: string; user_id: string; status: string; payout_amount?: number; settled_at?: string | null }
interface FakeSettleEntryPayment { pot_id: string; user_id: string; scope: string; is_paid: boolean }
interface FakeSettleGameEntryPredictor { game_entry_id: string; total_points: number; exact_score_count: number; correct_scorer_count: number }
interface FakeSettleSnapshot { id: number; pot_id: string; gameweek_id: number | null; user_id: string; rank: number; score: number; meta?: unknown }
interface FakeSettleGameweek { id: number; deadline_utc: string | null }
interface FakeSettlePrize {
  id: number
  pot_id: string
  scope: string
  gameweek_id: number | null
  gross_amount?: number
  admin_fee_amount?: number
  charity_fee_amount?: number
  is_settled: boolean
  settled_at?: string | null
}
interface FakeNotification { user_id: string; pot_id: string | null; type: string; payload: Record<string, unknown> | null }

interface FakeSettleDb {
  pots: FakeSettlePot[]
  game_entries: FakeSettleGameEntry[]
  entry_payments: FakeSettleEntryPayment[]
  // settle() now calls generateStandings() unconditionally per pot
  // (Slice 6) — these two tables are what that method reads/writes.
  game_entry_predictor: FakeSettleGameEntryPredictor[]
  pot_standings_snapshots: FakeSettleSnapshot[]
  // determineWinner() (Slice 7) reads a pot's own end_gameweek_id and
  // that gameweek's deadline_utc to decide whether the season has
  // concluded.
  gameweeks: FakeSettleGameweek[]
  // awardPrize() (Slice 8) reads/writes this — settle() now calls it
  // unconditionally per pot too.
  pot_prizes: FakeSettlePrize[]
  // notifyUsers() (Slice 9) writes this, called from within awardPrize().
  notifications: FakeNotification[]
  // Failure injection for the retry-safety test, below — same purpose as
  // the LMS fake's own entriesVoidShouldFail/picksVoidShouldFail flags.
  payoutShouldFail?: boolean
  // Failure injection for notifyUsers()'s own failure-isolation test —
  // fires once, self-resets, same shape as payoutShouldFail above.
  notifyShouldFail?: boolean
}

function fakeSettleContext(db: FakeSettleDb): GameEngineContext {
  // deno-lint-ignore no-explicit-any
  function queryBuilder(table: Exclude<keyof FakeSettleDb, 'payoutShouldFail' | 'notifyShouldFail'>, getRows: () => any[]) {
    // deno-lint-ignore no-explicit-any
    const filters: ((row: any) => boolean)[] = []
    let updatePatch: Record<string, unknown> | null = null
    // deno-lint-ignore no-explicit-any
    const builder: any = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push((row) => row[col] === val)
        return builder
      },
      neq: (col: string, val: unknown) => {
        filters.push((row) => row[col] !== val)
        return builder
      },
      is: (col: string, val: unknown) => {
        filters.push((row) => row[col] === val)
        return builder
      },
      in: (col: string, vals: unknown[]) => {
        const set = new Set(vals)
        filters.push((row) => set.has(row[col]))
        return builder
      },
      update: (patch: Record<string, unknown>) => {
        updatePatch = patch
        return builder
      },
      // deno-lint-ignore no-explicit-any
      maybeSingle: () => {
        const rows = getRows().filter((row) => filters.every((f) => f(row)))
        return Promise.resolve({ data: rows[0] ?? null, error: null })
      },
      // deno-lint-ignore no-explicit-any
      single: () => {
        const rows = getRows().filter((row) => filters.every((f) => f(row)))
        return Promise.resolve({ data: rows[0] ?? null, error: null })
      },
      // deno-lint-ignore no-explicit-any
      upsert: (rows: Record<string, unknown>[]) => {
        const table_ = db[table] as unknown as { id: unknown }[]
        for (const row of rows) {
          const idx = table_.findIndex((r) => r.id === row.id)
          if (idx >= 0) Object.assign(table_[idx], row)
          else table_.push(row as never)
        }
        return Promise.resolve({ data: rows, error: null })
      },
      // deno-lint-ignore no-explicit-any
      insert: (rowOrRows: Record<string, unknown> | Record<string, unknown>[]) => {
        if (table === 'notifications' && db.notifyShouldFail) {
          db.notifyShouldFail = false
          return Promise.resolve({ data: null, error: { message: 'simulated failure' } })
        }
        // Real supabase-js accepts either a single row object or an array
        // — PredictorEngine.awardPrize()'s pot_prizes insert passes a
        // single object, unlike generateStandings()' batched array insert.
        const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
        const table_ = db[table] as unknown as Record<string, unknown>[]
        let nextId = table_.reduce((max, r) => Math.max(max, (r.id as number) ?? 0), 0) + 1
        for (const row of rows) {
          table_.push(table === 'pot_standings_snapshots' || table === 'pot_prizes' ? { id: nextId++, ...row } : row)
        }
        return Promise.resolve({ data: rows, error: null })
      },
      // deno-lint-ignore no-explicit-any
      then: (resolve: (v: { data: any; error: null } | { data: null; error: { message: string } }) => void) => {
        // Failure injection, same purpose as the LMS fake's own
        // entriesVoidShouldFail/picksVoidShouldFail flags — proves
        // awardPrize()'s retry-safety against a real mid-method write
        // failure, not just its happy path. Fires once (self-resets), so
        // a retry's identical call succeeds.
        if (table === 'game_entries' && updatePatch && 'payout_amount' in updatePatch && db.payoutShouldFail) {
          db.payoutShouldFail = false
          resolve({ data: null, error: { message: 'simulated failure' } })
          return
        }
        let rows = getRows().filter((row) => filters.every((f) => f(row)))
        // game_entries' own select('user_id, game_entry_predictor(...)')
        // needs the embedded shape generateStandings() expects — joined
        // in here rather than genuinely modeled relationally, same
        // simplification every other fake in this file already uses.
        if (table === 'game_entries') {
          rows = rows.map((row) => ({
            ...row,
            game_entry_predictor: db.game_entry_predictor.find((s) => s.game_entry_id === row.id) ?? null,
          }))
        }
        if (updatePatch) {
          for (const row of getRows().filter((r) => filters.every((f) => f(r)))) Object.assign(row, updatePatch)
        }
        resolve({ data: rows, error: null })
      },
    }
    return builder
  }

  const fakeSupabase = {
    from(table: Exclude<keyof FakeSettleDb, 'payoutShouldFail' | 'notifyShouldFail'>) {
      return queryBuilder(table, () => db[table])
    },
  }
  return { supabase: fakeSupabase as unknown as GameEngineContext['supabase'], now: () => new Date('2026-06-01T00:00:00Z') }
}

function baseSettleDb(overrides: Partial<FakeSettleDb> = {}): FakeSettleDb {
  return {
    pots: [{ id: 'pot-1', game_type: 'score_predictor' }],
    game_entries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' }],
    entry_payments: [{ pot_id: 'pot-1', user_id: 'user-1', scope: 'season', is_paid: true }],
    game_entry_predictor: [{ game_entry_id: 'entry-1', total_points: 0, exact_score_count: 0, correct_scorer_count: 0 }],
    pot_standings_snapshots: [],
    gameweeks: [],
    pot_prizes: [],
    notifications: [],
    ...overrides,
  }
}

Deno.test('settle does nothing when there are no score_predictor pots at all', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({ pots: [{ id: 'pot-1', game_type: 'pick5' }] })
  const ctx = fakeSettleContext(db)

  await engine.settle(ctx, 13)

  assertEquals(db.game_entries[0].status, 'pending')
})

Deno.test('settle leaves a paid entry pending and untouched', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb()
  const ctx = fakeSettleContext(db)

  await engine.settle(ctx, 13)

  assertEquals(db.game_entries[0].status, 'pending')
})

Deno.test('settle voids an unpaid entry', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    entry_payments: [{ pot_id: 'pot-1', user_id: 'user-1', scope: 'season', is_paid: false }],
  })
  const ctx = fakeSettleContext(db)

  await engine.settle(ctx, 13)

  assertEquals(db.game_entries[0].status, 'void')
})

Deno.test('settle treats a missing entry_payments row as unpaid', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({ entry_payments: [] })
  const ctx = fakeSettleContext(db)

  await engine.settle(ctx, 13)

  assertEquals(db.game_entries[0].status, 'void')
})

Deno.test('settle only voids the unpaid entry in a mix of paid and unpaid entries', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    game_entries: [
      { id: 'entry-paid', pot_id: 'pot-1', user_id: 'user-paid', status: 'pending' },
      { id: 'entry-unpaid', pot_id: 'pot-1', user_id: 'user-unpaid', status: 'pending' },
    ],
    entry_payments: [
      { pot_id: 'pot-1', user_id: 'user-paid', scope: 'season', is_paid: true },
      { pot_id: 'pot-1', user_id: 'user-unpaid', scope: 'season', is_paid: false },
    ],
  })
  const ctx = fakeSettleContext(db)

  await engine.settle(ctx, 13)

  assertEquals(db.game_entries.find((e) => e.id === 'entry-paid')?.status, 'pending')
  assertEquals(db.game_entries.find((e) => e.id === 'entry-unpaid')?.status, 'void')
})

Deno.test('settle never reprocesses an entry that is already void', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    game_entries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'void' }],
    entry_payments: [{ pot_id: 'pot-1', user_id: 'user-1', scope: 'season', is_paid: false }],
  })
  const ctx = fakeSettleContext(db)

  await engine.settle(ctx, 13)

  // status is untouched (still 'void', not re-written) — the entries query
  // itself only ever selects status = 'pending'.
  assertEquals(db.game_entries[0].status, 'void')
})

Deno.test('settle does nothing when there are no pending entries in any score_predictor pot', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    game_entries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'settled' }],
  })
  const ctx = fakeSettleContext(db)

  await engine.settle(ctx, 13)

  assertEquals(db.game_entries[0].status, 'settled')
})

Deno.test('settle only considers score_predictor pots, not a pick5/LMS pot sharing the same game_entries table', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [
      { id: 'pot-predictor', game_type: 'score_predictor' },
      { id: 'pot-pick5', game_type: 'pick5' },
    ],
    game_entries: [
      { id: 'entry-predictor', pot_id: 'pot-predictor', user_id: 'user-1', status: 'pending' },
      { id: 'entry-pick5', pot_id: 'pot-pick5', user_id: 'user-1', status: 'pending' },
    ],
    entry_payments: [],
  })
  const ctx = fakeSettleContext(db)

  await engine.settle(ctx, 13)

  assertEquals(db.game_entries.find((e) => e.id === 'entry-predictor')?.status, 'void')
  assertEquals(db.game_entries.find((e) => e.id === 'entry-pick5')?.status, 'pending')
})

Deno.test('settle behaves identically regardless of which gameweekId triggered the call — payment is season-wide, not cycle- or gameweek-scoped', async () => {
  const engine = new PredictorEngine()
  const dbA = baseSettleDb({ entry_payments: [] })
  const dbB = baseSettleDb({ entry_payments: [] })

  await engine.settle(fakeSettleContext(dbA), 1)
  await engine.settle(fakeSettleContext(dbB), 99)

  assertEquals(dbA.game_entries[0].status, 'void')
  assertEquals(dbB.game_entries[0].status, 'void')
})

Deno.test('settle is safe to call repeatedly — a second call finds nothing new to void', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    entry_payments: [{ pot_id: 'pot-1', user_id: 'user-1', scope: 'season', is_paid: false }],
  })
  const ctx = fakeSettleContext(db)

  await engine.settle(ctx, 13)
  assertEquals(db.game_entries[0].status, 'void')

  await engine.settle(ctx, 13)
  assertEquals(db.game_entries[0].status, 'void')
})

// --- generateStandings() -----------------------------------------------
// Reuses fakeSettleContext/baseSettleDb — settle() (Slice 6) now calls
// generateStandings() internally, so that fake already supports every
// table/query shape this method needs (game_entries with the embedded
// game_entry_predictor read, plus pot_standings_snapshots' is/eq/upsert/
// insert). No separate bespoke fake needed.

Deno.test('generateStandings returns [] for a pot with no entries', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({ game_entries: [], game_entry_predictor: [] })
  const ctx = fakeSettleContext(db)

  const rows = await engine.generateStandings(ctx, 'pot-1')

  assertEquals(rows, [])
})

Deno.test('generateStandings ranks multiple entries by cumulative points, descending', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    game_entries: [
      { id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' },
      { id: 'entry-2', pot_id: 'pot-1', user_id: 'user-2', status: 'pending' },
      { id: 'entry-3', pot_id: 'pot-1', user_id: 'user-3', status: 'pending' },
    ],
    game_entry_predictor: [
      { game_entry_id: 'entry-1', total_points: 15, exact_score_count: 2, correct_scorer_count: 1 },
      { game_entry_id: 'entry-2', total_points: 22, exact_score_count: 3, correct_scorer_count: 2 },
      { game_entry_id: 'entry-3', total_points: 8, exact_score_count: 1, correct_scorer_count: 0 },
    ],
  })
  const ctx = fakeSettleContext(db)

  const rows = await engine.generateStandings(ctx, 'pot-1')

  const byUser = new Map(rows.map((r) => [r.userId, r]))
  assertEquals(byUser.get('user-2')?.rank, 1) // 22 points
  assertEquals(byUser.get('user-1')?.rank, 2) // 15 points
  assertEquals(byUser.get('user-3')?.rank, 3) // 8 points
})

Deno.test('generateStandings shares a rank among tied cumulative scores, then skips ahead ("1224")', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    game_entries: [
      { id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' },
      { id: 'entry-2', pot_id: 'pot-1', user_id: 'user-2', status: 'pending' },
      { id: 'entry-3', pot_id: 'pot-1', user_id: 'user-3', status: 'pending' },
    ],
    game_entry_predictor: [
      { game_entry_id: 'entry-1', total_points: 10, exact_score_count: 1, correct_scorer_count: 0 },
      { game_entry_id: 'entry-2', total_points: 10, exact_score_count: 0, correct_scorer_count: 2 },
      { game_entry_id: 'entry-3', total_points: 5, exact_score_count: 0, correct_scorer_count: 0 },
    ],
  })
  const ctx = fakeSettleContext(db)

  const rows = await engine.generateStandings(ctx, 'pot-1')

  const byUser = new Map(rows.map((r) => [r.userId, r]))
  assertEquals(byUser.get('user-1')?.rank, 1)
  assertEquals(byUser.get('user-2')?.rank, 1) // tied at 10 — shares rank 1
  assertEquals(byUser.get('user-3')?.rank, 3) // skips ahead by the 2 tied at rank 1
})

Deno.test('generateStandings excludes a voided entry', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    game_entries: [
      { id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' },
      { id: 'entry-voided', pot_id: 'pot-1', user_id: 'user-voided', status: 'void' },
    ],
    game_entry_predictor: [
      { game_entry_id: 'entry-1', total_points: 10, exact_score_count: 1, correct_scorer_count: 0 },
      { game_entry_id: 'entry-voided', total_points: 50, exact_score_count: 5, correct_scorer_count: 5 }, // high score, still must not appear
    ],
  })
  const ctx = fakeSettleContext(db)

  const rows = await engine.generateStandings(ctx, 'pot-1')

  assertEquals(rows.length, 1)
  assertEquals(rows[0].userId, 'user-1')
})

Deno.test('generateStandings includes a settled entry (a future awardPrize() slice will use this status) alongside a pending one', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    game_entries: [
      { id: 'entry-1', pot_id: 'pot-1', user_id: 'user-pending', status: 'pending' },
      { id: 'entry-2', pot_id: 'pot-1', user_id: 'user-settled', status: 'settled' },
    ],
    game_entry_predictor: [
      { game_entry_id: 'entry-1', total_points: 10, exact_score_count: 1, correct_scorer_count: 0 },
      { game_entry_id: 'entry-2', total_points: 20, exact_score_count: 2, correct_scorer_count: 1 },
    ],
  })
  const ctx = fakeSettleContext(db)

  const rows = await engine.generateStandings(ctx, 'pot-1')

  assertEquals(rows.map((r) => r.userId).sort(), ['user-pending', 'user-settled'])
})

Deno.test('generateStandings excludes an entry with no game_entry_predictor extension row', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    game_entries: [
      { id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' },
      { id: 'entry-malformed', pot_id: 'pot-1', user_id: 'user-malformed', status: 'pending' },
    ],
    game_entry_predictor: [{ game_entry_id: 'entry-1', total_points: 10, exact_score_count: 1, correct_scorer_count: 0 }],
  })
  const ctx = fakeSettleContext(db)

  const rows = await engine.generateStandings(ctx, 'pot-1')

  assertEquals(rows.length, 1)
  assertEquals(rows[0].userId, 'user-1')
})

Deno.test('generateStandings populates meta with exactScoreCount/correctScorerCount', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    game_entries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' }],
    game_entry_predictor: [{ game_entry_id: 'entry-1', total_points: 17, exact_score_count: 3, correct_scorer_count: 2 }],
  })
  const ctx = fakeSettleContext(db)

  const rows = await engine.generateStandings(ctx, 'pot-1')

  assertEquals(rows[0].meta, { exactScoreCount: 3, correctScorerCount: 2 })
})

Deno.test('generateStandings writes only the overall row (gameweek_id null), never a per-gameweek one', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    game_entries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' }],
    game_entry_predictor: [{ game_entry_id: 'entry-1', total_points: 5, exact_score_count: 1, correct_scorer_count: 0 }],
  })
  const ctx = fakeSettleContext(db)

  await engine.generateStandings(ctx, 'pot-1')

  assertEquals(db.pot_standings_snapshots.length, 1)
  assertEquals(db.pot_standings_snapshots[0].gameweek_id, null)
})

Deno.test('generateStandings upserts an existing snapshot row by id rather than duplicating it, and is idempotent across repeated calls', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    game_entries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' }],
    game_entry_predictor: [{ game_entry_id: 'entry-1', total_points: 5, exact_score_count: 1, correct_scorer_count: 0 }],
  })
  const ctx = fakeSettleContext(db)

  await engine.generateStandings(ctx, 'pot-1')
  assertEquals(db.pot_standings_snapshots.length, 1)
  const firstId = db.pot_standings_snapshots[0].id

  // Score changes — same source-of-truth table a real calculateScore()
  // recompute would have updated — then generateStandings() runs again.
  db.game_entry_predictor[0].total_points = 12
  await engine.generateStandings(ctx, 'pot-1')

  assertEquals(db.pot_standings_snapshots.length, 1) // still exactly one row, not a duplicate
  assertEquals(db.pot_standings_snapshots[0].id, firstId) // same row, updated in place
  assertEquals(db.pot_standings_snapshots[0].score, 12) // reflects the recomputed total, not incremented

  await engine.generateStandings(ctx, 'pot-1')
  assertEquals(db.pot_standings_snapshots.length, 1)
  assertEquals(db.pot_standings_snapshots[0].score, 12)
})

Deno.test('generateStandings never depends on a previous snapshot — a reinstated entry (status back to pending, points recomputed) reappears automatically', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    game_entries: [
      { id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' },
      { id: 'entry-2', pot_id: 'pot-1', user_id: 'user-2', status: 'void' },
    ],
    game_entry_predictor: [
      { game_entry_id: 'entry-1', total_points: 10, exact_score_count: 1, correct_scorer_count: 0 },
      { game_entry_id: 'entry-2', total_points: 6, exact_score_count: 1, correct_scorer_count: 0 },
    ],
  })
  const ctx = fakeSettleContext(db)

  const before = await engine.generateStandings(ctx, 'pot-1')
  assertEquals(before.map((r) => r.userId), ['user-1']) // user-2 is void, excluded

  // Reinstatement (docs/decisions.md § Late Payment Override): status
  // flips back to pending and its recompute pass updates its points —
  // exactly what admin-actions/reinstate.ts does, simulated here directly
  // on the fake rather than re-exercising that whole flow.
  db.game_entries[1].status = 'pending'
  db.game_entry_predictor[1].total_points = 9

  const after = await engine.generateStandings(ctx, 'pot-1')
  assertEquals(after.map((r) => r.userId).sort(), ['user-1', 'user-2']) // reappears with no special-case code
  assertEquals(after.find((r) => r.userId === 'user-2')?.score, 9)
})

Deno.test('settle writes standings even when nobody needs voiding — the common-tick path', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    game_entries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' }],
    entry_payments: [{ pot_id: 'pot-1', user_id: 'user-1', scope: 'season', is_paid: true }],
    game_entry_predictor: [{ game_entry_id: 'entry-1', total_points: 9, exact_score_count: 1, correct_scorer_count: 0 }],
  })
  const ctx = fakeSettleContext(db)

  await engine.settle(ctx, 13)

  assertEquals(db.game_entries[0].status, 'pending') // nobody was voided
  assertEquals(db.pot_standings_snapshots.length, 1) // but standings were still (re)generated
  assertEquals(db.pot_standings_snapshots[0].score, 9)
})

// --- determineWinner() --------------------------------------------------
// Reuses fakeSettleContext/baseSettleDb — already supports every table
// this method needs (pots.end_gameweek_id, gameweeks.deadline_utc,
// game_entries + the embedded game_entry_predictor read).

const SEASON_NOT_YET_ENDED = new Date('2026-01-01T00:00:00Z')
const SEASON_ENDED = new Date('2026-06-02T00:00:00Z')

function fakeSettleContextAt(db: FakeSettleDb, now: Date): GameEngineContext {
  const ctx = fakeSettleContext(db)
  return { ...ctx, now: () => now }
}

Deno.test('determineWinner returns [] when the pot has no designated end_gameweek_id at all', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({ pots: [{ id: 'pot-1', game_type: 'score_predictor', end_gameweek_id: null }] })
  const ctx = fakeSettleContextAt(db, SEASON_ENDED)

  const winners = await engine.determineWinner(ctx, 'pot-1')

  assertEquals(winners, [])
})

Deno.test('determineWinner returns [] before the pot\'s final gameweek deadline has passed', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [{ id: 'pot-1', game_type: 'score_predictor', end_gameweek_id: 38 }],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entry_predictor: [{ game_entry_id: 'entry-1', total_points: 20, exact_score_count: 2, correct_scorer_count: 1 }],
  })
  const ctx = fakeSettleContextAt(db, SEASON_NOT_YET_ENDED)

  const winners = await engine.determineWinner(ctx, 'pot-1')

  assertEquals(winners, [])
})

Deno.test('determineWinner identifies a single winner once the season has concluded', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [{ id: 'pot-1', game_type: 'score_predictor', end_gameweek_id: 38 }],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entries: [
      { id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' },
      { id: 'entry-2', pot_id: 'pot-1', user_id: 'user-2', status: 'pending' },
    ],
    game_entry_predictor: [
      { game_entry_id: 'entry-1', total_points: 40, exact_score_count: 4, correct_scorer_count: 2 },
      { game_entry_id: 'entry-2', total_points: 25, exact_score_count: 2, correct_scorer_count: 1 },
    ],
  })
  const ctx = fakeSettleContextAt(db, SEASON_ENDED)

  const winners = await engine.determineWinner(ctx, 'pot-1')

  assertEquals(winners, ['user-1'])
})

// --- Tiebreak hierarchy (Slice 8) ---------------------------------------
// Winner hierarchy: total_points, then exact_score_count, then
// correct_scorer_count, then a genuine split. Confirmed with the repo
// owner directly before implementing — the rule as originally stated was
// labelled a Pick 5 change but its vocabulary ("exact score predictions,"
// "correct goalscorer predictions") matches nothing in Pick 5's own pick
// model, only Predictor's game_entry_predictor columns — see
// docs/decisions.md § Score Predictor prize awarding.

Deno.test('determineWinner: equal points, tiebreak resolves by exact_score_count — no split', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [{ id: 'pot-1', game_type: 'score_predictor', end_gameweek_id: 38 }],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entries: [
      { id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' },
      { id: 'entry-2', pot_id: 'pot-1', user_id: 'user-2', status: 'pending' },
      { id: 'entry-3', pot_id: 'pot-1', user_id: 'user-3', status: 'pending' },
    ],
    game_entry_predictor: [
      { game_entry_id: 'entry-1', total_points: 30, exact_score_count: 3, correct_scorer_count: 1 },
      { game_entry_id: 'entry-2', total_points: 30, exact_score_count: 2, correct_scorer_count: 2 },
      { game_entry_id: 'entry-3', total_points: 12, exact_score_count: 1, correct_scorer_count: 0 },
    ],
  })
  const ctx = fakeSettleContextAt(db, SEASON_ENDED)

  const winners = await engine.determineWinner(ctx, 'pot-1')

  // entry-1 and entry-2 are tied at 30 points, but entry-1 has more exact
  // scores (3 vs 2) — the tiebreak resolves it to a sole winner, not a split.
  assertEquals(winners, ['user-1'])
})

Deno.test('determineWinner: equal points and equal exact scores, tiebreak resolves by correct_scorer_count — no split', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [{ id: 'pot-1', game_type: 'score_predictor', end_gameweek_id: 38 }],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entries: [
      { id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' },
      { id: 'entry-2', pot_id: 'pot-1', user_id: 'user-2', status: 'pending' },
    ],
    game_entry_predictor: [
      { game_entry_id: 'entry-1', total_points: 30, exact_score_count: 2, correct_scorer_count: 4 },
      { game_entry_id: 'entry-2', total_points: 30, exact_score_count: 2, correct_scorer_count: 1 },
    ],
  })
  const ctx = fakeSettleContextAt(db, SEASON_ENDED)

  const winners = await engine.determineWinner(ctx, 'pot-1')

  // Tied on points AND exact scores — the third tiebreak level (correct
  // goalscorer count) resolves it to entry-1 alone.
  assertEquals(winners, ['user-1'])
})

Deno.test('determineWinner: a genuine complete tie (points, exact scores, AND scorer counts all equal) returns every tied entry', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [{ id: 'pot-1', game_type: 'score_predictor', end_gameweek_id: 38 }],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entries: [
      { id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' },
      { id: 'entry-2', pot_id: 'pot-1', user_id: 'user-2', status: 'pending' },
      { id: 'entry-3', pot_id: 'pot-1', user_id: 'user-3', status: 'pending' },
    ],
    game_entry_predictor: [
      { game_entry_id: 'entry-1', total_points: 30, exact_score_count: 2, correct_scorer_count: 1 },
      { game_entry_id: 'entry-2', total_points: 30, exact_score_count: 2, correct_scorer_count: 1 },
      { game_entry_id: 'entry-3', total_points: 12, exact_score_count: 5, correct_scorer_count: 9 }, // lower points — never reached, tiebreak only narrows the top tier
    ],
  })
  const ctx = fakeSettleContextAt(db, SEASON_ENDED)

  const winners = await engine.determineWinner(ctx, 'pot-1')

  assertEquals(winners.sort(), ['user-1', 'user-2']) // nothing left to break the tie with — both win, split at awardPrize()
})

Deno.test('determineWinner excludes a voided entry even if it would otherwise have the highest score', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [{ id: 'pot-1', game_type: 'score_predictor', end_gameweek_id: 38 }],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entries: [
      { id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' },
      { id: 'entry-voided', pot_id: 'pot-1', user_id: 'user-voided', status: 'void' },
    ],
    game_entry_predictor: [
      { game_entry_id: 'entry-1', total_points: 15, exact_score_count: 1, correct_scorer_count: 0 },
      { game_entry_id: 'entry-voided', total_points: 99, exact_score_count: 9, correct_scorer_count: 9 },
    ],
  })
  const ctx = fakeSettleContextAt(db, SEASON_ENDED)

  const winners = await engine.determineWinner(ctx, 'pot-1')

  assertEquals(winners, ['user-1'])
})

Deno.test('determineWinner includes a reinstated entry (status back to pending, points recomputed) with no special-case code', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [{ id: 'pot-1', game_type: 'score_predictor', end_gameweek_id: 38 }],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entries: [
      { id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' },
      { id: 'entry-2', pot_id: 'pot-1', user_id: 'user-2', status: 'void' },
    ],
    game_entry_predictor: [
      { game_entry_id: 'entry-1', total_points: 10, exact_score_count: 1, correct_scorer_count: 0 },
      { game_entry_id: 'entry-2', total_points: 25, exact_score_count: 2, correct_scorer_count: 1 },
    ],
  })
  const ctx = fakeSettleContextAt(db, SEASON_ENDED)

  const before = await engine.determineWinner(ctx, 'pot-1')
  assertEquals(before, ['user-1']) // user-2 is void, excluded despite the higher score

  // Reinstatement (docs/decisions.md § Late Payment Override): status
  // flips back to pending, points already recomputed by that flow.
  db.game_entries[1].status = 'pending'

  const after = await engine.determineWinner(ctx, 'pot-1')
  assertEquals(after, ['user-2']) // now included, and now the sole winner on its own higher score
})

Deno.test('determineWinner returns [] when there are no entries at all', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [{ id: 'pot-1', game_type: 'score_predictor', end_gameweek_id: 38 }],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entries: [],
    game_entry_predictor: [],
  })
  const ctx = fakeSettleContextAt(db, SEASON_ENDED)

  const winners = await engine.determineWinner(ctx, 'pot-1')

  assertEquals(winners, [])
})

Deno.test('determineWinner is idempotent — repeated calls with no state change return the same result, performs no writes', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [{ id: 'pot-1', game_type: 'score_predictor', end_gameweek_id: 38 }],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entry_predictor: [{ game_entry_id: 'entry-1', total_points: 18, exact_score_count: 2, correct_scorer_count: 0 }],
  })
  const ctx = fakeSettleContextAt(db, SEASON_ENDED)

  const first = await engine.determineWinner(ctx, 'pot-1')
  const second = await engine.determineWinner(ctx, 'pot-1')
  const third = await engine.determineWinner(ctx, 'pot-1')

  assertEquals(first, ['user-1'])
  assertEquals(second, ['user-1'])
  assertEquals(third, ['user-1'])
  assertEquals(db.pot_standings_snapshots.length, 0) // no writes of any kind — pure read
  assertEquals(db.game_entries[0].status, 'pending') // unchanged
})

Deno.test('predictor_cycle_mode has no bearing on determineWinner() — same winner regardless of the pot\'s configured cycle mode', async () => {
  const engine = new PredictorEngine()
  const dbTwoHalves = baseSettleDb({
    pots: [{ id: 'pot-1', game_type: 'score_predictor', end_gameweek_id: 38 }],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entry_predictor: [{ game_entry_id: 'entry-1', total_points: 33, exact_score_count: 3, correct_scorer_count: 1 }],
  })
  const dbSingleCycle = baseSettleDb({
    pots: [{ id: 'pot-1', game_type: 'score_predictor', end_gameweek_id: 38 }],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entry_predictor: [{ game_entry_id: 'entry-1', total_points: 33, exact_score_count: 3, correct_scorer_count: 1 }],
  })

  // predictor_cycle_mode isn't even part of the fake's pot shape — this
  // test's real point is that determineWinner() never reads it at all,
  // so two otherwise-identical pots produce the identical winner
  // regardless of what that column would say in a real database.
  const winnersA = await engine.determineWinner(fakeSettleContextAt(dbTwoHalves, SEASON_ENDED), 'pot-1')
  const winnersB = await engine.determineWinner(fakeSettleContextAt(dbSingleCycle, SEASON_ENDED), 'pot-1')

  assertEquals(winnersA, ['user-1'])
  assertEquals(winnersB, ['user-1'])
})

// --- awardPrize() --------------------------------------------------------
// Reuses fakeSettleContext(At)/baseSettleDb — already supports every
// table this method needs (pots' fee columns, pot_prizes, game_entries).

function basePrizePot(overrides: Partial<FakeSettlePot> = {}): FakeSettlePot {
  return {
    id: 'pot-1',
    game_type: 'score_predictor',
    end_gameweek_id: 38,
    entry_fee: 10,
    admin_fee_type: 'none',
    admin_fee_amount: null,
    admin_fee_percentage: null,
    charity_fee_type: 'none',
    charity_fee_amount: null,
    charity_fee_percentage: null,
    ...overrides,
  }
}

Deno.test('awardPrize does nothing while the season is still in progress', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [basePrizePot()],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
  })
  const ctx = fakeSettleContextAt(db, SEASON_NOT_YET_ENDED)

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.pot_prizes.length, 0)
  assertEquals(db.game_entries[0].status, 'pending')
})

Deno.test('awardPrize: a sole winner gets the entire net prize; every non-void entry is settled', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [basePrizePot()],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entries: [
      { id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' },
      { id: 'entry-2', pot_id: 'pot-1', user_id: 'user-2', status: 'pending' },
    ],
    game_entry_predictor: [
      { game_entry_id: 'entry-1', total_points: 40, exact_score_count: 4, correct_scorer_count: 2 },
      { game_entry_id: 'entry-2', total_points: 25, exact_score_count: 2, correct_scorer_count: 1 },
    ],
  })
  const ctx = fakeSettleContextAt(db, SEASON_ENDED)

  await engine.awardPrize(ctx, 'pot-1')

  // gross = 10 * 2 entries = 20, no fees -> net = 20, sole winner gets it all
  const winner = db.game_entries.find((e) => e.user_id === 'user-1')!
  const loser = db.game_entries.find((e) => e.user_id === 'user-2')!
  assertEquals(winner.payout_amount, 20)
  assertEquals(winner.status, 'settled')
  assertEquals(loser.payout_amount ?? 0, 0) // never touched — not a winner
  assertEquals(loser.status, 'settled') // every non-void entry settles, not just winners

  assertEquals(db.pot_prizes.length, 1)
  assertEquals(db.pot_prizes[0].gross_amount, 20)
  assertEquals(db.pot_prizes[0].is_settled, true)
})

Deno.test('awardPrize: tied winners (after the tiebreak hierarchy still tied) split the net prize equally, floored to cents', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [basePrizePot({ entry_fee: 10 })],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entries: [
      { id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' },
      { id: 'entry-2', pot_id: 'pot-1', user_id: 'user-2', status: 'pending' },
      { id: 'entry-3', pot_id: 'pot-1', user_id: 'user-3', status: 'pending' },
    ],
    game_entry_predictor: [
      { game_entry_id: 'entry-1', total_points: 30, exact_score_count: 2, correct_scorer_count: 1 },
      { game_entry_id: 'entry-2', total_points: 30, exact_score_count: 2, correct_scorer_count: 1 }, // genuine complete tie with entry-1
      { game_entry_id: 'entry-3', total_points: 10, exact_score_count: 0, correct_scorer_count: 0 },
    ],
  })
  const ctx = fakeSettleContextAt(db, SEASON_ENDED)

  await engine.awardPrize(ctx, 'pot-1')

  // gross = 10 * 3 = 30, net = 30, split 2 ways = 15 each (divides evenly here)
  const winner1 = db.game_entries.find((e) => e.user_id === 'user-1')!
  const winner2 = db.game_entries.find((e) => e.user_id === 'user-2')!
  const loser = db.game_entries.find((e) => e.user_id === 'user-3')!
  assertEquals(winner1.payout_amount, 15)
  assertEquals(winner2.payout_amount, 15)
  assertEquals(loser.payout_amount ?? 0, 0)
})

Deno.test('awardPrize correctly applies percentage admin fee and fixed charity fee before splitting', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [basePrizePot({ entry_fee: 20, admin_fee_type: 'percentage', admin_fee_percentage: 10, charity_fee_type: 'fixed', charity_fee_amount: 5 })],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' }],
    game_entry_predictor: [{ game_entry_id: 'entry-1', total_points: 12, exact_score_count: 1, correct_scorer_count: 0 }],
  })
  const ctx = fakeSettleContextAt(db, SEASON_ENDED)

  await engine.awardPrize(ctx, 'pot-1')

  // gross = 20 * 1 = 20; admin fee = 10% of 20 = 2; charity fee = 5 (fixed);
  // net = 20 - 2 - 5 = 13
  assertEquals(db.pot_prizes[0].gross_amount, 20)
  assertEquals(db.pot_prizes[0].admin_fee_amount, 2)
  assertEquals(db.pot_prizes[0].charity_fee_amount, 5)
  assertEquals(db.game_entries[0].payout_amount, 13)
})

Deno.test('awardPrize throws PredictorPrizePoolExceededError rather than clamping fees that exceed the gross pool', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [basePrizePot({ entry_fee: 10, admin_fee_type: 'fixed', admin_fee_amount: 8, charity_fee_type: 'fixed', charity_fee_amount: 5 })],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' }],
    game_entry_predictor: [{ game_entry_id: 'entry-1', total_points: 5, exact_score_count: 1, correct_scorer_count: 0 }],
  })
  const ctx = fakeSettleContextAt(db, SEASON_ENDED)

  // gross = 10; fees = 8 + 5 = 13 > gross -> net would be negative
  await assertRejects(() => engine.awardPrize(ctx, 'pot-1'), PredictorPrizePoolExceededError)
  assertEquals(db.pot_prizes.length, 0) // nothing written — fails before any write
  assertEquals(db.game_entries[0].status, 'pending') // entry left untouched too
})

Deno.test('awardPrize is idempotent — a second call on an already-settled pot is a silent no-op', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [basePrizePot()],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' }],
    game_entry_predictor: [{ game_entry_id: 'entry-1', total_points: 5, exact_score_count: 1, correct_scorer_count: 0 }],
  })
  const ctx = fakeSettleContextAt(db, SEASON_ENDED)

  await engine.awardPrize(ctx, 'pot-1')
  assertEquals(db.pot_prizes.length, 1)
  const firstPayout = db.game_entries[0].payout_amount

  // Mutate the source data as if a later, unrelated call to
  // calculateScore() somehow changed it — an already-settled pot must
  // never re-derive or re-pay from it.
  db.game_entry_predictor[0].total_points = 999

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.pot_prizes.length, 1) // still exactly one prize row
  assertEquals(db.game_entries[0].payout_amount, firstPayout) // unchanged, not re-derived
})

Deno.test('awardPrize: retry after an injected failure does not double-pay and completes correctly on the next call', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [basePrizePot()],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' }],
    game_entry_predictor: [{ game_entry_id: 'entry-1', total_points: 5, exact_score_count: 1, correct_scorer_count: 0 }],
    payoutShouldFail: true,
  })
  const ctx = fakeSettleContextAt(db, SEASON_ENDED)

  // First call: the payout write fails partway through (simulating a
  // transient DB/network error), same "one write fails, confirm nothing
  // partial was left behind, then retry" shape the hardening sprint's own
  // Pick5Engine/LmsEngine tests use.
  await assertRejects(() => engine.awardPrize(ctx, 'pot-1'))
  assertEquals(db.pot_prizes.length, 0) // the trailing pot_prizes write never happened
  assertEquals(db.game_entries[0].status, 'settled') // settling itself (before the failed payout) already landed — naturally idempotent, safe to leave as-is
  assertEquals(db.game_entries[0].payout_amount ?? 0, 0) // the failed payout write never landed

  // Retry — same call, no special recovery action needed; the injected
  // failure flag already reset itself after firing once.
  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.pot_prizes.length, 1)
  assertEquals(db.pot_prizes[0].is_settled, true)
  assertEquals(db.game_entries[0].payout_amount, 10) // gross = entry_fee 10 * 1 entry, no fees, sole winner
})

// --- notifyUsers() -------------------------------------------------------

Deno.test('notifyUsers writes a notification row with the given type and payload', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb()
  const ctx = fakeSettleContext(db)

  await engine.notifyUsers(ctx, { userId: 'user-1', potId: 'pot-1', type: 'predictor.prize_awarded', payload: { amount: 10, tied: false } })

  assertEquals(db.notifications.length, 1)
  assertEquals(db.notifications[0], { user_id: 'user-1', pot_id: 'pot-1', type: 'predictor.prize_awarded', payload: { amount: 10, tied: false } })
})

Deno.test('notifyUsers throws when the write fails', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({ notifyShouldFail: true })
  const ctx = fakeSettleContext(db)

  await assertRejects(() => engine.notifyUsers(ctx, { userId: 'user-1', potId: 'pot-1', type: 'predictor.prize_awarded' }))
})

// --- awardPrize() notification integration (Slice 9) ---------------------

Deno.test('awardPrize writes a predictor.prize_awarded notification for a sole winner', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [basePrizePot()],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' }],
    game_entry_predictor: [{ game_entry_id: 'entry-1', total_points: 5, exact_score_count: 1, correct_scorer_count: 0 }],
  })
  const ctx = fakeSettleContextAt(db, SEASON_ENDED)

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.notifications.length, 1)
  assertEquals(db.notifications[0].user_id, 'user-1')
  assertEquals(db.notifications[0].pot_id, 'pot-1')
  assertEquals(db.notifications[0].type, 'predictor.prize_awarded')
  assertEquals(db.notifications[0].payload, { amount: 10, tied: false })
})

Deno.test('awardPrize writes one notification per tied winner, each correctly marked tied', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [basePrizePot()],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entries: [
      { id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' },
      { id: 'entry-2', pot_id: 'pot-1', user_id: 'user-2', status: 'pending' },
    ],
    game_entry_predictor: [
      { game_entry_id: 'entry-1', total_points: 20, exact_score_count: 2, correct_scorer_count: 1 },
      { game_entry_id: 'entry-2', total_points: 20, exact_score_count: 2, correct_scorer_count: 1 }, // genuine complete tie
    ],
  })
  const ctx = fakeSettleContextAt(db, SEASON_ENDED)

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.notifications.length, 2) // one per winning user, never once per pot
  const byUser = new Map(db.notifications.map((n) => [n.user_id, n]))
  assertEquals(byUser.get('user-1')?.payload, { amount: 10, tied: true })
  assertEquals(byUser.get('user-2')?.payload, { amount: 10, tied: true })
})

Deno.test('awardPrize still awards the prize and payout when the notification write fails — failure isolation', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [basePrizePot()],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' }],
    game_entry_predictor: [{ game_entry_id: 'entry-1', total_points: 5, exact_score_count: 1, correct_scorer_count: 0 }],
    notifyShouldFail: true,
  })
  const ctx = fakeSettleContextAt(db, SEASON_ENDED)

  // Must not throw — the notification failure is caught and logged at
  // awardPrize()'s own call site, never propagated (same discipline
  // Pick5Engine's/LmsEngine's own call sites already established).
  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.notifications.length, 0) // the one attempted write failed
  assertEquals(db.game_entries[0].payout_amount, 10) // the payout itself is unaffected
  assertEquals(db.pot_prizes[0]?.is_settled, true) // and the pot is still correctly, fully settled
})

Deno.test('awardPrize notifies the winner still standing after one of two notification writes fails — remaining winners are still notified', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [basePrizePot()],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entries: [
      { id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' },
      { id: 'entry-2', pot_id: 'pot-1', user_id: 'user-2', status: 'pending' },
    ],
    game_entry_predictor: [
      { game_entry_id: 'entry-1', total_points: 20, exact_score_count: 2, correct_scorer_count: 1 },
      { game_entry_id: 'entry-2', total_points: 20, exact_score_count: 2, correct_scorer_count: 1 },
    ],
    notifyShouldFail: true, // fires once — fails the FIRST winner's notification only, self-resets
  })
  const ctx = fakeSettleContextAt(db, SEASON_ENDED)

  await engine.awardPrize(ctx, 'pot-1')

  // One winner's notification failed, but the loop continued — the other
  // winner still got theirs. Both were still paid regardless (payouts
  // happen in an earlier, unrelated loop).
  assertEquals(db.notifications.length, 1)
  assertEquals(db.game_entries.every((e) => e.payout_amount === 10), true)
})

Deno.test('awardPrize does not write a duplicate notification on an idempotent second call', async () => {
  const engine = new PredictorEngine()
  const db = baseSettleDb({
    pots: [basePrizePot()],
    gameweeks: [{ id: 38, deadline_utc: '2026-06-01T00:00:00Z' }],
    game_entries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' }],
    game_entry_predictor: [{ game_entry_id: 'entry-1', total_points: 5, exact_score_count: 1, correct_scorer_count: 0 }],
  })
  const ctx = fakeSettleContextAt(db, SEASON_ENDED)

  await engine.awardPrize(ctx, 'pot-1')
  assertEquals(db.notifications.length, 1)

  // Second call: the outer is_settled short-circuit means the method
  // returns before the notify loop is ever reached again — no dedup
  // logic needed on the notifications table itself, matching Pick5Engine's/
  // LmsEngine's own established precedent.
  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.notifications.length, 1)
})
