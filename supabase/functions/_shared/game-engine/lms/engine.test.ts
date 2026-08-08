// Unit tests for LmsEngine.validateEntry() — Milestone 5 Slice 2. Uses a
// fake Supabase client that only implements the exact query chains
// validateEntry() issues against game_entry_lms/fixtures/lms_team_picks, same
// fake-client-over-real-DB approach Pick5Engine's own test suite established.

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { GameEngineContext } from '../contracts.ts'
import type { GameEntry } from '../types.ts'
import { LmsEngine } from './engine.ts'
import { LmsFinalPredictionNotImplementedError, LmsPrizePoolExceededError, LmsValidationError } from './errors.ts'

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

Deno.test('generateStandings/determineWinner/awardPrize/notifyUsers are not implemented yet', async () => {
  const engine = new LmsEngine()
  const ctx = fakeContext(ALIVE_WITH_FIXTURE_NO_PRIOR)

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

// --- calculateScore() --------------------------------------------------------
// A small in-memory relational fake, since calculateScore() reads across
// gameweeks/pots/game_entries/game_entry_lms/lms_team_picks/fixtures. Same
// approach in spirit as the other fakes in this file (mutate real rows so a
// test proves the method's own filtering, not just that a query fired) —
// generalized here because bespoke per-shape builders would be too verbose
// for six tables.

interface FakeGameweek { id: number; deadline_utc: string | null }
interface FakePot { id: string; game_type: string; start_gameweek_id: number | null }
interface FakeGameEntry { id: string; pot_id: string }
interface FakeGameEntryLms { game_entry_id: string; competitive_status: string; eliminated_gameweek_id: number | null }
interface FakePick { id: number; game_entry_id: string; gameweek_id: number; team_id: number; result: string }
interface FakeFixture { gameweek_id: number; home_team_id: number; away_team_id: number; status: string; home_goals: number; away_goals: number }
interface FakeEntryPayment { pot_id: string; user_id: string; is_paid: boolean; scope: string }

interface FakePotPrize { pot_id: string; scope: string; is_settled: boolean }

interface FakeDb {
  gameweeks: FakeGameweek[]
  pots: FakePot[]
  game_entries: (FakeGameEntry & { user_id?: string; status?: string })[]
  game_entry_lms: FakeGameEntryLms[]
  lms_team_picks: FakePick[]
  fixtures: FakeFixture[]
  entry_payments: FakeEntryPayment[]
  pot_prizes: FakePotPrize[]
  // Hardening sprint, 2026-08-06: failure-injection flags for settle()'s
  // payment-void partial-write risk. Table-level (not patch-aware) is
  // sufficient here — unlike Pick5's fake, this context's game_entries is
  // only ever updated by settle()'s void step (LMS never transitions to
  // 'settled' inside settle() itself, see Slice 5), and lms_team_picks is
  // only ever updated (not upserted) by that same void step.
  entriesVoidShouldFail?: boolean
  picksVoidShouldFail?: boolean
}

function fakeCalculateScoreContext(db: FakeDb, now: Date): GameEngineContext {
  function selectBuilder(rows: Record<string, unknown>[]) {
    let filtered = rows
    // deno-lint-ignore no-explicit-any
    const builder: any = {
      eq(col: string, val: unknown) { filtered = filtered.filter((r) => r[col] === val); return builder },
      in(col: string, vals: unknown[]) { const set = new Set(vals); filtered = filtered.filter((r) => set.has(r[col])); return builder },
      lte(col: string, val: unknown) { filtered = filtered.filter((r) => r[col] !== null && (r[col] as number) <= (val as number)); return builder },
      maybeSingle: () => Promise.resolve({ data: filtered[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: filtered, error: null }),
    }
    return builder
  }

  const fakeSupabase = {
    from(table: keyof FakeDb) {
      return {
        select: () => selectBuilder(db[table] as unknown as Record<string, unknown>[]),
        update(patch: Record<string, unknown>) {
          return {
            in: (col: string, vals: unknown[]) => {
              if (table === 'game_entries' && db.entriesVoidShouldFail) {
                return Promise.resolve({ data: null, error: { message: 'Fake update() simulated failure' } })
              }
              if (table === 'lms_team_picks' && db.picksVoidShouldFail) {
                return Promise.resolve({ data: null, error: { message: 'Fake update() simulated failure' } })
              }
              const set = new Set(vals)
              for (const row of db[table] as unknown as Record<string, unknown>[]) {
                if (set.has(row[col])) Object.assign(row, patch)
              }
              return Promise.resolve({ data: null, error: null })
            },
          }
        },
        upsert(rows: { id: number }[]) {
          for (const row of rows) {
            const idx = (db[table] as unknown as { id: number }[]).findIndex((r) => r.id === row.id)
            if (idx >= 0) Object.assign((db[table] as unknown as Record<string, unknown>[])[idx], row)
          }
          return Promise.resolve({ data: rows, error: null })
        },
      }
    },
  }

  return { supabase: fakeSupabase as unknown as GameEngineContext['supabase'], now: () => now }
}

function baseDb(overrides: Partial<FakeDb> = {}): FakeDb {
  return {
    gameweeks: [{ id: 13, deadline_utc: '2026-01-01T00:00:00Z' }],
    pots: [{ id: 'pot-1', game_type: 'last_man_standing', start_gameweek_id: 1 }],
    game_entries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' }],
    game_entry_lms: [{ game_entry_id: 'entry-1', competitive_status: 'alive', eliminated_gameweek_id: null }],
    lms_team_picks: [],
    fixtures: [],
    entry_payments: [],
    pot_prizes: [],
    ...overrides,
  }
}

const AFTER_DEADLINE = new Date('2026-01-01T00:00:01Z')
const BEFORE_DEADLINE = new Date('2025-12-31T00:00:00Z')

Deno.test('calculateScore does nothing before the gameweek deadline', async () => {
  const engine = new LmsEngine()
  const db = baseDb({
    lms_team_picks: [{ id: 1, game_entry_id: 'entry-1', gameweek_id: 13, team_id: 100, result: 'pending' }],
  })
  const ctx = fakeCalculateScoreContext(db, BEFORE_DEADLINE)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.lms_team_picks[0].result, 'pending')
  assertEquals(db.game_entry_lms[0].competitive_status, 'alive')
})

Deno.test('calculateScore skips pots whose competition has not reached this gameweek yet', async () => {
  const engine = new LmsEngine()
  const db = baseDb({
    pots: [{ id: 'pot-1', game_type: 'last_man_standing', start_gameweek_id: 20 }],
  })
  const ctx = fakeCalculateScoreContext(db, AFTER_DEADLINE)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.game_entry_lms[0].competitive_status, 'alive')
})

Deno.test('calculateScore labels a live, currently-winning pick "winning" without eliminating', async () => {
  const engine = new LmsEngine()
  const db = baseDb({
    lms_team_picks: [{ id: 1, game_entry_id: 'entry-1', gameweek_id: 13, team_id: 100, result: 'pending' }],
    fixtures: [{ gameweek_id: 13, home_team_id: 100, away_team_id: 200, status: 'live', home_goals: 1, away_goals: 0 }],
  })
  const ctx = fakeCalculateScoreContext(db, AFTER_DEADLINE)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.lms_team_picks[0].result, 'winning')
  assertEquals(db.game_entry_lms[0].competitive_status, 'alive')
})

Deno.test('calculateScore labels a live, currently-losing pick "losing" without eliminating yet', async () => {
  const engine = new LmsEngine()
  const db = baseDb({
    lms_team_picks: [{ id: 1, game_entry_id: 'entry-1', gameweek_id: 13, team_id: 100, result: 'pending' }],
    fixtures: [{ gameweek_id: 13, home_team_id: 100, away_team_id: 200, status: 'live', home_goals: 0, away_goals: 1 }],
  })
  const ctx = fakeCalculateScoreContext(db, AFTER_DEADLINE)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.lms_team_picks[0].result, 'losing')
  assertEquals(db.game_entry_lms[0].competitive_status, 'alive')
})

