// Milestone 5 (docs/game-engine.md § GE-5.2, GE-12): validateEntry (Slice 2),
// lockEntries (Slice 3), and calculateScore (Slice 4) are implemented —
// settle/generateStandings/determineWinner/awardPrize/notifyUsers all still
// throw GameEngineNotImplementedError, same "half-built mode fails loudly"
// pattern Pick5Engine used between its own Slice 2 and Slice 9.
//
// lockEntries() deliberately does NOT touch game_entries.status, unlike
// Pick5Engine's version. game_entries is season-scoped for LMS (GE-4.5) —
// one row for the whole competition — so locking the parent entry at a
// single gameweek's deadline would make it impossible to ever submit a
// pick for the *next* gameweek. What actually needs to become immutable at
// a deadline is this specific gameweek's pick (lms_team_picks.locked_at),
// not the season-long entry. See docs/decisions.md § LMS locking.
//
// calculateScore() also diverges from Pick5Engine's split of responsibility:
// Pick 5 keeps calculateScore() purely about resolving pick outcomes and
// defers every consequential status change (voiding, settling) to settle().
// LMS's calculateScore() eliminates entries directly, per the repo owner's
// explicit 2026-08-05 decision ("the player is immediately eliminated...
// no grace period"). This is safe precisely because elimination only ever
// depends on ONE fixture (the picked team's own) being finished, not on
// the whole gameweek being finished the way Pick 5's settle() waits for
// (GE-8.4) — so there's no need to defer it to a later slice. See
// docs/decisions.md § LMS scoring and elimination.

import type { GameEngine, GameEngineContext } from '../contracts.ts'
import { GameEngineNotImplementedError } from '../errors.ts'
import type { GameEntry, NotificationEvent, StandingsRow } from '../types.ts'
import { LmsValidationError } from './errors.ts'

export interface LmsPickInput {
  gameweekId: number
  teamId: number
}

function parsePick(picks: unknown): LmsPickInput {
  if (typeof picks !== 'object' || picks === null) {
    throw new LmsValidationError('pick must be an object with gameweekId and teamId')
  }
  const { gameweekId, teamId } = picks as Record<string, unknown>
  if (typeof gameweekId !== 'number' || !Number.isInteger(gameweekId)) {
    throw new LmsValidationError('gameweekId must be an integer')
  }
  if (typeof teamId !== 'number' || !Number.isInteger(teamId)) {
    throw new LmsValidationError('teamId must be an integer')
  }
  return { gameweekId, teamId }
}

export class LmsEngine implements GameEngine {
  async validateEntry(ctx: GameEngineContext, entry: GameEntry, picks: unknown): Promise<void> {
    if (entry.status !== 'pending') {
      throw new LmsValidationError(`Entry is ${entry.status}, not pending — picks can no longer be changed`)
    }

    const { gameweekId, teamId } = parsePick(picks)

    const { data: lmsEntry, error: lmsEntryError } = await ctx.supabase
      .from('game_entry_lms')
      .select('competitive_status')
      .eq('game_entry_id', entry.id)
      .maybeSingle()

    if (lmsEntryError) {
      throw new Error(`Failed to look up LMS entry state: ${lmsEntryError.message}`)
    }
    if (!lmsEntry) {
      throw new LmsValidationError('No LMS entry extension found for this entry')
    }
    if (lmsEntry.competitive_status !== 'alive') {
      throw new LmsValidationError('This entry has been eliminated — no further picks can be made')
    }

    // A live comparison, not a stored entry-status check — Pick 5 can gate
    // on entry.status because lockEntries() flips that exact field, but
    // that mechanism is unavailable here (see the module comment above).
    // gameweeks.deadline_utc is the same shared, already-computed deadline
    // Pick 5 relies on (compute-deadlines, GE-8.2) — this just checks it
    // directly instead of via an intermediate status flag.
    const { data: gameweek, error: gameweekError } = await ctx.supabase
      .from('gameweeks')
      .select('deadline_utc')
      .eq('id', gameweekId)
      .maybeSingle()

    if (gameweekError) {
      throw new Error(`Failed to look up gameweek deadline: ${gameweekError.message}`)
    }
    if (!gameweek) {
      throw new LmsValidationError(`Gameweek ${gameweekId} does not exist`)
    }
    if (gameweek.deadline_utc && ctx.now() >= new Date(gameweek.deadline_utc)) {
      throw new LmsValidationError(`Gameweek ${gameweekId}'s deadline has passed — this pick can no longer be made or changed`)
    }

    const { data: fixture, error: fixtureError } = await ctx.supabase
      .from('fixtures')
      .select('id')
      .eq('gameweek_id', gameweekId)
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .maybeSingle()

    if (fixtureError) {
      throw new Error(`Failed to check team fixture: ${fixtureError.message}`)
    }
    if (!fixture) {
      throw new LmsValidationError(`Team ${teamId} does not have a fixture in gameweek ${gameweekId}`)
    }

    // GE-5.2, decided 2026-08-05: no cycles — a team may never be picked
    // twice across the whole competition. Excludes this entry's own
    // existing pick for the SAME gameweek, since resubmitting/changing that
    // gameweek's pick is an update, not a reuse (submit-lms-pick upserts on
    // (game_entry_id, gameweek_id)).
    const { data: priorPick, error: priorPickError } = await ctx.supabase
      .from('lms_team_picks')
      .select('id')
      .eq('game_entry_id', entry.id)
      .eq('team_id', teamId)
      .neq('gameweek_id', gameweekId)
      .maybeSingle()

    if (priorPickError) {
      throw new Error(`Failed to check prior picks: ${priorPickError.message}`)
    }
    if (priorPick) {
      throw new LmsValidationError(`Team ${teamId} has already been picked in this competition — it cannot be picked again`)
    }
  }

