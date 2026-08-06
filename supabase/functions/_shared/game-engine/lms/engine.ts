// Milestone 5 (docs/game-engine.md § GE-5.2, GE-12): validateEntry (Slice 2)
// and lockEntries (Slice 3) are implemented — calculateScore/settle/
// generateStandings/determineWinner/awardPrize/notifyUsers all still throw
// GameEngineNotImplementedError, same "half-built mode fails loudly" pattern
// Pick5Engine used between its own Slice 2 and Slice 9.
//
// lockEntries() deliberately does NOT touch game_entries.status, unlike
// Pick5Engine's version. game_entries is season-scoped for LMS (GE-4.5) —
// one row for the whole competition — so locking the parent entry at a
// single gameweek's deadline would make it impossible to ever submit a
// pick for the *next* gameweek. What actually needs to become immutable at
// a deadline is this specific gameweek's pick (lms_team_picks.locked_at),
// not the season-long entry. See docs/decisions.md § LMS locking.

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

  async calculateScore(_ctx: GameEngineContext, _gameweekId: number): Promise<void> {
    throw new GameEngineNotImplementedError('last_man_standing', 'calculateScore')
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