Deno.test('calculateScore resolves a finished, won fixture to "won" and does not eliminate', async () => {
  const engine = new LmsEngine()
  const db = baseDb({
    lms_team_picks: [{ id: 1, game_entry_id: 'entry-1', gameweek_id: 13, team_id: 100, result: 'winning' }],
    fixtures: [{ gameweek_id: 13, home_team_id: 100, away_team_id: 200, status: 'finished', home_goals: 2, away_goals: 1 }],
  })
  const ctx = fakeCalculateScoreContext(db, AFTER_DEADLINE)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.lms_team_picks[0].result, 'won')
  assertEquals(db.game_entry_lms[0].competitive_status, 'alive')
})

Deno.test('calculateScore resolves a finished, lost fixture to "lost" and eliminates the entry', async () => {
  const engine = new LmsEngine()
  const db = baseDb({
    lms_team_picks: [{ id: 1, game_entry_id: 'entry-1', gameweek_id: 13, team_id: 100, result: 'losing' }],
    fixtures: [{ gameweek_id: 13, home_team_id: 100, away_team_id: 200, status: 'finished', home_goals: 0, away_goals: 1 }],
  })
  const ctx = fakeCalculateScoreContext(db, AFTER_DEADLINE)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.lms_team_picks[0].result, 'lost')
  assertEquals(db.game_entry_lms[0].competitive_status, 'eliminated')
  assertEquals(db.game_entry_lms[0].eliminated_gameweek_id, 13)
})

Deno.test('calculateScore treats a draw the same as a loss — reuses "lost", eliminates the entry', async () => {
  const engine = new LmsEngine()
  const db = baseDb({
    lms_team_picks: [{ id: 1, game_entry_id: 'entry-1', gameweek_id: 13, team_id: 100, result: 'pending' }],
    fixtures: [{ gameweek_id: 13, home_team_id: 100, away_team_id: 200, status: 'finished', home_goals: 1, away_goals: 1 }],
  })
  const ctx = fakeCalculateScoreContext(db, AFTER_DEADLINE)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.lms_team_picks[0].result, 'lost')
  assertEquals(db.game_entry_lms[0].competitive_status, 'eliminated')
})

Deno.test('calculateScore eliminates an alive entry with no pick at all for this gameweek — no automatic pick created', async () => {
  const engine = new LmsEngine()
  const db = baseDb() // no picks at all
  const ctx = fakeCalculateScoreContext(db, AFTER_DEADLINE)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.game_entry_lms[0].competitive_status, 'eliminated')
  assertEquals(db.game_entry_lms[0].eliminated_gameweek_id, 13)
  assertEquals(db.lms_team_picks.length, 0) // still no pick row — never fabricated one
})

Deno.test('calculateScore never touches an already-eliminated entry', async () => {
  const engine = new LmsEngine()
  const db = baseDb({
    game_entry_lms: [{ game_entry_id: 'entry-1', competitive_status: 'eliminated', eliminated_gameweek_id: 10 }],
  })
  const ctx = fakeCalculateScoreContext(db, AFTER_DEADLINE)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.game_entry_lms[0].eliminated_gameweek_id, 10) // unchanged, not overwritten to 13
})

Deno.test('calculateScore leaves a pick pending when its team has no fixture data yet', async () => {
  const engine = new LmsEngine()
  const db = baseDb({
    lms_team_picks: [{ id: 1, game_entry_id: 'entry-1', gameweek_id: 13, team_id: 100, result: 'pending' }],
    fixtures: [], // no fixture data synced yet
  })
  const ctx = fakeCalculateScoreContext(db, AFTER_DEADLINE)

  await engine.calculateScore(ctx, 13)

  assertEquals(db.lms_team_picks[0].result, 'pending')
  assertEquals(db.game_entry_lms[0].competitive_status, 'alive')
})

// --- settle() ----------------------------------------------------------------
// Reuses the same generic in-memory relational fake as calculateScore()'s
// tests — settle() reads a subset of the same tables (pots, game_entries,
// entry_payments, lms_team_picks).

Deno.test('settle does nothing when there are no eligible LMS pots for this gameweek', async () => {
  const engine = new LmsEngine()
  const db = baseDb({ pots: [{ id: 'pot-1', game_type: 'last_man_standing', start_gameweek_id: 20 }] })
  const ctx = fakeCalculateScoreContext(db, AFTER_DEADLINE)

  await engine.settle(ctx, 13)

  assertEquals(db.game_entries[0].status, 'pending')
})

Deno.test('settle leaves a paid entry pending and its picks untouched', async () => {
  const engine = new LmsEngine()
  const db = baseDb({
    entry_payments: [{ pot_id: 'pot-1', user_id: 'user-1', is_paid: true, scope: 'season' }],
    lms_team_picks: [{ id: 1, game_entry_id: 'entry-1', gameweek_id: 13, team_id: 100, result: 'won' }],
  })
  const ctx = fakeCalculateScoreContext(db, AFTER_DEADLINE)

  await engine.settle(ctx, 13)

  assertEquals(db.game_entries[0].status, 'pending')
  assertEquals(db.lms_team_picks[0].result, 'won')
})

Deno.test('settle voids an unpaid entry and all of its picks, across every gameweek', async () => {
  const engine = new LmsEngine()
  const db = baseDb({
    entry_payments: [{ pot_id: 'pot-1', user_id: 'user-1', is_paid: false, scope: 'season' }],
    lms_team_picks: [
      { id: 1, game_entry_id: 'entry-1', gameweek_id: 12, team_id: 99, result: 'won' },
      { id: 2, game_entry_id: 'entry-1', gameweek_id: 13, team_id: 100, result: 'pending' },
    ],
  })
  const ctx = fakeCalculateScoreContext(db, AFTER_DEADLINE)

  await engine.settle(ctx, 13)

  assertEquals(db.game_entries[0].status, 'void')
  assertEquals(db.lms_team_picks[0].result, 'void')
  assertEquals(db.lms_team_picks[1].result, 'void')
})

// --- settle() partial-write retry-safety (hardening sprint, 2026-08-06) ---
// Same architecture-review finding, same fix as Pick5Engine.settle(): picks
// are voided BEFORE the entries themselves, so a failure on the entries
// write can't strand an entry outside the status='pending' selection a
// retry depends on.

Deno.test('settle: if voiding picks fails, the entry is untouched and stays retryable', async () => {
  const engine = new LmsEngine()
  const db = baseDb({
    entry_payments: [{ pot_id: 'pot-1', user_id: 'user-1', is_paid: false, scope: 'season' }],
    lms_team_picks: [{ id: 1, game_entry_id: 'entry-1', gameweek_id: 13, team_id: 100, result: 'won' }],
    picksVoidShouldFail: true,
  })
  const ctx = fakeCalculateScoreContext(db, AFTER_DEADLINE)

  await assertRejects(() => engine.settle(ctx, 13))

  assertEquals(db.game_entries[0].status, 'pending', 'the entry was never touched — still selectable by a retry')
  assertEquals(db.lms_team_picks[0].result, 'won', 'the pick write itself failed, so it is unchanged')

  db.picksVoidShouldFail = false
  await engine.settle(ctx, 13)
  assertEquals(db.game_entries[0].status, 'void')
  assertEquals(db.lms_team_picks[0].result, 'void')
})