  // GE-6: "Transition eligible [picks] from pending to locked" — for LMS
  // that's lms_team_picks.locked_at, not game_entries.status (module
  // comment above). No pot-id/game-type filter needed the way Pick5Engine's
  // version needs one: lms_team_picks is written only by submit-lms-pick,
  // itself gated to last_man_standing pots, so every row in this table is
  // already unambiguously LMS's. An entry with no pick at all for this
  // gameweek has no row to lock — what should happen to a non-picker is an
  // open product question, not answered here (see docs/decisions.md § LMS
  // locking's "what's still not decided" note).
  async lockEntries(ctx: GameEngineContext, gameweekId: number): Promise<number> {
    const { data: locked, error } = await ctx.supabase
      .from('lms_team_picks')
      .update({ locked_at: ctx.now().toISOString() })
      .eq('gameweek_id', gameweekId)
      .is('locked_at', null)
      .select('id')

    if (error) {
      throw new Error(`Failed to lock LMS picks: ${error.message}`)
    }

    return locked?.length ?? 0
  }

  // Private, LMS-only — same "internal reuse, not cross-mode duplication"
  // reasoning Pick5Engine's own private helpers use (GE-3/GE-18). LMS pots
  // whose competition hasn't reached gameweekId yet (a draft rollover pot
  // with a future start_gameweek_id, for instance) must never have their
  // entries touched by a gameweek they haven't started.
  private async getEligibleLmsPotIds(ctx: GameEngineContext, gameweekId: number): Promise<string[]> {
    const { data: pots, error } = await ctx.supabase
      .from('pots')
      .select('id')
      .eq('game_type', 'last_man_standing')
      .lte('start_gameweek_id', gameweekId)

    if (error) {
      throw new Error(`Failed to look up LMS pots: ${error.message}`)
    }

    return (pots ?? []).map((p: { id: string }) => p.id)
  }

