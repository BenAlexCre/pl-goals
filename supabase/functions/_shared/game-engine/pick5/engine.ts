// Pick5Engine — the first real GameEngine implementation (GE-6), Milestone 4
// Slice 2. Only validateEntry() is implemented this slice; every other
// lifecycle method throws GameEngineNotImplementedError, per the pattern
// errors.ts documents for a mode landing incrementally (lockEntries in
// Slice 3+, calculateScore/settle in later slices, following
// docs/game-engine.md § GE-12's Milestone 4 sequencing).

import type { GameEngine, GameEngineContext } from '../contracts.ts'
import type { GameEntry, NotificationEvent, StandingsRow } from '../types.ts'
import { GameEngineNotImplementedError } from '../errors.ts'
import { Pick5ValidationError } from './errors.ts'

export const PICK5_PICK_COUNT = 5

// Positions in public.players that can never be picked. 'Goalkeeper' is a
// product decision (resolves ISSUE-7 — the prototype's two pick-building
// flows disagreed; this implementation picks one rule going forward:
// goalkeepers are excluded). 'Coach' is not a product decision — it's a data
// fact (public.players stores non-playing staff with the same
// player_team_history shape as players) that available_players_by_gameweek
// never filtered; a coach cannot score a goal, so including one here would be
// a functional bug, not a rule anyone chose. See current-state.md ISSUE-23.
const PICK5_INELIGIBLE_POSITIONS = new Set(['Goalkeeper', 'Coach'])

export interface Pick5PickInput {
  playerId: number
}

interface EligiblePlayerRow {
  player_id: number
  position: string | null
}

function parsePicks(picks: unknown): Pick5PickInput[] {
  if (!Array.isArray(picks)) {
    throw new Pick5ValidationError('picks must be an array')
  }
  if (picks.length !== PICK5_PICK_COUNT) {
    throw new Pick5ValidationError(`Exactly ${PICK5_PICK_COUNT} picks are required, got ${picks.length}`)
  }
  return picks.map((pick, index) => {
    if (
      typeof pick !== 'object' ||
      pick === null ||
      !('playerId' in pick) ||
      typeof (pick as Record<string, unknown>).playerId !== 'number' ||
      !Number.isInteger((pick as Record<string, unknown>).playerId)
    ) {
      throw new Pick5ValidationError(`Pick at position ${index + 1} must include an integer playerId`)
    }
    return { playerId: (pick as { playerId: number }).playerId }
  })
}

export class Pick5Engine implements GameEngine {
  async validateEntry(ctx: GameEngineContext, entry: GameEntry, picks: unknown): Promise<void> {
    if (entry.status !== 'pending') {
      throw new Pick5ValidationError(`Entry is ${entry.status}, not pending — picks can no longer be changed`)
    }
    if (entry.gameweekId === null) {
      throw new Pick5ValidationError('Pick 5 entries must be scoped to a gameweek')
    }

    const parsedPicks = parsePicks(picks)
    const uniquePlayerIds = [...new Set(parsedPicks.map((p) => p.playerId))]

    const { data: eligiblePlayers, error } = await ctx.supabase
      .from('available_players_by_gameweek')
      .select('player_id, position')
      .eq('gameweek_id', entry.gameweekId)
      .in('player_id', uniquePlayerIds)

    if (error) {
      throw new Error(`Failed to check player eligibility: ${error.message}`)
    }

    const eligibleById = new Map<number, string | null>(
      ((eligiblePlayers ?? []) as EligiblePlayerRow[]).map((row) => [row.player_id, row.position])
    )

    for (const playerId of uniquePlayerIds) {
      if (!eligibleById.has(playerId)) {
        throw new Pick5ValidationError(
          `Player ${playerId} is not eligible for this gameweek (not on an active squad with a scheduled fixture)`
        )
      }
      const position = eligibleById.get(playerId) ?? null
      if (position !== null && PICK5_INELIGIBLE_POSITIONS.has(position)) {
        throw new Pick5ValidationError(`Player ${playerId} (${position}) cannot be picked`)
      }
    }
  }

  lockEntries(_ctx: GameEngineContext, _gameweekId: number): Promise<number> {
    throw new GameEngineNotImplementedError('pick5', 'lockEntries')
  }

  calculateScore(_ctx: GameEngineContext, _gameweekId: number): Promise<void> {
    throw new GameEngineNotImplementedError('pick5', 'calculateScore')
  }

  settle(_ctx: GameEngineContext, _gameweekId: number): Promise<void> {
    throw new GameEngineNotImplementedError('pick5', 'settle')
  }

  generateStandings(_ctx: GameEngineContext, _potId: string): Promise<StandingsRow[]> {
    throw new GameEngineNotImplementedError('pick5', 'generateStandings')
  }

  determineWinner(_ctx: GameEngineContext, _potId: string): Promise<string[]> {
    throw new GameEngineNotImplementedError('pick5', 'determineWinner')
  }

  awardPrize(_ctx: GameEngineContext, _potId: string): Promise<void> {
    throw new GameEngineNotImplementedError('pick5', 'awardPrize')
  }

  notifyUsers(_ctx: GameEngineContext, _event: NotificationEvent): Promise<void> {
    throw new GameEngineNotImplementedError('pick5', 'notifyUsers')
  }
}