Deno.test('settle: if voiding the entry fails after its picks were already voided, a retry still finds and finishes it', async () => {
  const engine = new LmsEngine()
  const db = baseDb({
    entry_payments: [{ pot_id: 'pot-1', user_id: 'user-1', is_paid: false, scope: 'season' }],
    lms_team_picks: [{ id: 1, game_entry_id: 'entry-1', gameweek_id: 13, team_id: 100, result: 'won' }],
    entriesVoidShouldFail: true,
  })
  const ctx = fakeCalculateScoreContext(db, AFTER_DEADLINE)

  await assertRejects(() => engine.settle(ctx, 13))

  // The picks write (which now runs first) already succeeded, even though
  // the overall call failed and threw.
  assertEquals(db.lms_team_picks[0].result, 'void')
  assertEquals(db.game_entries[0].status, 'pending', 'still pending — this is what makes the retry below possible')

  // This is the actual bug the review found: with the OLD write order
  // (entries first), this entry would now be permanently 'void' with an
  // un-voided pick, and this retry would silently find nothing to do
  // (status='pending' no longer matches it). With the fix, it's still
  // 'pending', so the retry correctly finds it, re-voids its (already-void)
  // picks harmlessly, and this time succeeds in voiding the entry too.
  db.entriesVoidShouldFail = false
  await engine.settle(ctx, 13)
  assertEquals(db.game_entries[0].status, 'void')
  assertEquals(db.lms_team_picks[0].result, 'void')
})

Deno.test('settle treats a missing entry_payments row as unpaid', async () => {
  const engine = new LmsEngine()
  const db = baseDb({ entry_payments: [] }) // no row at all for this pot/user
  const ctx = fakeCalculateScoreContext(db, AFTER_DEADLINE)

  await engine.settle(ctx, 13)

  assertEquals(db.game_entries[0].status, 'void')
})

Deno.test('settle only voids the unpaid entry in a mix of paid and unpaid entries', async () => {
  const engine = new LmsEngine()
  const db = baseDb({
    game_entries: [
      { id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'pending' },
      { id: 'entry-2', pot_id: 'pot-1', user_id: 'user-2', status: 'pending' },
    ],
    game_entry_lms: [
      { game_entry_id: 'entry-1', competitive_status: 'alive', eliminated_gameweek_id: null },
      { game_entry_id: 'entry-2', competitive_status: 'alive', eliminated_gameweek_id: null },
    ],
    entry_payments: [
      { pot_id: 'pot-1', user_id: 'user-1', is_paid: true, scope: 'season' },
      { pot_id: 'pot-1', user_id: 'user-2', is_paid: false, scope: 'season' },
    ],
  })
  const ctx = fakeCalculateScoreContext(db, AFTER_DEADLINE)

  await engine.settle(ctx, 13)

  assertEquals(db.game_entries[0].status, 'pending')
  assertEquals(db.game_entries[1].status, 'void')
})

Deno.test('settle never reprocesses an entry that is already void (or otherwise not pending)', async () => {
  const engine = new LmsEngine()
  const db = baseDb({
    game_entries: [{ id: 'entry-1', pot_id: 'pot-1', user_id: 'user-1', status: 'void' }],
    entry_payments: [{ pot_id: 'pot-1', user_id: 'user-1', is_paid: false, scope: 'season' }],
    lms_team_picks: [{ id: 1, game_entry_id: 'entry-1', gameweek_id: 13, team_id: 100, result: 'pending' }],
  })
  const ctx = fakeCalculateScoreContext(db, AFTER_DEADLINE)

  await engine.settle(ctx, 13)

  // Untouched — status='pending' filter excludes it, so its (irrelevant at
  // this point) pick result is left exactly as it was.
  assertEquals(db.lms_team_picks[0].result, 'pending')
})

// --- generateStandings() ------------------------------------------------------
// Purpose-built fake, same reasoning as validateEntry()'s/lockEntries()'s own
// dedicated fakes: generateStandings() reads game_entries with a nested
// game_entry_lms embed, a shape the generic FakeDb fake above doesn't
// simulate (it has no real relational embedding).

interface FakeStandingsEntry { user_id: string; competitive_status: string; eliminated_gameweek_id: number | null; malformed?: boolean }

function fakeGenerateStandingsContext(
  entries: FakeStandingsEntry[],
  existingSnapshots: { id: number; user_id: string }[] = []
) {
  const inserted: Record<string, unknown>[] = []
  const updated: Record<string, unknown>[] = []

  const fakeSupabase = {
    from(table: string) {
      if (table === 'game_entries') {
        return {
          select() {
            return {
              eq: () =>
                Promise.resolve({
                  data: entries.map((e) => ({
                    user_id: e.user_id,
                    game_entry_lms: e.malformed
                      ? null
                      : { competitive_status: e.competitive_status, eliminated_gameweek_id: e.eliminated_gameweek_id },
                  })),
                  error: null,
                }),
            }
          },
        }
      }
      if (table === 'pot_standings_snapshots') {
        return {
          select() {
            return {
              eq: () => ({
                is: () => Promise.resolve({ data: existingSnapshots, error: null }),
              }),
            }
          },
          upsert(rows: Record<string, unknown>[]) {
            updated.push(...rows)
            return Promise.resolve({ data: rows, error: null })
          },
          insert(rows: Record<string, unknown>[]) {
            inserted.push(...rows)
            return Promise.resolve({ data: rows, error: null })
          },
        }
      }
      throw new Error(`Unexpected table in test fake: ${table}`)
    },
  }

  const ctx: GameEngineContext = { supabase: fakeSupabase as unknown as GameEngineContext['supabase'], now: () => new Date() }
  return { ctx, inserted, updated }
}

Deno.test('generateStandings returns [] for a pot with no entries', async () => {
  const engine = new LmsEngine()
  const { ctx } = fakeGenerateStandingsContext([])

  const rows = await engine.generateStandings(ctx, 'pot-1')

  assertEquals(rows, [])
})

Deno.test('generateStandings ties every alive entry at rank 1, score 1', async () => {
  const engine = new LmsEngine()
  const { ctx } = fakeGenerateStandingsContext([
    { user_id: 'user-1', competitive_status: 'alive', eliminated_gameweek_id: null },
    { user_id: 'user-2', competitive_status: 'alive', eliminated_gameweek_id: null },
  ])

  const rows = await engine.generateStandings(ctx, 'pot-1')

  assertEquals(rows.length, 2)
  assertEquals(rows.every((r) => r.rank === 1 && r.score === 1), true)
  assertEquals(rows.every((r) => r.meta?.competitiveStatus === 'alive'), true)
})

Deno.test('generateStandings ranks eliminated entries below alive ones, by elimination recency', async () => {
  const engine = new LmsEngine()
  const { ctx } = fakeGenerateStandingsContext([
    { user_id: 'user-alive', competitive_status: 'alive', eliminated_gameweek_id: null },
    { user_id: 'user-late', competitive_status: 'eliminated', eliminated_gameweek_id: 15 }, // eliminated most recently
    { user_id: 'user-early', competitive_status: 'eliminated', eliminated_gameweek_id: 10 }, // eliminated earliest
  ])

  const rows = await engine.generateStandings(ctx, 'pot-1')

  const byUser = new Map(rows.map((r) => [r.userId, r]))
  assertEquals(byUser.get('user-alive')?.rank, 1)
  assertEquals(byUser.get('user-late')?.rank, 2) // outlasted user-early, ranks better
  assertEquals(byUser.get('user-early')?.rank, 3)
  assertEquals(byUser.get('user-late')?.meta?.eliminatedGameweekId, 15)
  assertEquals(byUser.get('user-early')?.score, 0)
})

