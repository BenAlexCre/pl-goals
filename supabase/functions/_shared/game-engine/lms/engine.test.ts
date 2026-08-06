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

interface FakeDb {
  gameweeks: FakeGameweek[]
  pots: FakePot[]
  game_entries: (FakeGameEntry & { user_id?: string; status?: string })[]
  game_entry_lms: FakeGameEntryLms[]
  lms_team_picks: FakePick[]
  fixtures: FakeFixture[]
  entry_payments: FakeEntryPayment[]
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
