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
interface FakeCalcGameEntry { id: string; pot_id: string }
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
    game_entries: [{ id: 'entry-1', pot_id: 'pot-1' }],
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