Deno.test('generateStandings shares a rank among entries eliminated in the same gameweek, then skips ahead', async () => {
  const engine = new LmsEngine()
  const { ctx } = fakeGenerateStandingsContext([
    { user_id: 'user-a', competitive_status: 'eliminated', eliminated_gameweek_id: 12 },
    { user_id: 'user-b', competitive_status: 'eliminated', eliminated_gameweek_id: 12 },
    { user_id: 'user-c', competitive_status: 'eliminated', eliminated_gameweek_id: 10 },
  ])

  const rows = await engine.generateStandings(ctx, 'pot-1')

  const byUser = new Map(rows.map((r) => [r.userId, r]))
  // No alive entries, so the eliminated tier starts at rank 1.
  assertEquals(byUser.get('user-a')?.rank, 1)
  assertEquals(byUser.get('user-b')?.rank, 1)
  assertEquals(byUser.get('user-c')?.rank, 3) // skips ahead by the 2 tied at rank 1, "1224"-style
})

Deno.test('generateStandings excludes an entry with no game_entry_lms extension row', async () => {
  const engine = new LmsEngine()
  const { ctx } = fakeGenerateStandingsContext([
    { user_id: 'user-1', competitive_status: 'alive', eliminated_gameweek_id: null },
    { user_id: 'user-malformed', competitive_status: 'alive', eliminated_gameweek_id: null, malformed: true },
  ])

  const rows = await engine.generateStandings(ctx, 'pot-1')

  assertEquals(rows.length, 1)
  assertEquals(rows[0].userId, 'user-1')
})

Deno.test('generateStandings upserts an existing snapshot row by id, inserts a new one', async () => {
  const engine = new LmsEngine()
  const { ctx, inserted, updated } = fakeGenerateStandingsContext(
    [
      { user_id: 'user-existing', competitive_status: 'alive', eliminated_gameweek_id: null },
      { user_id: 'user-new', competitive_status: 'alive', eliminated_gameweek_id: null },
    ],
    [{ id: 42, user_id: 'user-existing' }]
  )

  await engine.generateStandings(ctx, 'pot-1')

  assertEquals(updated.length, 1)
  assertEquals(updated[0].id, 42)
  assertEquals(inserted.length, 1)
  assertEquals(inserted[0].user_id, 'user-new')
})

Deno.test('settle calls generateStandings for every eligible pot, writing overall standings rows', async () => {
  const engine = new LmsEngine()
  const db = baseDb({
    entry_payments: [{ pot_id: 'pot-1', user_id: 'user-1', is_paid: true, scope: 'season' }],
  })
  const ctx = fakeCalculateScoreContext(db, AFTER_DEADLINE)

  // The generic FakeDb fake doesn't simulate the game_entry_lms embed
  // generateStandings() needs, so it correctly no-ops (no throw) rather
  // than crashing — this test only proves settle() doesn't itself throw
  // when it reaches the generateStandings() call, not the ranking logic
  // itself (covered in isolation above).
  await engine.settle(ctx, 13)

  assertEquals(db.game_entries[0].status, 'pending')
})

// --- determineWinner() --------------------------------------------------------
// Same purpose-built-fake reasoning as generateStandings()'s tests —
// determineWinner() reads the same game_entries -> game_entry_lms embed,
// plus pots.end_gameweek_id and gameweeks.deadline_utc for the season-end
// check.

interface FakeWinnerEntry { user_id: string; competitive_status: string; eliminated_gameweek_id: number | null; malformed?: boolean }

function fakeDetermineWinnerContext(
  entries: FakeWinnerEntry[],
  options: { endGameweekId?: number | null; endGameweekDeadlineUtc?: string | null; now?: Date } = {}
): GameEngineContext {
  const endGameweekId = options.endGameweekId ?? null
  const fakeSupabase = {
    from(table: string) {
      if (table === 'game_entries') {
        return {
          select() {
            return {
              eq: () =>
                Promise.resolve({
                  data: entries.map((e) => ({
                    user_id: e.user_id,
                    game_entry_lms: e.malformed
                      ? null
                      : { competitive_status: e.competitive_status, eliminated_gameweek_id: e.eliminated_gameweek_id },
                  })),
                  error: null,
                }),
            }
          },
        }
      }
      if (table === 'pots') {
        return {
          select() {
            return { eq: () => ({ maybeSingle: () => Promise.resolve({ data: { end_gameweek_id: endGameweekId }, error: null }) }) }
          },
        }
      }
      if (table === 'gameweeks') {
        return {
          select() {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { deadline_utc: options.endGameweekDeadlineUtc ?? null }, error: null }),
              }),
            }
          },
        }
      }
      throw new Error(`Unexpected table in test fake: ${table}`)
    },
  }
  return { supabase: fakeSupabase as unknown as GameEngineContext['supabase'], now: () => options.now ?? new Date('2026-06-01T00:00:00Z') }
}

Deno.test('determineWinner returns [] for a pot with no entries', async () => {
  const engine = new LmsEngine()
  const ctx = fakeDetermineWinnerContext([])

  assertEquals(await engine.determineWinner(ctx, 'pot-1'), [])
})

Deno.test('determineWinner: exactly one alive entry wins immediately', async () => {
  const engine = new LmsEngine()
  const ctx = fakeDetermineWinnerContext([
    { user_id: 'user-winner', competitive_status: 'alive', eliminated_gameweek_id: null },
    { user_id: 'user-out', competitive_status: 'eliminated', eliminated_gameweek_id: 10 },
  ])

  assertEquals(await engine.determineWinner(ctx, 'pot-1'), ['user-winner'])
})

Deno.test('determineWinner: a wipeout returns everyone eliminated in the same, most recent gameweek', async () => {
  const engine = new LmsEngine()
  const ctx = fakeDetermineWinnerContext([
    { user_id: 'user-a', competitive_status: 'eliminated', eliminated_gameweek_id: 15 },
    { user_id: 'user-b', competitive_status: 'eliminated', eliminated_gameweek_id: 15 },
  ])

  const winners = await engine.determineWinner(ctx, 'pot-1')
  assertEquals(new Set(winners), new Set(['user-a', 'user-b']))
})

Deno.test('determineWinner: zero alive but eliminated in staggered gameweeks returns only the most-recent group', async () => {
  const engine = new LmsEngine()
  const ctx = fakeDetermineWinnerContext([
    { user_id: 'user-earlier', competitive_status: 'eliminated', eliminated_gameweek_id: 10 },
    { user_id: 'user-latest', competitive_status: 'eliminated', eliminated_gameweek_id: 15 },
  ])

  assertEquals(await engine.determineWinner(ctx, 'pot-1'), ['user-latest'])
})

Deno.test('determineWinner: multiple alive, no end_gameweek_id configured -> still in progress', async () => {
  const engine = new LmsEngine()
  const ctx = fakeDetermineWinnerContext(
    [
      { user_id: 'user-a', competitive_status: 'alive', eliminated_gameweek_id: null },
      { user_id: 'user-b', competitive_status: 'alive', eliminated_gameweek_id: null },
    ],
    { endGameweekId: null }
  )

  assertEquals(await engine.determineWinner(ctx, 'pot-1'), [])
})

Deno.test('determineWinner: multiple alive, end_gameweek_id set but its deadline has not passed -> still in progress', async () => {
  const engine = new LmsEngine()
  const ctx = fakeDetermineWinnerContext(
    [
      { user_id: 'user-a', competitive_status: 'alive', eliminated_gameweek_id: null },
      { user_id: 'user-b', competitive_status: 'alive', eliminated_gameweek_id: null },
    ],
    { endGameweekId: 38, endGameweekDeadlineUtc: '2026-12-01T00:00:00Z', now: new Date('2026-06-01T00:00:00Z') }
  )

  assertEquals(await engine.determineWinner(ctx, 'pot-1'), [])
})

