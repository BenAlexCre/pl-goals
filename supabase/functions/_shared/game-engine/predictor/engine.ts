// Milestone 6 (docs/game-engine.md § GE-5.3, GE-12): validateEntry (Slice 2)
// is implemented — every other GameEngine method still throws
// GameEngineNotImplementedError, same "half-built mode fails loudly"
// pattern Pick5Engine/LmsEngine used between their own Slice 2 and later
// slices.
//
// Architecture review (docs/decisions.md § Score Predictor architecture
// review, Milestone 6 kickoff) found Score Predictor genuinely doesn't
// mirror either Pick 5 or LMS: season-scoped entries (game_entries,
// GE-4.5) like LMS, but no elimination concept at all — every entry stays
// in for the whole season, ranked by cumulative points, closer to Pick 5's
// persistent-score shape. validateEntry() below reflects that: it checks
// entry.status and the live gameweek deadline (same pattern every mode
// uses, since a season-scoped entry has no per-gameweek status to check
// against), but has no analog to LmsEngine's competitive_status/"alive"
// check at all — game_entry_predictor has no such column, deliberately,
// since nobody is ever eliminated.
//
// Two of the five open product questions from the Slice 1 review were
// resolved before this file could be written (see 017_predictor_picks.sql's
// own comment for the full reasoning): a draw is represented by an equal
// predicted scoreline, not a separate column; the goalscorer prediction is
// optional (repo owner, 2026-08-06). Two more remain genuinely open and are
// NOT enforced here, deliberately, not by oversight: the scorer bonus's
// point value (calculateScore() territory, a future slice, not needed to
// validate a submission) and predictor_cycle_mode's "reuse restriction"
// (GE-5.3 confirms one exists but not which predictions it restricts or
// how "half" is computed — enforcing a guessed-at version would be
// inventing a rule, not implementing an approved one). This means a player
// can currently predict the same scoreline or the same goalscorer as many
// times across a season as they like — flagged as a real, known gap for a
// future slice to close once the rule is actually decided, not a silent
// omission.

import type { GameEngine, GameEngineContext } from '../contracts.ts'
import { GameEngineNotImplementedError } from '../errors.ts'
import type { GameEntry, NotificationEvent, StandingsRow } from '../types.ts'
import { PredictorValidationError } from './errors.ts'

export interface PredictorPickInput {
  gameweekId: number
  fixtureId: number
  predictedHomeScore: number
  predictedAwayScore: number
  goalscorerPlayerId: number | null
}

function parsePick(picks: unknown): PredictorPickInput {
  if (typeof picks !== 'object' || picks === null) {
    throw new PredictorValidationError(
      'pick must be an object with gameweekId, fixtureId, predictedHomeScore, predictedAwayScore, and optionally goalscorerPlayerId'
    )
  }
  const { gameweekId, fixtureId, predictedHomeScore, predictedAwayScore, goalscorerPlayerId } = picks as Record<string, unknown>

  if (typeof gameweekId !== 'number' || !Number.isInteger(gameweekId)) {
    throw new PredictorValidationError('gameweekId must be an integer')
  }
  if (typeof fixtureId !== 'number' || !Number.isInteger(fixtureId)) {
    throw new PredictorValidationError('fixtureId must be an integer')
  }
  if (typeof predictedHomeScore !== 'number' || !Number.isInteger(predictedHomeScore) || predictedHomeScore < 0) {
    throw new PredictorValidationError('predictedHomeScore must be a non-negative integer')
  }
  if (typeof predictedAwayScore !== 'number' || !Number.isInteger(predictedAwayScore) || predictedAwayScore < 0) {
    throw new PredictorValidationError('predictedAwayScore must be a non-negative integer')
  }

  let parsedGoalscorerPlayerId: number | null = null
  if (goalscorerPlayerId !== undefined && goalscorerPlayerId !== null) {
    if (typeof goalscorerPlayerId !== 'number' || !Number.isInteger(goalscorerPlayerId)) {
      throw new PredictorValidationError('goalscorerPlayerId must be an integer if provided')
    }
    parsedGoalscorerPlayerId = goalscorerPlayerId
  }

  return { gameweekId, fixtureId, predictedHomeScore, predictedAwayScore, goalscorerPlayerId: parsedGoalscorerPlayerId }
}

