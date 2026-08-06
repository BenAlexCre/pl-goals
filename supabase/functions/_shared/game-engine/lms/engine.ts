// Milestone 5 (docs/game-engine.md § GE-5.2, GE-12): validateEntry (Slice 2)
// is the first real method implemented — lockEntries/calculateScore/settle/
// generateStandings/determineWinner/awardPrize/notifyUsers all still throw
// GameEngineNotImplementedError, same "half-built mode fails loudly" pattern
// Pick5Engine used between its own Slice 2 and Slice 9.

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

  async lockEntries(_ctx: GameEngineContext, _gameweekId: number): Promise<number> {
    throw new GameEngineNotImplementedError('last_man_standing', 'lockEntries')
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