Deno.test('determineWinner: multiple alive, season concluded -> season-end tie, returns every alive entry', async () => {
  const engine = new LmsEngine()
  const ctx = fakeDetermineWinnerContext(
    [
      { user_id: 'user-a', competitive_status: 'alive', eliminated_gameweek_id: null },
      { user_id: 'user-b', competitive_status: 'alive', eliminated_gameweek_id: null },
    ],
    { endGameweekId: 38, endGameweekDeadlineUtc: '2026-01-01T00:00:00Z', now: new Date('2026-06-01T00:00:00Z') }
  )

  const winners = await engine.determineWinner(ctx, 'pot-1')
  assertEquals(new Set(winners), new Set(['user-a', 'user-b']))
})

Deno.test('determineWinner excludes an entry with no game_entry_lms extension row', async () => {
  const engine = new LmsEngine()
  const ctx = fakeDetermineWinnerContext([
    { user_id: 'user-winner', competitive_status: 'alive', eliminated_gameweek_id: null },
    { user_id: 'user-malformed', competitive_status: 'alive', eliminated_gameweek_id: null, malformed: true },
  ])

  assertEquals(await engine.determineWinner(ctx, 'pot-1'), ['user-winner'])
})

Deno.test('determineWinner: zero alive and zero resolved-eliminated entries -> []', async () => {
  const engine = new LmsEngine()
  const ctx = fakeDetermineWinnerContext([
    { user_id: 'user-malformed', competitive_status: 'alive', eliminated_gameweek_id: null, malformed: true },
  ])

  assertEquals(await engine.determineWinner(ctx, 'pot-1'), [])
})

// --- awardPrize() / createRolloverPot() ---------------------------------------
// A fuller in-memory relational fake, purpose-built for this method's own
// query shapes (game_entries <-> game_entry_lms embed, pot_prizes,
// game_entries updates, pots insert + select().single(), pot_members
// insert) — same "purpose-built fake per method" pattern as every other
// fake in this file, just wider because awardPrize() itself is wider.

interface FakeAwardEntry { id: string; pot_id: string; user_id: string; status: string; payout_amount: number; competitive_status: string; eliminated_gameweek_id: number | null }
type FakeAwardEntryInput = Omit<FakeAwardEntry, 'pot_id'>
interface FakeAwardPot {
  id: string
  name: string
  created_by: string
  season_id: number
  league_id: number
  entry_fee: number
  end_gameweek_id: number | null
  wipeout_resolution: string
  season_end_tie_rule: string
  admin_fee_type: string
  admin_fee_amount: number | null
  admin_fee_percentage: number | null
  charity_fee_type: string
  charity_fee_amount: number | null
  charity_fee_percentage: number | null
  carry_over_amount: number
  rollover_generation: number
}
interface FakeAwardPrize { id: number; pot_id: string; scope: string; gross_amount: number; admin_fee_amount: number; charity_fee_amount: number; is_settled: boolean; rollover: boolean }
interface FakeAwardMember { pot_id: string; user_id: string; role: string }
interface FakeAwardNotification { user_id: string; pot_id: string | null; type: string; payload: Record<string, unknown> | null }

interface FakeAwardDb {
  pots: FakeAwardPot[]
  entries: FakeAwardEntry[]
  prizes: FakeAwardPrize[]
  members: FakeAwardMember[]
  notifications: FakeAwardNotification[]
  gameweeks: { id: number; deadline_utc: string }[]
  nextPotId: number
  failPotMembersInsert?: boolean
  failPotPrizesWrite?: boolean
  failNotificationsInsert?: boolean
}

function fakeAwardPrizeContext(db: FakeAwardDb, now: Date = new Date('2026-06-01T00:00:00Z')): GameEngineContext {
  const fakeSupabase = {
    from(table: string) {
      if (table === 'pot_prizes') {
        return {
          select() {
            return {
              eq(_c1: string, potId: string) {
                return {
                  eq: (_c2: string, _scope: string) => ({
                    maybeSingle: () => Promise.resolve({ data: db.prizes.find((p) => p.pot_id === potId) ?? null, error: null }),
                  }),
                }
              },
            }
          },
          update(patch: Record<string, unknown>) {
            return { eq: (_c: string, id: number) => {
              if (db.failPotPrizesWrite) return Promise.resolve({ data: null, error: { message: 'simulated failure' } })
              const row = db.prizes.find((p) => p.id === id)
              if (row) Object.assign(row, patch)
              return Promise.resolve({ data: null, error: null })
            } }
          },
          insert(row: Record<string, unknown>) {
            if (db.failPotPrizesWrite) return Promise.resolve({ data: null, error: { message: 'simulated failure' } })
            db.prizes.push({ id: db.prizes.length + 1, ...row } as FakeAwardPrize)
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      if (table === 'pots') {
        return {
          select(_cols: string) {
            const find = (col: string, val: unknown) =>
              db.pots.find((p) => (p as unknown as Record<string, unknown>)[col] === val) ?? null
            return {
              eq: (col: string, val: unknown) => ({
                single: () => Promise.resolve({ data: find(col, val), error: null }),
                maybeSingle: () => Promise.resolve({ data: find(col, val), error: null }),
              }),
            }
          },
          insert(row: Record<string, unknown>) {
            const id = `rollover-pot-${db.nextPotId++}`
            const newPot = { id, ...row } as unknown as FakeAwardPot
            db.pots.push(newPot)
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id }, error: null }),
              }),
            }
          },
          delete() {
            return { eq: (_c: string, id: string) => {
              db.pots = db.pots.filter((p) => p.id !== id)
              return Promise.resolve({ data: null, error: null })
            } }
          },
        }
      }
      if (table === 'gameweeks') {
        return {
          select(_cols: string) {
            return {
              eq: (_c: string, id: number) => ({
                maybeSingle: () => Promise.resolve({ data: db.gameweeks.find((g) => g.id === id) ?? null, error: null }),
              }),
            }
          },
        }
      }
      if (table === 'notifications') {
        return {
          insert(row: Record<string, unknown>) {
            if (db.failNotificationsInsert) return Promise.resolve({ data: null, error: { message: 'simulated failure' } })
            db.notifications.push(row as unknown as FakeAwardNotification)
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      if (table === 'pot_members') {
        return {
          insert(row: Record<string, unknown>) {
            if (db.failPotMembersInsert) {
              return Promise.resolve({ data: null, error: { message: 'simulated failure' } })
            }
            db.members.push(row as unknown as FakeAwardMember)
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      if (table === 'game_entries') {
        return {
          select(cols: string) {
            const embedAware = cols.includes('game_entry_lms')
            let filtered = db.entries.slice()
            const builder = {
              eq(col: string, val: unknown) {
                filtered = filtered.filter((r) => (r as unknown as Record<string, unknown>)[col] === val)
                return builder
              },
              neq(col: string, val: unknown) {
                filtered = filtered.filter((r) => (r as unknown as Record<string, unknown>)[col] !== val)
                return builder
              },
              then(resolve: (v: { data: unknown; error: null }) => void) {
                if (embedAware) {
                  resolve({
                    data: filtered.map((e) => ({
                      user_id: e.user_id,
                      game_entry_lms: { competitive_status: e.competitive_status, eliminated_gameweek_id: e.eliminated_gameweek_id },
                    })),
                    error: null,
                  })
                } else {
                  resolve({ data: filtered.map((e) => ({ id: e.id })), error: null })
                }
              },
            }
            return builder
          },
          update(patch: Record<string, unknown>) {
            let filtered = db.entries.slice()
            const builder = {
              eq(col: string, val: unknown) {
                filtered = filtered.filter((r) => (r as unknown as Record<string, unknown>)[col] === val)
                return builder
              },
              neq(col: string, val: unknown) {
                filtered = filtered.filter((r) => (r as unknown as Record<string, unknown>)[col] !== val)
                if (true) { /* re-evaluate on next chain call */ }
                return builder
              },
              then(resolve: (v: { data: null; error: null }) => void) {
                for (const row of filtered) Object.assign(row, patch)
                resolve({ data: null, error: null })
              },
            }
            return builder
          },
        }
      }
      throw new Error(`Unexpected table in test fake: ${table}`)
    },
  }
  return { supabase: fakeSupabase as unknown as GameEngineContext['supabase'], now: () => now }
}

function baseAwardPot(overrides: Partial<FakeAwardPot> = {}): FakeAwardPot {
  return {
    id: 'pot-1', name: 'Test LMS Pot', created_by: 'organiser-1', season_id: 3, league_id: 6,
    entry_fee: 10, end_gameweek_id: null,
    wipeout_resolution: 'split_prize', season_end_tie_rule: 'split_prize',
    admin_fee_type: 'none', admin_fee_amount: null, admin_fee_percentage: null,
    charity_fee_type: 'none', charity_fee_amount: null, charity_fee_percentage: null,
    carry_over_amount: 0, rollover_generation: 0,
    ...overrides,
  }
}

function baseAwardDb(pots: FakeAwardPot[], entries: FakeAwardEntryInput[]): FakeAwardDb {
  const potId = pots[0].id
  return {
    pots,
    entries: entries.map((e) => ({ ...e, pot_id: potId })),
    prizes: [],
    members: [],
    notifications: [],
    gameweeks: [],
    nextPotId: 1,
  }
}

Deno.test('awardPrize is a no-op once already settled', async () => {
  const db = baseAwardDb([baseAwardPot()], [
    { id: 'entry-1', user_id: 'user-1', status: 'settled', payout_amount: 5, competitive_status: 'alive', eliminated_gameweek_id: null },
  ])
  db.prizes.push({ id: 1, pot_id: 'pot-1', scope: 'season', gross_amount: 10, admin_fee_amount: 0, charity_fee_amount: 0, is_settled: true, rollover: false })
  const ctx = fakeAwardPrizeContext(db)
  const engine = new LmsEngine()

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.entries[0].payout_amount, 5) // untouched
})

Deno.test('awardPrize is a silent no-op while the competition is still in progress', async () => {
  const db = baseAwardDb([baseAwardPot()], [
    { id: 'entry-1', user_id: 'user-1', status: 'pending', payout_amount: 0, competitive_status: 'alive', eliminated_gameweek_id: null },
    { id: 'entry-2', user_id: 'user-2', status: 'pending', payout_amount: 0, competitive_status: 'alive', eliminated_gameweek_id: null },
  ])
  const ctx = fakeAwardPrizeContext(db)
  const engine = new LmsEngine()

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.prizes.length, 0)
  assertEquals(db.entries[0].status, 'pending')
})

Deno.test('awardPrize: single survivor gets the entire net prize; every non-void entry is settled', async () => {
  const db = baseAwardDb([baseAwardPot({ entry_fee: 10 })], [
    { id: 'entry-1', user_id: 'user-winner', status: 'pending', payout_amount: 0, competitive_status: 'alive', eliminated_gameweek_id: null },
    { id: 'entry-2', user_id: 'user-loser', status: 'pending', payout_amount: 0, competitive_status: 'eliminated', eliminated_gameweek_id: 10 },
  ])
  const ctx = fakeAwardPrizeContext(db)
  const engine = new LmsEngine()

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.prizes.length, 1)
  assertEquals(db.prizes[0].gross_amount, 20) // 2 non-void entries x 10
  assertEquals(db.prizes[0].is_settled, true)
  assertEquals(db.prizes[0].rollover, false)
  assertEquals(db.entries[0].payout_amount, 20)
  assertEquals(db.entries[1].payout_amount, 0) // loser gets nothing
  assertEquals(db.entries[0].status, 'settled')
  assertEquals(db.entries[1].status, 'settled') // settled too, just no payout
})

