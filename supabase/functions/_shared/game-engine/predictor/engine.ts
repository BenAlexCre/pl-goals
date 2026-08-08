// Milestone 6 (docs/game-engine.md § GE-5.3, GE-12): validateEntry (Slice 2),
// lockEntries (Slice 3), and calculateScore (Slice 4) are implemented —
// every other GameEngine method still throws GameEngineNotImplementedError,
// same "half-built mode fails loudly" pattern Pick5Engine/LmsEngine used
// between their own early slices and later ones.
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

    // Milestone 6 Slice 3: deliberately does NOT also check
    // predictor_fixture_picks.locked_at here, even though lockEntries()
    // (below) now sets it. Same reasoning as LmsEngine.validateEntry():
    // this live deadline comparison is already the actual enforcement
    // mechanism, and it's strictly at least as current as locked_at can
    // ever be (locked_at is only set by the next lockEntries() cron tick,
    // which runs after the deadline, never before it) — checking both
    // would be redundant, not additionally protective. locked_at exists as
    // an explicit, queryable "is this final" signal for calculateScore()/
    // settle() (future slices), not as a second gate here.

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

  // GE-6: "Transition eligible [picks] from pending to locked" — for Score
  // Predictor that's predictor_fixture_picks.locked_at, not
  // game_entries.status. Not copied from LmsEngine.lockEntries() — the
  // same structural fact independently forces the same conclusion: a
  // season-scoped game_entries row (GE-4.5, confirmed by Slices 1-2) has no
  // life tied to any one gameweek, so locking it at gameweek 13's deadline
  // would make it impossible to ever submit a prediction for gameweek 14.
  // What actually needs to become immutable at a deadline is this specific
  // gameweek's prediction, not the season-long entry. "Lock both" was
  // considered and rejected too — there is no concept, at lockEntries()'s
  // level, of the entry itself needing to become non-submittable; that's
  // settle()'s/voiding's job, out of scope for this slice, and conflating
  // the two would duplicate a concern already owned elsewhere. See
  // docs/decisions.md § Score Predictor locking.
  //
  // No pot-id/game-type filter needed, same reasoning as LmsEngine's own
  // version: predictor_fixture_picks is written only by
  // submit-predictor-picks, itself gated to score_predictor pots, so every
  // row in this table is already unambiguously Score Predictor's.
  async lockEntries(ctx: GameEngineContext, gameweekId: number): Promise<number> {
    const { data: locked, error } = await ctx.supabase
      .from('predictor_fixture_picks')
      .update({ locked_at: ctx.now().toISOString() })
      .eq('gameweek_id', gameweekId)
      .is('locked_at', null)
      .select('id')

    if (error) {
      throw new Error(`Failed to lock predictor picks: ${error.message}`)
    }

    return locked?.length ?? 0
  }

  // GE-6: "Resolve picks against real fixture data." Not copied from
  // either Pick5Engine or LmsEngine — justified fresh, per method, below.
  //
  // No pot filter needed here, same reasoning as lockEntries() (Slice 3):
  // predictor_fixture_picks is written only by submit-predictor-picks,
  // already gated to score_predictor pots, so every row is unambiguously
  // this mode's.
  //
  // Per-fixture status check (not Pick5's gameweek-wide `isLive` flag):
  // justified by data shape, not preference. Pick5's own flag is only
  // correct because its player_fixture_goals data isn't fixture-specific;
  // every Predictor pick already names its own fixture_id, so checking
  // that fixture's own status directly (same as LmsEngine's
  // fixtureByTeam-keyed check) is both more precise and no more complex.
  // scheduled/live/postponed/cancelled/tbd: nothing resolved yet, leave
  // points_awarded null — deliberately no interim "currently winning"
  // label the way Pick 5/LMS give live picks one (Slice 2 already decided
  // points_awarded has no in-between state: null = unresolved, a value =
  // resolved, no `pick_result`-style enum). Postponed/cancelled are
  // treated identically to scheduled/live/tbd — same as
  // LmsEngine.calculateScore()'s own explicit stance ("nothing has
  // happened yet, leave as-is"), reused here because fixture_status is
  // shared platform data, not a rule either mode invented for itself.
  //
  // Money-adjacent scoring math is now per-pot configurable (repo owner
  // decision, 2026-08-08 — 019_predictor_scoring_config.sql), unlike
  // either Pick 5 (goal_threshold lives on the pick itself) or LMS (no
  // per-pick scoring math at all, just win/lose). This is why this
  // method, uniquely among the three modes' calculateScore()s, needs to
  // read `pots` at all.
  //
  // Idempotency (the whole reason cumulative stats are a full recompute,
  // never an increment): a season-scoped `game_entry_predictor` row can be
  // touched by many different gameweeks' calculateScore() calls over the
  // season, each of which might retry independently — incrementing
  // `total_points` would double-count on any retry. Recomputing it (and
  // exact_score_count/correct_scorer_count) as a fresh SUM/COUNT across
  // every one of the entry's resolved picks, every time, is the only way
  // to make this safe to call any number of times, in any order, matching
  // generateStandings()'s own "always recompute" philosophy in every other
  // mode rather than calculateScore()'s own per-gameweek delta pattern
  // (safe for Pick 5 only because its entry — and picks_won — are
  // themselves gameweek-scoped, not season-scoped).
  async calculateScore(ctx: GameEngineContext, gameweekId: number): Promise<void> {
    // Cheap early exit — no consequential work happens before at least one
    // fixture in this gameweek has actually started.
    const { data: activeFixtures, error: activeFixturesError } = await ctx.supabase
      .from('fixtures')
      .select('id')
      .eq('gameweek_id', gameweekId)
      .in('status', ['live', 'finished'])
      .limit(1)

    if (activeFixturesError) {
      throw new Error(`Failed to check fixture status: ${activeFixturesError.message}`)
    }
    if ((activeFixtures?.length ?? 0) === 0) {
      return
    }

    const { data: picks, error: picksError } = await ctx.supabase
      .from('predictor_fixture_picks')
      .select(
        'id, game_entry_id, fixture_id, predicted_home_score, predicted_away_score, goalscorer_player_id, points_awarded, is_exact_score, scorer_bonus_awarded'
      )
      .eq('gameweek_id', gameweekId)

    if (picksError) {
      throw new Error(`Failed to look up picks: ${picksError.message}`)
    }
    if (!picks?.length) {
      return
    }

    type PickRow = {
      id: number
      game_entry_id: string
      fixture_id: number
      predicted_home_score: number
      predicted_away_score: number
      goalscorer_player_id: number | null
      points_awarded: number | null
      is_exact_score: boolean
      scorer_bonus_awarded: boolean
    }
    const pickRows = picks as PickRow[]

    const fixtureIds = [...new Set(pickRows.map((p) => p.fixture_id))]
    const { data: fixtures, error: fixturesError } = await ctx.supabase
      .from('fixtures')
      .select('id, status, home_goals, away_goals')
      .in('id', fixtureIds)

    if (fixturesError) {
      throw new Error(`Failed to look up fixtures: ${fixturesError.message}`)
    }

    type FixtureRow = { id: number; status: string; home_goals: number; away_goals: number }
    const fixtureById = new Map<number, FixtureRow>((fixtures as FixtureRow[] | null ?? []).map((f) => [f.id, f]))

    const entryIds = [...new Set(pickRows.map((p) => p.game_entry_id))]
    const { data: entries, error: entriesError } = await ctx.supabase
      .from('game_entries')
      .select('id, pot_id')
      .in('id', entryIds)

    if (entriesError) {
      throw new Error(`Failed to look up entries: ${entriesError.message}`)
    }

    type EntryRow = { id: string; pot_id: string }
    const potIdByEntryId = new Map<string, string>((entries as EntryRow[] | null ?? []).map((e) => [e.id, e.pot_id]))

    const potIds = [...new Set(potIdByEntryId.values())]
    const { data: pots, error: potsError } = await ctx.supabase
      .from('pots')
      .select('id, predictor_exact_score_points, predictor_correct_result_points, predictor_scorer_bonus_points, predictor_scorer_scope')
      .in('id', potIds)

    if (potsError) {
      throw new Error(`Failed to look up pot scoring configuration: ${potsError.message}`)
    }

    type PotConfig = {
      id: string
      predictor_exact_score_points: number
      predictor_correct_result_points: number
      predictor_scorer_bonus_points: number
      predictor_scorer_scope: 'fixture_only' | 'gameweek_wide'
    }
    const potConfigById = new Map<string, PotConfig>((pots as PotConfig[] | null ?? []).map((p) => [p.id, p]))

    // Goal data for the whole gameweek (not just each pick's own predicted
    // fixture) — predictor_scorer_scope = 'gameweek_wide' needs to check
    // anywhere in the gameweek, not only the predicted fixture, per that
    // column's own existing, already-decided definition (GE-5.3/004).
    const goalscorerPlayerIds = [...new Set(pickRows.map((p) => p.goalscorer_player_id).filter((id): id is number => id !== null))]

    let goalRows: { player_id: number; fixture_id: number; goals: number }[] = []
    if (goalscorerPlayerIds.length > 0) {
      const { data: goalData, error: goalsError } = await ctx.supabase
        .from('player_fixture_goals')
        .select('player_id, fixture_id, goals')
        .eq('gameweek_id', gameweekId)
        .in('player_id', goalscorerPlayerIds)

      if (goalsError) {
        throw new Error(`Failed to look up player goals: ${goalsError.message}`)
      }
      goalRows = (goalData ?? []) as { player_id: number; fixture_id: number; goals: number }[]
    }

    const scoredFixturesByPlayer = new Map<number, Set<number>>()
    const gameweekGoalsByPlayer = new Map<number, number>()
    for (const row of goalRows) {
      if (row.goals > 0) {
        if (!scoredFixturesByPlayer.has(row.player_id)) scoredFixturesByPlayer.set(row.player_id, new Set())
        scoredFixturesByPlayer.get(row.player_id)!.add(row.fixture_id)
      }
      gameweekGoalsByPlayer.set(row.player_id, (gameweekGoalsByPlayer.get(row.player_id) ?? 0) + row.goals)
    }

    const pickUpdates: {
      id: number
      game_entry_id: string
      gameweek_id: number
      fixture_id: number
      predicted_home_score: number
      predicted_away_score: number
      goalscorer_player_id: number | null
      points_awarded: number
      is_exact_score: boolean
      scorer_bonus_awarded: boolean
    }[] = []
    const affectedEntryIds = new Set<string>()

    for (const pick of pickRows) {
      const fixture = fixtureById.get(pick.fixture_id)
      if (!fixture || fixture.status !== 'finished') continue

      const potId = potIdByEntryId.get(pick.game_entry_id)
      const potConfig = potId ? potConfigById.get(potId) : undefined
      if (!potConfig) continue // defensive — shouldn't happen given the FK chain from pick to entry to pot

      const isExactScore = pick.predicted_home_score === fixture.home_goals && pick.predicted_away_score === fixture.away_goals
      const predictedSign = Math.sign(pick.predicted_home_score - pick.predicted_away_score)
      const actualSign = Math.sign(fixture.home_goals - fixture.away_goals)
      const isCorrectResult = predictedSign === actualSign

      let scorerBonusAwarded = false
      if (pick.goalscorer_player_id !== null) {
        scorerBonusAwarded =
          potConfig.predictor_scorer_scope === 'fixture_only'
            ? (scoredFixturesByPlayer.get(pick.goalscorer_player_id)?.has(pick.fixture_id) ?? false)
            : (gameweekGoalsByPlayer.get(pick.goalscorer_player_id) ?? 0) > 0
      }

      const basePoints = isExactScore
        ? potConfig.predictor_exact_score_points
        : isCorrectResult
          ? potConfig.predictor_correct_result_points
          : 0
      const pointsAwarded = basePoints + (scorerBonusAwarded ? potConfig.predictor_scorer_bonus_points : 0)

      affectedEntryIds.add(pick.game_entry_id)

      if (pick.points_awarded === pointsAwarded && pick.is_exact_score === isExactScore && pick.scorer_bonus_awarded === scorerBonusAwarded) {
        continue // already correctly resolved — avoid a no-op write
      }

      pickUpdates.push({
        id: pick.id,
        game_entry_id: pick.game_entry_id,
        gameweek_id: gameweekId,
        fixture_id: pick.fixture_id,
        predicted_home_score: pick.predicted_home_score,
        predicted_away_score: pick.predicted_away_score,
        goalscorer_player_id: pick.goalscorer_player_id,
        points_awarded: pointsAwarded,
        is_exact_score: isExactScore,
        scorer_bonus_awarded: scorerBonusAwarded,
      })
    }

    if (pickUpdates.length > 0) {
      const { error: pickUpdateError } = await ctx.supabase
        .from('predictor_fixture_picks')
        .upsert(pickUpdates, { onConflict: 'id' })

      if (pickUpdateError) {
        throw new Error(`Failed to write pick results: ${pickUpdateError.message}`)
      }
    }

    if (affectedEntryIds.size === 0) {
      return
    }

    // Full recompute, batched — see this method's own comment above for
    // why an increment would not be safe here. game_entry_predictor.game_entry_id
    // is a real primary key (not a partial-unique-index shape like
    // pot_prizes/pot_standings_snapshots), so a plain upsert by it is
    // correct with no get-or-create-by-id workaround needed.
    const affectedEntryIdList = [...affectedEntryIds]
    const { data: allResolvedPicks, error: allPicksError } = await ctx.supabase
      .from('predictor_fixture_picks')
      .select('game_entry_id, points_awarded, is_exact_score, scorer_bonus_awarded')
      .in('game_entry_id', affectedEntryIdList)
      .not('points_awarded', 'is', null)

    if (allPicksError) {
      throw new Error(`Failed to look up resolved picks for cumulative stats: ${allPicksError.message}`)
    }

    type ResolvedPick = { game_entry_id: string; points_awarded: number; is_exact_score: boolean; scorer_bonus_awarded: boolean }
    const statsByEntry = new Map<string, { totalPoints: number; exactScoreCount: number; correctScorerCount: number }>()
    for (const entryId of affectedEntryIdList) {
      statsByEntry.set(entryId, { totalPoints: 0, exactScoreCount: 0, correctScorerCount: 0 })
    }
    for (const resolvedPick of (allResolvedPicks as ResolvedPick[] | null) ?? []) {
      const stats = statsByEntry.get(resolvedPick.game_entry_id)
      if (!stats) continue
      stats.totalPoints += resolvedPick.points_awarded
      if (resolvedPick.is_exact_score) stats.exactScoreCount++
      if (resolvedPick.scorer_bonus_awarded) stats.correctScorerCount++
    }

    const statsUpdates = affectedEntryIdList.map((entryId) => {
      const stats = statsByEntry.get(entryId)!
      return {
        game_entry_id: entryId,
        total_points: stats.totalPoints,
        exact_score_count: stats.exactScoreCount,
        correct_scorer_count: stats.correctScorerCount,
      }
    })

    const { error: statsUpdateError } = await ctx.supabase
      .from('game_entry_predictor')
      .upsert(statsUpdates, { onConflict: 'game_entry_id' })

    if (statsUpdateError) {
      throw new Error(`Failed to update cumulative stats: ${statsUpdateError.message}`)
    }
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