export class PredictorEngine implements GameEngine {
  async validateEntry(ctx: GameEngineContext, entry: GameEntry, picks: unknown): Promise<void> {
    if (entry.status !== 'pending') {
      throw new PredictorValidationError(`Entry is ${entry.status}, not pending — picks can no longer be changed`)
    }

    const { gameweekId, fixtureId, goalscorerPlayerId } = parsePick(picks)

    // Live comparison, not a stored status flag — same reasoning as every
    // other mode's season-scoped validateEntry(): the entry itself has no
    // per-gameweek state to check, since GE-4.5 keeps it 'pending' for the
    // whole competition.
    const { data: gameweek, error: gameweekError } = await ctx.supabase
      .from('gameweeks')
      .select('deadline_utc')
      .eq('id', gameweekId)
      .maybeSingle()

    if (gameweekError) {
      throw new Error(`Failed to look up gameweek deadline: ${gameweekError.message}`)
    }
    if (!gameweek) {
      throw new PredictorValidationError(`Gameweek ${gameweekId} does not exist`)
    }
    if (gameweek.deadline_utc && ctx.now() >= new Date(gameweek.deadline_utc)) {
      throw new PredictorValidationError(`Gameweek ${gameweekId}'s deadline has passed — this pick can no longer be made or changed`)
    }

    // GE-5.3: "one fixture predicted per gameweek" — the fixture must
    // actually belong to the gameweek being predicted, not merely exist.
    const { data: fixture, error: fixtureError } = await ctx.supabase
      .from('fixtures')
      .select('gameweek_id, home_team_id, away_team_id')
      .eq('id', fixtureId)
      .maybeSingle()

    if (fixtureError) {
      throw new Error(`Failed to look up fixture: ${fixtureError.message}`)
    }
    if (!fixture) {
      throw new PredictorValidationError(`Fixture ${fixtureId} does not exist`)
    }
    if (fixture.gameweek_id !== gameweekId) {
      throw new PredictorValidationError(`Fixture ${fixtureId} does not belong to gameweek ${gameweekId}`)
    }

    // Optional (repo owner, 2026-08-06) — only validated if actually
    // provided. A data-integrity check, not an invented business rule, same
    // spirit as Pick5Engine's own "is this player eligible for this
    // gameweek" check: a scorer guess must at least be a real player on one
    // of this fixture's two teams.
    if (goalscorerPlayerId !== null) {
      const { data: playerTeam, error: playerTeamError } = await ctx.supabase
        .from('player_team_history')
        .select('team_id')
        .eq('player_id', goalscorerPlayerId)
        .eq('is_active', true)
        .in('team_id', [fixture.home_team_id, fixture.away_team_id])
        .maybeSingle()

      if (playerTeamError) {
        throw new Error(`Failed to check goalscorer eligibility: ${playerTeamError.message}`)
      }
      if (!playerTeam) {
        throw new PredictorValidationError(`Player ${goalscorerPlayerId} is not on either team in fixture ${fixtureId}`)
      }
    }
  }

  async lockEntries(_ctx: GameEngineContext, _gameweekId: number): Promise<number> {
    throw new GameEngineNotImplementedError('score_predictor', 'lockEntries')
  }

  async calculateScore(_ctx: GameEngineContext, _gameweekId: number): Promise<void> {
    throw new GameEngineNotImplementedError('score_predictor', 'calculateScore')
  }

  async settle(_ctx: GameEngineContext, _gameweekId: number): Promise<void> {
    throw new GameEngineNotImplementedError('score_predictor', 'settle')
  }

  async generateStandings(_ctx: GameEngineContext, _potId: string): Promise<StandingsRow[]> {
    throw new GameEngineNotImplementedError('score_predictor', 'generateStandings')
  }

  async determineWinner(_ctx: GameEngineContext, _potId: string): Promise<string[]> {
    throw new GameEngineNotImplementedError('score_predictor', 'determineWinner')
  }

  async awardPrize(_ctx: GameEngineContext, _potId: string): Promise<void> {
    throw new GameEngineNotImplementedError('score_predictor', 'awardPrize')
  }

  async notifyUsers(_ctx: GameEngineContext, _event: NotificationEvent): Promise<void> {
    throw new GameEngineNotImplementedError('score_predictor', 'notifyUsers')
  }
}