Deno.test('awardPrize: single survivor excludes voided entries from the gross calculation', async () => {
  const db = baseAwardDb([baseAwardPot({ entry_fee: 10 })], [
    { id: 'entry-1', user_id: 'user-winner', status: 'pending', payout_amount: 0, competitive_status: 'alive', eliminated_gameweek_id: null },
    { id: 'entry-2', user_id: 'user-voided', status: 'void', payout_amount: 0, competitive_status: 'eliminated', eliminated_gameweek_id: 5 },
  ])
  const ctx = fakeAwardPrizeContext(db)
  const engine = new LmsEngine()

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.prizes[0].gross_amount, 10) // only the 1 non-void entry
  assertEquals(db.entries[1].status, 'void') // untouched — still void, not settled
})

Deno.test('awardPrize: wipeout + split_prize splits the net prize equally among the group', async () => {
  const db = baseAwardDb([baseAwardPot({ entry_fee: 10, wipeout_resolution: 'split_prize' })], [
    { id: 'entry-1', user_id: 'user-a', status: 'pending', payout_amount: 0, competitive_status: 'eliminated', eliminated_gameweek_id: 15 },
    { id: 'entry-2', user_id: 'user-b', status: 'pending', payout_amount: 0, competitive_status: 'eliminated', eliminated_gameweek_id: 15 },
  ])
  const ctx = fakeAwardPrizeContext(db)
  const engine = new LmsEngine()

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.prizes[0].gross_amount, 20)
  assertEquals(db.entries[0].payout_amount, 10)
  assertEquals(db.entries[1].payout_amount, 10)
  assertEquals(db.prizes[0].rollover, false)
})

Deno.test('awardPrize: wipeout + roll_prize pays nobody and creates a draft rollover pot', async () => {
  const sourcePot = baseAwardPot({ id: 'pot-1', name: 'Premier League LMS', entry_fee: 10, wipeout_resolution: 'roll_prize', rollover_generation: 0 })
  const db = baseAwardDb([sourcePot], [
    { id: 'entry-1', user_id: 'user-a', status: 'pending', payout_amount: 0, competitive_status: 'eliminated', eliminated_gameweek_id: 15 },
    { id: 'entry-2', user_id: 'user-b', status: 'pending', payout_amount: 0, competitive_status: 'eliminated', eliminated_gameweek_id: 15 },
  ])
  const ctx = fakeAwardPrizeContext(db)
  const engine = new LmsEngine()

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.prizes[0].rollover, true)
  assertEquals(db.entries[0].payout_amount, 0)
  assertEquals(db.entries[1].payout_amount, 0)
  assertEquals(db.entries[0].status, 'settled') // still settled, even with no payout

  assertEquals(db.pots.length, 2)
  const newPot = db.pots[1]
  assertEquals(newPot.name, 'Premier League LMS (Rollover #1)')
  assertEquals((newPot as unknown as { rollover_source_pot_id: string }).rollover_source_pot_id, 'pot-1')
  assertEquals((newPot as unknown as { carry_over_amount: number }).carry_over_amount, 20) // the full net prize
  assertEquals(newPot.rollover_generation, 1)
  assertEquals((newPot as unknown as { status: string }).status, 'draft')
  assertEquals((newPot as unknown as { start_gameweek_id: unknown }).start_gameweek_id, undefined) // never set

  assertEquals(db.members.length, 1)
  assertEquals(db.members[0].pot_id, newPot.id)
  assertEquals(db.members[0].user_id, 'organiser-1')
  assertEquals(db.members[0].role, 'admin')
})