  // GE-6: "Resolve picks against real fixture data." Two things happen for
  // gameweekId, both gated on its deadline having passed (no consequential
  // action before then — mirrors validateEntry()'s live deadline check):
  //
  //   1. Every existing pick is resolved against its team's own fixture.
  //      While that fixture is still live, the result is an interim label
  //      only ('winning'/'losing', same non-consequential pattern Pick 5
  //      uses) — no elimination yet, since a live scoreline can still
  //      change. Once the fixture is finished, the result is final
  //      ('won', or 'lost' for both an actual loss and a draw — pick_result
  //      has no separate "drew" value, and a draw eliminates identically to
  //      a loss per the repo owner's rule, so reusing 'lost' is accurate
  //      for the one thing that value is ever checked for) and, if not
  //      'won', the entry is eliminated.
  //   2. Every ALIVE entry in an eligible LMS pot with NO pick row at all
  //      for gameweekId is eliminated too — "missing a pick is treated
  //      exactly the same as selecting a team that does not win... no
  //      grace period... no automatic pick" (repo owner, 2026-08-05). No
  //      placeholder pick is ever created for these entries.
  async calculateScore(ctx: GameEngineContext, gameweekId: number): Promise<void> {
    const { data: gameweek, error: gameweekError } = await ctx.supabase
      .from('gameweeks')
      .select('deadline_utc')
      .eq('id', gameweekId)
      .maybeSingle()

    if (gameweekError) {
      throw new Error(`Failed to look up gameweek deadline: ${gameweekError.message}`)
    }
    if (!gameweek?.deadline_utc || ctx.now() < new Date(gameweek.deadline_utc)) {
      return
    }

    const potIds = await this.getEligibleLmsPotIds(ctx, gameweekId)
    if (potIds.length === 0) {
      return
    }

    const { data: potEntries, error: potEntriesError } = await ctx.supabase
      .from('game_entries')
      .select('id')
      .in('pot_id', potIds)

    if (potEntriesError) {
      throw new Error(`Failed to look up entries: ${potEntriesError.message}`)
    }

    const entryIds = (potEntries ?? []).map((e: { id: string }) => e.id)
    if (entryIds.length === 0) {
      return
    }

    const { data: aliveRows, error: aliveError } = await ctx.supabase
      .from('game_entry_lms')
      .select('game_entry_id')
      .in('game_entry_id', entryIds)
      .eq('competitive_status', 'alive')

    if (aliveError) {
      throw new Error(`Failed to look up alive entries: ${aliveError.message}`)
    }

    const aliveEntryIds = (aliveRows ?? []).map((r: { game_entry_id: string }) => r.game_entry_id)
    if (aliveEntryIds.length === 0) {
      return
    }

    const { data: picks, error: picksError } = await ctx.supabase
      .from('lms_team_picks')
      .select('id, game_entry_id, team_id, result')
      .eq('gameweek_id', gameweekId)
      .in('game_entry_id', aliveEntryIds)

    if (picksError) {
      throw new Error(`Failed to look up picks: ${picksError.message}`)
    }

    const { data: fixtures, error: fixturesError } = await ctx.supabase
      .from('fixtures')
      .select('home_team_id, away_team_id, status, home_goals, away_goals')
      .eq('gameweek_id', gameweekId)

    if (fixturesError) {
      throw new Error(`Failed to look up fixtures: ${fixturesError.message}`)
    }

    type FixtureRow = {
      home_team_id: number
      away_team_id: number
      status: string
      home_goals: number
      away_goals: number
    }
    const fixtureByTeam = new Map<number, FixtureRow>()
    for (const fixture of (fixtures ?? []) as FixtureRow[]) {
      fixtureByTeam.set(fixture.home_team_id, fixture)
      fixtureByTeam.set(fixture.away_team_id, fixture)
    }

    type PickRow = { id: number; game_entry_id: string; team_id: number; result: string }
    // onConflict: 'id' requires every NOT NULL, no-default column in each
    // row, not just the one actually changing (Postgres validates the
    // candidate row before it knows the ON CONFLICT branch will fire) —
    // same gotcha Pick5Engine.calculateScore() documents for pick5_picks.
    const pickUpdates: { id: number; game_entry_id: string; gameweek_id: number; team_id: number; result: string }[] = []
    const eliminatedEntryIds: string[] = []
    const pickedEntryIds = new Set<string>()

    for (const pick of (picks ?? []) as PickRow[]) {
      pickedEntryIds.add(pick.game_entry_id)
      const fixture = fixtureByTeam.get(pick.team_id)
      if (!fixture) continue // no fixture data yet — leave 'pending'

      const isHome = fixture.home_team_id === pick.team_id
      const teamGoals = isHome ? fixture.home_goals : fixture.away_goals
      const oppGoals = isHome ? fixture.away_goals : fixture.home_goals
      const isWinning = teamGoals > oppGoals

      if (fixture.status === 'live') {
        const result = isWinning ? 'winning' : 'losing'
        if (result !== pick.result) {
          pickUpdates.push({ id: pick.id, game_entry_id: pick.game_entry_id, gameweek_id: gameweekId, team_id: pick.team_id, result })
        }
      } else if (fixture.status === 'finished') {
        const result = isWinning ? 'won' : 'lost'
        if (result !== pick.result) {
          pickUpdates.push({ id: pick.id, game_entry_id: pick.game_entry_id, gameweek_id: gameweekId, team_id: pick.team_id, result })
        }
        if (!isWinning) eliminatedEntryIds.push(pick.game_entry_id)
      }
      // scheduled/postponed/cancelled/tbd: nothing has happened yet, leave as-is.
    }

    for (const entryId of aliveEntryIds) {
      if (!pickedEntryIds.has(entryId)) {
        eliminatedEntryIds.push(entryId)
      }
    }

    if (pickUpdates.length > 0) {
      const { error: pickUpdateError } = await ctx.supabase
        .from('lms_team_picks')
        .upsert(pickUpdates, { onConflict: 'id' })

      if (pickUpdateError) {
        throw new Error(`Failed to write pick results: ${pickUpdateError.message}`)
      }
    }

    if (eliminatedEntryIds.length > 0) {
      const { error: eliminateError } = await ctx.supabase
        .from('game_entry_lms')
        .update({ competitive_status: 'eliminated', eliminated_gameweek_id: gameweekId })
        .in('game_entry_id', eliminatedEntryIds)

      if (eliminateError) {
        throw new Error(`Failed to eliminate entries: ${eliminateError.message}`)
      }
    }
  }

  async settle(_ctx: GameEngineContext, _gameweekId: number): Promise<void> {
    throw new GameEngineNotImplementedError('last_man_standing', 'settle')
  }

  async generateStandings(_ctx: GameEngineContext, _potId: string): Promise<StandingsRow[]> {
    throw new GameEngineNotImplementedError('last_man_standing', 'generateStandings')
  }

  async determineWinner(_ctx: GameEngineContext, _potId: string): Promise<string[]> {
    throw new GameEngineNotImplementedError('last_man_standing', 'determineWinner')
  }

  async awardPrize(_ctx: GameEngineContext, _potId: string): Promise<void> {
    throw new GameEngineNotImplementedError('last_man_standing', 'awardPrize')
  }

  async notifyUsers(_ctx: GameEngineContext, _event: NotificationEvent): Promise<void> {
    throw new GameEngineNotImplementedError('last_man_standing', 'notifyUsers')
  }
}