Deno.test('awardPrize: rollover default naming strips an existing "(Rollover #N)" suffix before appending the new one', async () => {
  const sourcePot = baseAwardPot({ id: 'pot-1', name: 'Premier League LMS (Rollover #1)', wipeout_resolution: 'roll_prize', rollover_generation: 1 })
  const db = baseAwardDb([sourcePot], [
    { id: 'entry-1', user_id: 'user-a', status: 'pending', payout_amount: 0, competitive_status: 'eliminated', eliminated_gameweek_id: 20 },
  ])
  const ctx = fakeAwardPrizeContext(db)
  const engine = new LmsEngine()

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.pots[1].name, 'Premier League LMS (Rollover #2)')
  assertEquals(db.pots[1].rollover_generation, 2)
})

Deno.test('awardPrize: rollover carry_over_amount includes the source pot\'s own prior carry-over', async () => {
  const sourcePot = baseAwardPot({ id: 'pot-1', entry_fee: 10, carry_over_amount: 50, wipeout_resolution: 'roll_prize' })
  const db = baseAwardDb([sourcePot], [
    { id: 'entry-1', user_id: 'user-a', status: 'pending', payout_amount: 0, competitive_status: 'eliminated', eliminated_gameweek_id: 15 },
  ])
  const ctx = fakeAwardPrizeContext(db)
  const engine = new LmsEngine()

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.prizes[0].gross_amount, 60) // 1 entry x 10 + 50 already-carried-over
  assertEquals((db.pots[1] as unknown as { carry_over_amount: number }).carry_over_amount, 60)
})

Deno.test('awardPrize: rollover pot creation rolls back if adding the organiser as a member fails', async () => {
  const sourcePot = baseAwardPot({ wipeout_resolution: 'roll_prize' })
  const db = baseAwardDb([sourcePot], [
    { id: 'entry-1', user_id: 'user-a', status: 'pending', payout_amount: 0, competitive_status: 'eliminated', eliminated_gameweek_id: 15 },
  ])
  db.failPotMembersInsert = true
  const ctx = fakeAwardPrizeContext(db)
  const engine = new LmsEngine()

  await assertRejects(() => engine.awardPrize(ctx, 'pot-1'))

  assertEquals(db.pots.length, 1) // the new pot was rolled back, not left orphaned
})

Deno.test('awardPrize: season-end tie + split_prize splits equally among every alive entry', async () => {
  const db = baseAwardDb([baseAwardPot({ entry_fee: 10, season_end_tie_rule: 'split_prize', end_gameweek_id: 38 })], [
    { id: 'entry-1', user_id: 'user-a', status: 'pending', payout_amount: 0, competitive_status: 'alive', eliminated_gameweek_id: null },
    { id: 'entry-2', user_id: 'user-b', status: 'pending', payout_amount: 0, competitive_status: 'alive', eliminated_gameweek_id: null },
  ])
  db.gameweeks.push({ id: 38, deadline_utc: '2026-01-01T00:00:00Z' })
  const ctx = fakeAwardPrizeContext(db, new Date('2026-06-01T00:00:00Z')) // well after gw38's deadline
  const engine = new LmsEngine()

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.prizes.length, 1)
  assertEquals(db.prizes[0].gross_amount, 20)
  assertEquals(db.prizes[0].rollover, false)
  assertEquals(db.entries[0].payout_amount, 10)
  assertEquals(db.entries[1].payout_amount, 10)
  assertEquals(db.entries[0].status, 'settled')
  assertEquals(db.entries[1].status, 'settled')
})

Deno.test('awardPrize: season-end tie is NOT a season-end outcome until the final gameweek deadline has actually passed', async () => {
  const db = baseAwardDb([baseAwardPot({ season_end_tie_rule: 'split_prize', end_gameweek_id: 38 })], [
    { id: 'entry-1', user_id: 'user-a', status: 'pending', payout_amount: 0, competitive_status: 'alive', eliminated_gameweek_id: null },
    { id: 'entry-2', user_id: 'user-b', status: 'pending', payout_amount: 0, competitive_status: 'alive', eliminated_gameweek_id: null },
  ])
  db.gameweeks.push({ id: 38, deadline_utc: '2026-12-31T00:00:00Z' }) // still in the future
  const ctx = fakeAwardPrizeContext(db, new Date('2026-06-01T00:00:00Z'))
  const engine = new LmsEngine()

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.prizes.length, 0) // still in_progress — competition hasn't concluded
})

Deno.test('awardPrize: season-end tie + final_prediction throws rather than guessing a resolution', async () => {
  const db = baseAwardDb([baseAwardPot({ season_end_tie_rule: 'final_prediction', end_gameweek_id: 38 })], [
    { id: 'entry-1', user_id: 'user-a', status: 'pending', payout_amount: 0, competitive_status: 'alive', eliminated_gameweek_id: null },
    { id: 'entry-2', user_id: 'user-b', status: 'pending', payout_amount: 0, competitive_status: 'alive', eliminated_gameweek_id: null },
  ])
  db.gameweeks.push({ id: 38, deadline_utc: '2026-01-01T00:00:00Z' })
  const ctx = fakeAwardPrizeContext(db, new Date('2026-06-01T00:00:00Z'))
  const engine = new LmsEngine()

  await assertRejects(() => engine.awardPrize(ctx, 'pot-1'), LmsFinalPredictionNotImplementedError)

  assertEquals(db.prizes.length, 0) // never wrote a prize row before throwing
  assertEquals(db.entries[0].status, 'pending') // never settled entries either
})

Deno.test('awardPrize: throws LmsPrizePoolExceededError rather than clamping fees that exceed the gross pool', async () => {
  const db = baseAwardDb([baseAwardPot({ entry_fee: 10, admin_fee_type: 'fixed', admin_fee_amount: 100 })], [
    { id: 'entry-1', user_id: 'user-winner', status: 'pending', payout_amount: 0, competitive_status: 'alive', eliminated_gameweek_id: null },
    { id: 'entry-2', user_id: 'user-loser', status: 'pending', payout_amount: 0, competitive_status: 'eliminated', eliminated_gameweek_id: 10 },
  ])
  const ctx = fakeAwardPrizeContext(db)
  const engine = new LmsEngine()

  await assertRejects(() => engine.awardPrize(ctx, 'pot-1'), LmsPrizePoolExceededError)

  assertEquals(db.prizes.length, 0)
  assertEquals(db.entries[0].status, 'pending') // never settled — the throw happens before any write
})

// --- Transactionality: pot_prizes is written LAST, so a failure anywhere
// above it never leaves is_settled=true with the rest of the work undone
// (found and fixed 2026-08-06, before Slice 9 — see engine.ts's own
// comment on awardPrize() and createRolloverPot()).

Deno.test('awardPrize: if the trailing pot_prizes write fails, entries are still settled/paid and the pot remains retryable', async () => {
  const db = baseAwardDb([baseAwardPot({ entry_fee: 10 })], [
    { id: 'entry-1', user_id: 'user-winner', status: 'pending', payout_amount: 0, competitive_status: 'alive', eliminated_gameweek_id: null },
    { id: 'entry-2', user_id: 'user-loser', status: 'pending', payout_amount: 0, competitive_status: 'eliminated', eliminated_gameweek_id: 10 },
  ])
  db.failPotPrizesWrite = true
  const ctx = fakeAwardPrizeContext(db)
  const engine = new LmsEngine()

  await assertRejects(() => engine.awardPrize(ctx, 'pot-1'))

  // Everything before the trailing write already landed...
  assertEquals(db.entries[0].status, 'settled')
  assertEquals(db.entries[0].payout_amount, 20)
  // ...but pot_prizes itself was never written, so is_settled never became
  // true — the pot is NOT permanently stuck; a later retry can still
  // complete it.
  assertEquals(db.prizes.length, 0)

  // Retry: same call, this time the write succeeds.
  db.failPotPrizesWrite = false
  await engine.awardPrize(ctx, 'pot-1')
  assertEquals(db.prizes.length, 1)
  assertEquals(db.prizes[0].is_settled, true)
  assertEquals(db.entries[0].payout_amount, 20) // unchanged by the retry — still correct
})

Deno.test('awardPrize: retrying after a rollover pot was already created by a failed prior attempt does not create a duplicate', async () => {
  const sourcePot = baseAwardPot({ id: 'pot-1', wipeout_resolution: 'roll_prize', rollover_generation: 0 })
  const db = baseAwardDb([sourcePot], [
    { id: 'entry-1', user_id: 'user-a', status: 'pending', payout_amount: 0, competitive_status: 'eliminated', eliminated_gameweek_id: 15 },
  ])
  // Simulates a prior awardPrize() call that got as far as successfully
  // creating the rollover pot (and its organiser membership) but then
  // failed on the trailing pot_prizes write, before this reorder — so
  // is_settled is still false and a real caller (settle(), on the next
  // gameweek) would call awardPrize() again for the same pot.
  db.pots.push({
    ...baseAwardPot({ id: 'rollover-pot-1', name: 'Test LMS Pot (Rollover #1)', rollover_generation: 1 }),
    rollover_source_pot_id: 'pot-1',
    carry_over_amount: 10,
  } as unknown as FakeAwardPot)
  db.members.push({ pot_id: 'rollover-pot-1', user_id: 'organiser-1', role: 'admin' })

  const ctx = fakeAwardPrizeContext(db)
  const engine = new LmsEngine()

  await engine.awardPrize(ctx, 'pot-1')

  const rolloverPots = db.pots.filter((p) => (p as unknown as { rollover_source_pot_id?: string }).rollover_source_pot_id === 'pot-1')
  assertEquals(rolloverPots.length, 1) // still exactly one — no duplicate created
  assertEquals(db.members.filter((m) => m.pot_id === 'rollover-pot-1').length, 1) // still exactly one membership row
  assertEquals(db.prizes.length, 1) // this retry finished the job — pot_prizes now written
  assertEquals(db.prizes[0].rollover, true)
})

// --- notifyUsers() -------------------------------------------------------

Deno.test('notifyUsers writes a notification row with the given type and payload', async () => {
  const engine = new LmsEngine()
  const db = baseAwardDb([baseAwardPot()], [])
  const ctx = fakeAwardPrizeContext(db)

  await engine.notifyUsers(ctx, { userId: 'user-a', potId: 'pot-1', type: 'lms.prize_awarded', payload: { amount: 20, outcome: 'single_survivor' } })

  assertEquals(db.notifications.length, 1)
  assertEquals(db.notifications[0].user_id, 'user-a')
  assertEquals(db.notifications[0].pot_id, 'pot-1')
  assertEquals(db.notifications[0].type, 'lms.prize_awarded')
  assertEquals(db.notifications[0].payload, { amount: 20, outcome: 'single_survivor' })
})

Deno.test('notifyUsers throws when the write fails', async () => {
  const engine = new LmsEngine()
  const db = baseAwardDb([baseAwardPot()], [])
  db.failNotificationsInsert = true
  const ctx = fakeAwardPrizeContext(db)

  await assertRejects(() => engine.notifyUsers(ctx, { userId: 'user-a', potId: 'pot-1', type: 'lms.prize_awarded' }))
})

// --- awardPrize() -> notifyUsers() wiring (Slice 9) -----------------------

Deno.test('awardPrize writes an lms.prize_awarded notification for the sole winner', async () => {
  const db = baseAwardDb([baseAwardPot({ entry_fee: 10 })], [
    { id: 'entry-1', user_id: 'user-winner', status: 'pending', payout_amount: 0, competitive_status: 'alive', eliminated_gameweek_id: null },
    { id: 'entry-2', user_id: 'user-loser', status: 'pending', payout_amount: 0, competitive_status: 'eliminated', eliminated_gameweek_id: 10 },
  ])
  const ctx = fakeAwardPrizeContext(db)
  const engine = new LmsEngine()

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.notifications.length, 1)
  assertEquals(db.notifications[0].user_id, 'user-winner')
  assertEquals(db.notifications[0].pot_id, 'pot-1')
  assertEquals(db.notifications[0].type, 'lms.prize_awarded')
  assertEquals(db.notifications[0].payload, { amount: 20, outcome: 'single_survivor' })
})

Deno.test('awardPrize writes one notification per member on a wipeout split_prize', async () => {
  const db = baseAwardDb([baseAwardPot({ entry_fee: 10, wipeout_resolution: 'split_prize' })], [
    { id: 'entry-1', user_id: 'user-a', status: 'pending', payout_amount: 0, competitive_status: 'eliminated', eliminated_gameweek_id: 15 },
    { id: 'entry-2', user_id: 'user-b', status: 'pending', payout_amount: 0, competitive_status: 'eliminated', eliminated_gameweek_id: 15 },
  ])
  const ctx = fakeAwardPrizeContext(db)
  const engine = new LmsEngine()

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.notifications.length, 2)
  const notifiedUsers = db.notifications.map((n) => n.user_id).sort()
  assertEquals(notifiedUsers, ['user-a', 'user-b'])
  assertEquals(db.notifications[0].payload, { amount: 10, outcome: 'wipeout' })
})

Deno.test('awardPrize writes no notification for a roll_prize wipeout — nobody is actually paid', async () => {
  const db = baseAwardDb([baseAwardPot({ wipeout_resolution: 'roll_prize' })], [
    { id: 'entry-1', user_id: 'user-a', status: 'pending', payout_amount: 0, competitive_status: 'eliminated', eliminated_gameweek_id: 15 },
    { id: 'entry-2', user_id: 'user-b', status: 'pending', payout_amount: 0, competitive_status: 'eliminated', eliminated_gameweek_id: 15 },
  ])
  const ctx = fakeAwardPrizeContext(db)
  const engine = new LmsEngine()

  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.notifications.length, 0)
})

Deno.test('awardPrize does not write a duplicate notification on an idempotent second call', async () => {
  const db = baseAwardDb([baseAwardPot({ entry_fee: 10 })], [
    { id: 'entry-1', user_id: 'user-winner', status: 'pending', payout_amount: 0, competitive_status: 'alive', eliminated_gameweek_id: null },
    { id: 'entry-2', user_id: 'user-loser', status: 'pending', payout_amount: 0, competitive_status: 'eliminated', eliminated_gameweek_id: 10 },
  ])
  const ctx = fakeAwardPrizeContext(db)
  const engine = new LmsEngine()

  await engine.awardPrize(ctx, 'pot-1')
  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.notifications.length, 1, 'the idempotent no-op path returns before ever calling notifyUsers()')
})

Deno.test('awardPrize still awards the prize and payout when the notification write fails', async () => {
  const db = baseAwardDb([baseAwardPot({ entry_fee: 10 })], [
    { id: 'entry-1', user_id: 'user-winner', status: 'pending', payout_amount: 0, competitive_status: 'alive', eliminated_gameweek_id: null },
    { id: 'entry-2', user_id: 'user-loser', status: 'pending', payout_amount: 0, competitive_status: 'eliminated', eliminated_gameweek_id: 10 },
  ])
  db.failNotificationsInsert = true
  const ctx = fakeAwardPrizeContext(db)
  const engine = new LmsEngine()

  // Must not throw — a notification failure is never allowed to surface as
  // an awardPrize() failure, let alone undo money already written.
  await engine.awardPrize(ctx, 'pot-1')

  assertEquals(db.prizes.length, 1)
  assertEquals(db.prizes[0].is_settled, true)
  assertEquals(db.entries[0].payout_amount, 20)
  assertEquals(db.notifications.length, 0, 'the failed write never lands in the table, but that does not block the payout above')
})
