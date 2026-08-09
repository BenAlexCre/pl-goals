// Milestone 6 (docs/game-engine.md § GE-5.3, GE-12): validateEntry (Slice 2),
// lockEntries (Slice 3), calculateScore (Slice 4), settle (Slice 5),
// generateStandings (Slice 6), determineWinner (Slice 7), awardPrize
// (Slice 8), and notifyUsers (Slice 9) are implemented — all eight
// GameEngine contract methods are now implemented for Score Predictor,
// same milestone-completion point Pick5Engine/LmsEngine each reached at
// the end of their own Slice 9.
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
import type { GameEntry, NotificationEvent, StandingsRow } from '../types.ts'
import { PredictorPrizePoolExceededError, PredictorValidationError } from './errors.ts'

// GE-4.8: notifications.type is free text at the schema level — same
// per-mode catalog approach Pick5NotificationType/LmsNotificationType
// already established. Only one event exists, mirroring both existing
// modes' own single event type exactly (pick5.prize_awarded,
// lms.prize_awarded): a real payout, for every actual recipient. Unlike
// LMS (which weighed and explicitly rejected a second, rollover-specific
// event — no Pick 5 equivalent to model, not asked for), Predictor has no
// second event candidate to even consider: awardPrize() has exactly one
// non-trivial outcome shape (season_end, GE-5.3 — no elimination, no
// wipeout, no rollover), so there is nothing else for a notification to
// describe.
export type PredictorNotificationType = 'predictor.prize_awarded'

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

// GE-6/GE-8.4: standard competition ranking ("1224" — ties share a rank;
// the next distinct score skips ahead by however many were tied) —
// identical algorithm to Pick5Engine's own private rankWithTies(),
// duplicated per GE-18 ("pick5/ must never import from lms/ or predictor/,
// and vice versa") rather than imported. Reused here, not reinvented,
// because Predictor's game_entry_predictor.total_points is a genuine,
// directly comparable cumulative score — the same shape Pick 5's
// picks_won is, unlike LMS's synthetic alive/eliminated indicator, which
// has no equivalent use for this function at all.
function rankWithTies(entries: { userId: string; score: number }[]): { userId: string; score: number; rank: number }[] {
  const sorted = [...entries].sort((a, b) => b.score - a.score)
  const ranked: { userId: string; score: number; rank: number }[] = []
  for (let index = 0; index < sorted.length; index++) {
    const rank = index === 0 || sorted[index].score < sorted[index - 1].score ? index + 1 : ranked[index - 1].rank
    ranked.push({ ...sorted[index], rank })
  }
  return ranked
}

// Money helpers — same rounding rules as Pick5Engine's/LmsEngine's own
// (docs/decisions.md § Prize pool deductions): roundToCents (standard
// round-half-up) for the gross/fee/net calculation itself; floorToCents
// (always down) when splitting the net pool across multiple recipients,
// so no tied recipient is ever favored by rounding. Genuinely shared-
// platform money math, not Predictor-specific — reimplemented privately
// here rather than imported (GE-18 forbids cross-mode imports), same
// acknowledged-duplication category as rankWithTies()/
// upsertOverallStandings() above.
function roundToCents(amount: number): number {
  return Math.round(amount * 100) / 100
}

function floorToCents(amount: number): number {
  return Math.floor(amount * 100) / 100
}

function calculatePredictorFeeAmount(
  type: 'none' | 'fixed' | 'percentage',
  fixedAmount: number | null,
  percentage: number | null,
  grossAmount: number
): number {
  if (type === 'fixed') {
    return fixedAmount ?? 0
  }
  if (type === 'percentage') {
    return roundToCents((grossAmount * (percentage ?? 0)) / 100)
  }
  return 0
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
    // Cross-slice correction, 2026-08-08 (post-Slice-5 review, see
    // docs/decisions.md § calculateScore() must not mutate a voided entry):
    // status is now selected alongside pot_id specifically to exclude a
    // voided entry's picks from being resolved/aggregated below — without
    // it, an entry settle() had already voided for non-payment could still
    // have a not-yet-finished pick freshly scored, and its points folded
    // into game_entry_predictor's totals, by this same method running for a
    // later gameweek. Predictor entries never reach any status besides
    // 'pending'/'void' at this stage (GE-4.5 — no 'locked'/'settled' until
    // a future slice), so "pending" is exactly equivalent to "not void."
    const { data: entries, error: entriesError } = await ctx.supabase
      .from('game_entries')
      .select('id, pot_id, status')
      .in('id', entryIds)

    if (entriesError) {
      throw new Error(`Failed to look up entries: ${entriesError.message}`)
    }

    type EntryRow = { id: string; pot_id: string; status: string }
    const entryRows = (entries as EntryRow[] | null) ?? []
    const potIdByEntryId = new Map<string, string>(entryRows.map((e) => [e.id, e.pot_id]))
    const pendingEntryIds = new Set(entryRows.filter((e) => e.status === 'pending').map((e) => e.id))

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
      if (!pendingEntryIds.has(pick.game_entry_id)) continue // voided (or otherwise non-pending) entry — settle() already excluded it, never re-resolve

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

  // game_entries is shared across every mode (GE-4.5) — unlike
  // predictor_fixture_picks, which lockEntries()/calculateScore() can query
  // unfiltered because it's written only by an already-gated function, a
  // game_entries query here needs an explicit pot filter, same reasoning
  // Pick5Engine.getPick5PotIds() already established. Simpler than
  // LmsEngine.getEligibleLmsPotIds(): no start_gameweek_id filter exists for
  // Predictor pots (confirmed — Score Predictor entry-window rule remains
  // genuinely undecided, docs/decisions.md § Score Predictor architecture
  // review), and no "already concluded" filter is possible yet either,
  // since PredictorEngine.awardPrize() doesn't write pot_prizes yet (it's
  // out of scope for this slice, per the repo owner's explicit instruction)
  // — every score_predictor pot is therefore eligible, unconditionally, for
  // now. Revisit once awardPrize() exists, same sequencing-gap shape
  // LmsEngine's own Slice 7→8 closed.
  private async getPredictorPotIds(ctx: GameEngineContext): Promise<string[]> {
    const { data: predictorPots, error } = await ctx.supabase
      .from('pots')
      .select('id')
      .eq('game_type', 'score_predictor')

    if (error) {
      throw new Error(`Failed to look up Score Predictor pots: ${error.message}`)
    }

    return (predictorPots ?? []).map((p: { id: string }) => p.id)
  }

  // GE-6: "Finalize this gameweek's outcome for the mode." Reviewed
  // Pick5Engine.settle() and LmsEngine.settle() first — modeled on neither
  // wholesale. Slice 5's scope is deliberately narrow, per explicit
  // instruction: the Payment Verification payment-void rule only. No
  // generateStandings()/determineWinner()/awardPrize()/notifyUsers() call —
  // same "deliberately small" shape LmsEngine.settle() had in its own
  // Slice 5, for the same underlying reason: those methods either aren't
  // implemented yet (throw GameEngineNotImplementedError) or genuinely
  // don't make sense to call on an ordinary gameweek for a competition that
  // only concludes once, at season end.
  //
  // Five questions, answered before writing this method:
  //
  // 1. What constitutes a settled scoring period? Not a season/cycle
  //    concept at all for this method's actual scope — "settled" here
  //    means only "this gameweek's payment-void check has run," gated by
  //    the same caller-side "are this gameweek's fixtures all finished"
  //    check settle-gameweek/index.ts already applies uniformly to every
  //    mode, same as Pick5/LMS. No independent period/cycle boundary is
  //    computed or needed by this method.
  //
  // 2/3. Does settlement happen once per cycle or once per season, and how
  //    does predictor_cycle_mode influence it? Neither, and not at all —
  //    confirmed by review, not guessed. Payment Verification for
  //    Predictor is entry_payments.scope = 'season': one flat fee for the
  //    whole competition (GE-4.3 already anticipated this shape for a
  //    "future Predictor payment model," flagging it "still undecided" —
  //    this slice's review confirms it, since Predictor's game_entries is
  //    season-scoped exactly like LMS's, GE-4.5). A flat one-time fee's
  //    paid/unpaid status has no cycle-dependent timing, so there is
  //    nowhere in this logic predictor_cycle_mode could apply. Its two
  //    real, documented uses — a not-yet-enforced pick-reuse restriction,
  //    and a not-yet-decided determineWinner()/awardPrize() payout-timing
  //    question (does a two_halves pot pay out once or twice?) — are both
  //    explicitly out of this slice's scope. Re-checking payment every
  //    gameweek this method runs (rather than only once at some computed
  //    boundary) is therefore not just simplest but correct: it mirrors
  //    LmsEngine.settle()'s identical re-check-every-call behavior for the
  //    identical payment shape.
  //
  // 4. How are unpaid entries treated after scores already exist? The
  //    entry's game_entries.status flips to 'void' (shared entry_status
  //    enum, same value Pick5/LMS use) — already-computed
  //    predictor_fixture_picks.points_awarded / game_entry_predictor
  //    totals are left untouched by this method, matching Pick5/LMS's own
  //    settle(): neither zeroes the mode's own scoring columns, only
  //    generateStandings() (a future slice) actually excludes a void
  //    entry from a ranked result, by only ranking 'settled' entries.
  //    Deliberately NOT mirrored here: Pick5Engine/LmsEngine also flip
  //    their own picks table's per-row result to 'void'
  //    (pick5_picks.result / lms_team_picks.result) — predictor_fixture_picks
  //    has no equivalent column, and unlike those two tables, it never had
  //    one before this slice either. Adding one now would be new schema
  //    surface with no reader (calculateScore() isn't being touched this
  //    slice, per instruction, so nothing would ever consult it) — flagged
  //    as a real, known gap for a future slice (most likely whichever one
  //    builds a Predictor results UI or generateStandings()) rather than
  //    added speculatively.
  //
  //    A related, more consequential gap found during this review, also
  //    flagged rather than fixed here: predictor_fixture_picks is
  //    season-wide (one game_entries row spans every gameweek, GE-4.5),
  //    but calculateScore() only ever resolves the ONE gameweek it's
  //    called for and has no game_entries.status awareness at all. An
  //    entry voided at gameweek 5's settle() could still have a
  //    not-yet-finished gameweek 8 pick resolved and folded into
  //    game_entry_predictor's totals once gameweek 8 finishes — settle()
  //    never revisits or corrects that. LmsEngine has a narrower version
  //    of the same shape (its own calculateScore() checks
  //    game_entry_lms.competitive_status, which settle()'s void path
  //    doesn't sync either) that has never been fixed or even flagged.
  //    Not addressed here — this slice implements settle() only, per
  //    instruction — but recorded explicitly so it isn't lost, unlike its
  //    LMS analog.
  //
  // 5. Can settlement safely rerun indefinitely? Yes. The unpaid-entry set
  //    is re-derived fresh from entry_payments on every call; voiding an
  //    entry is a plain status update that naturally excludes it from the
  //    next call's `.eq('status', 'pending')` selection (idempotent — a
  //    retry that finds nothing new to void simply does nothing). Only one
  //    write happens in this method (the entries update), unlike Pick5/
  //    LMS's two-step "void picks, then void entries" sequence — there is
  //    no picks-level write here to order relative to it (see Q4 above),
  //    so there is no partial-failure/retry-ordering hazard to guard
  //    against in the first place, not an omitted safeguard.
  //
  // Query shape: entries stay 'pending' for the whole competition, exactly
  // like LMS (GE-4.5) — Predictor's own lockEntries() (Slice 3) locks the
  // individual prediction, never game_entries.status, so 'pending' is the
  // only status a live entry is ever in before this method runs. Paid
  // entries are left untouched (still 'pending') — same as
  // LmsEngine.settle(), which never transitions a paid entry to 'settled'
  // either, since that only makes sense once the competition itself
  // concludes (determineWinner()/awardPrize() territory, out of scope).
  //
  // Revised, Milestone 6 Slice 6: now also calls generateStandings() per
  // eligible pot, unconditionally — the same "small, explicit revision"
  // both Pick5Engine.settle() and LmsEngine.settle() needed when their own
  // Slice 6 shipped generateStandings() for the first time (neither
  // originally called it, since it didn't exist yet). Restructured so the
  // payment-void logic (unchanged) sits inside an `if (entries?.length)`
  // block instead of its own early return — the old early-return-when-
  // nothing's-unpaid path would otherwise skip standings entirely on the
  // overwhelmingly common tick where nobody needs voiding, which is
  // exactly when a fresh calculateScore() pass most needs its results
  // reflected. determineWinner()/awardPrize()/notifyUsers() are
  // deliberately NOT called here, per explicit instruction — same
  // "generateStandings() only" scope this slice was given.
  async settle(ctx: GameEngineContext, gameweekId: number): Promise<void> {
    const potIds = await this.getPredictorPotIds(ctx)
    if (potIds.length === 0) {
      return
    }

    const { data: entries, error: entriesError } = await ctx.supabase
      .from('game_entries')
      .select('id, pot_id, user_id')
      .eq('status', 'pending')
      .in('pot_id', potIds)

    if (entriesError) {
      throw new Error(`Failed to look up entries: ${entriesError.message}`)
    }

    if (entries?.length) {
      const { data: payments, error: paymentsError } = await ctx.supabase
        .from('entry_payments')
        .select('pot_id, user_id, is_paid')
        .eq('scope', 'season')
        .in('pot_id', potIds)

      if (paymentsError) {
        throw new Error(`Failed to look up payments: ${paymentsError.message}`)
      }

      const paidKeys = new Set(
        ((payments ?? []) as { pot_id: string; user_id: string; is_paid: boolean }[])
          .filter((p) => p.is_paid)
          .map((p) => `${p.pot_id}:${p.user_id}`)
      )

      const unpaidEntryIds = (entries as { id: string; pot_id: string; user_id: string }[])
        .filter((e) => !paidKeys.has(`${e.pot_id}:${e.user_id}`))
        .map((e) => e.id)

      if (unpaidEntryIds.length > 0) {
        const { error: voidEntriesError } = await ctx.supabase
          .from('game_entries')
          .update({ status: 'void' })
          .in('id', unpaidEntryIds)

        if (voidEntriesError) {
          throw new Error(`Failed to void unpaid entries: ${voidEntriesError.message}`)
        }
      }
    }

    // Same per-pot failure isolation Pick5Engine.settle()/LmsEngine.settle()
    // already established (production hardening sprint, 2026-08-06) — one
    // pot's generateStandings()/awardPrize() failure must never block
    // another unrelated pot's, or the payment-void work above (already
    // durably written). Collected and raised together, after every pot's
    // had its chance, rather than on the first failure.
    //
    // awardPrize() wired in here as of Slice 8 — the same revision
    // Pick5Engine's/LmsEngine's own settle() needed when each shipped
    // awardPrize() for the first time (their own Slice 8s). Most calls
    // will find the season still in progress and awardPrize() will
    // silently no-op, exactly like generateStandings() being idempotent/
    // harmless on an ordinary gameweek.
    const potErrors: { potId: string; message: string }[] = []
    for (const potId of potIds) {
      try {
        await this.generateStandings(ctx, potId)
        await this.awardPrize(ctx, potId)
      } catch (err) {
        potErrors.push({ potId, message: err instanceof Error ? err.message : String(err) })
      }
    }

    if (potErrors.length > 0) {
      throw new Error(
        `settle() finalized entries for gameweek ${gameweekId}, but standings/prize processing failed for ${potErrors.length} pot(s): ` +
          potErrors.map((e) => `${e.potId}: ${e.message}`).join('; ')
      )
    }
  }

  // GE-6: "Write pot_standings_snapshots rows." Reviewed
  // Pick5Engine.generateStandings() and LmsEngine.generateStandings()
  // first — modeled on neither wholesale, and NOT assumed to match either
  // by default, per explicit instruction. Justified against both:
  //
  // vs. Pick 5: same in one real way — Predictor's game_entry_predictor.
  // total_points is a genuine, directly comparable cumulative score,
  // exactly like Pick 5's picks_won, so ranking reuses the identical
  // standard-competition-ranking algorithm (rankWithTies(), below — ties
  // share a rank, the next distinct score skips ahead by however many
  // tied; the same ISSUE-17 resolution, confirmed with the repo owner
  // once, applies platform-wide, not per mode). Different in shape:
  // Pick 5 writes a per-gameweek row *and* an overall row, because a new
  // payable instance (a weekly jackpot) concludes every gameweek — no
  // such per-gameweek payout concept exists for Predictor (GE-5.3: the
  // pot is split once, at season end), so writing a per-gameweek snapshot
  // here would be schema nobody reads, the same "no unused abstraction"
  // discipline this codebase already applies elsewhere.
  //
  // vs. LMS: same in shape — season-scoped entry (GE-4.5), so only the
  // overall row (gameweek_id null) is written, never a per-gameweek one,
  // for the identical reason LMS has none: no meaningful per-gameweek
  // snapshot exists when the entry itself isn't gameweek-scoped. Same
  // get-or-create-by-id upsert workaround (upsertOverallStandings(),
  // below), duplicated per GE-18 rather than imported, mirroring
  // LmsEngine's own private copy. Different in ranking entirely: LMS has
  // no real score (a synthetic 1/0 alive/eliminated indicator, ranked by
  // elimination recency) because nobody accumulates points; Predictor's
  // score is real from the start, so it's ranked like Pick 5's, not LMS's
  // — copying LMS's alive/eliminated-shaped ranking here would have been
  // assuming the wrong precedent for a mode that actually has a score.
  //
  // Six questions, answered before writing this method:
  //
  // 1/2. Answered above (Pick 5/LMS comparison).
  //
  // 3. Generated every gameweek settle() runs, gated only by the same
  //    caller-side "this gameweek's fixtures are all finished" check
  //    settle-gameweek/index.ts already applies uniformly — not "only
  //    after settled gameweeks" (that phrase describes determineWinner()/
  //    awardPrize() territory, out of scope) and not a separate internal
  //    fixture-status check of its own. This method trusts
  //    game_entry_predictor.total_points as already-correct, exactly like
  //    Pick5Engine's/LmsEngine's own generateStandings() trust their
  //    respective source tables — calculateScore() (Slice 4) is what
  //    actually enforces "only finished fixtures contribute," and its own
  //    full-recompute design (never incremental) is precisely what makes
  //    trusting it here safe rather than assumed.
  //
  // 4. Standard competition ranking, ties sharing a rank — see the Pick 5
  //    comparison above. No Predictor-specific secondary tiebreak (e.g.
  //    "most exact scores wins a tie") is invented — nothing in GE-5.3 or
  //    business-rules.md states one, and inventing one here would be the
  //    same mistake ISSUE-17 already taught this codebase to avoid when
  //    real money is involved.
  //
  // 5. meta: { exactScoreCount, correctScorerCount } — the same
  //    "interesting fact behind the number" purpose LMS's meta already
  //    established (elimination gameweek), sourced directly from
  //    game_entry_predictor's own existing columns, zero extra queries.
  //    Display-only, never queried or joined on (GE-20).
  //
  // 6. Void entries never appear — same shared Payment Verification rule
  //    every mode follows (business-rules.md § Payment verification
  //    rules), enforced with the exact filter just corrected on
  //    LmsEngine.generateStandings() moments earlier this same session
  //    (docs/decisions.md § LMS standings must exclude voided entries):
  //    .neq('status', 'void'), not .eq('status', 'pending') — Predictor
  //    entries can also reach 'settled' once a future awardPrize() slice
  //    ships, and a settled entry must still show in standings (the
  //    competition having concluded doesn't erase its final position),
  //    so excluding only 'void' is the correct filter, matching LMS's own
  //    corrected reasoning exactly rather than Pick5's narrower
  //    'settled'-only one (which excludes not-yet-concluded entries
  //    entirely — wrong for a mode with no per-gameweek conclusion).
  //
  // 7. A reinstated entry reappears automatically, with no special-case
  //    code — this method has no memory of any previous snapshot, reads
  //    game_entries.status and game_entry_predictor fresh every call, and
  //    a successful reinstatement (docs/decisions.md § Late Payment
  //    Override) already leaves both correctly updated by the time this
  //    runs again.
  //
  // 8. Yes, naturally — a gameweek with some fixtures finished and others
  //    not yet is not a special case this method needs to detect: an
  //    unresolved pick simply hasn't added to total_points yet
  //    (calculateScore()'s own design, Slice 4), so the cumulative score
  //    read here is always an honest "as of right now" total, never a
  //    fabricated complete one.
  async generateStandings(ctx: GameEngineContext, potId: string): Promise<StandingsRow[]> {
    const { data: entries, error: entriesError } = await ctx.supabase
      .from('game_entries')
      .select('user_id, game_entry_predictor(total_points, exact_score_count, correct_scorer_count)')
      .eq('pot_id', potId)
      .neq('status', 'void')

    if (entriesError) {
      throw new Error(`Failed to look up entries: ${entriesError.message}`)
    }
    if (!entries?.length) {
      return []
    }

    // Same defensive array-or-object handling as Pick5Engine's/LmsEngine's
    // own embedded-resource reads — supabase-js infers this many-to-one
    // relation's shape generically without a generated Database type.
    type PredictorEmbed =
      | { total_points: number; exact_score_count: number; correct_scorer_count: number }
      | { total_points: number; exact_score_count: number; correct_scorer_count: number }[]
      | null
    type EntryRow = { user_id: string; game_entry_predictor: PredictorEmbed }

    const statsByUser = new Map<string, { totalPoints: number; exactScoreCount: number; correctScorerCount: number }>()

    for (const entry of entries as EntryRow[]) {
      const stats = Array.isArray(entry.game_entry_predictor) ? entry.game_entry_predictor[0] : entry.game_entry_predictor
      if (!stats) continue // malformed — no extension row; excluded rather than guessed at, same as LmsEngine
      statsByUser.set(entry.user_id, {
        totalPoints: stats.total_points,
        exactScoreCount: stats.exact_score_count,
        correctScorerCount: stats.correct_scorer_count,
      })
    }

    const ranked = rankWithTies([...statsByUser.entries()].map(([userId, s]) => ({ userId, score: s.totalPoints })))

    const standingsRows: StandingsRow[] = ranked.map((r) => {
      const stats = statsByUser.get(r.userId)!
      return {
        potId,
        gameweekId: null,
        userId: r.userId,
        rank: r.rank,
        score: r.score,
        meta: { exactScoreCount: stats.exactScoreCount, correctScorerCount: stats.correctScorerCount },
      }
    })

    await this.upsertOverallStandings(ctx, potId, standingsRows)

    return standingsRows
  }

  // pot_standings_snapshots has two partial unique indexes (GE-4.6) that
  // PostgREST's upsert(onConflict: '...') can't target directly — same
  // workaround as Pick5Engine's/LmsEngine's own private copies: look up
  // existing rows by their natural key first, then upsert only by `id`
  // (the real, non-partial primary key). Duplicated per GE-18 rather than
  // imported — the project-board.md "Ready" item flagging this workaround
  // for a future shared-helper extraction now has a third private copy,
  // strengthening rather than changing that already-deferred decision.
  private async upsertOverallStandings(ctx: GameEngineContext, potId: string, rows: StandingsRow[]): Promise<void> {
    if (rows.length === 0) {
      return
    }

    const { data: existing, error: existingError } = await ctx.supabase
      .from('pot_standings_snapshots')
      .select('id, user_id')
      .eq('pot_id', potId)
      .is('gameweek_id', null)

    if (existingError) {
      throw new Error(`Failed to look up existing standings: ${existingError.message}`)
    }

    const existingIdByUser = new Map<string, number>(
      ((existing ?? []) as { id: number; user_id: string }[]).map((r) => [r.user_id, r.id])
    )

    const toUpdate: Record<string, unknown>[] = []
    const toInsert: Record<string, unknown>[] = []

    for (const row of rows) {
      const base = { pot_id: potId, gameweek_id: null, user_id: row.userId, rank: row.rank, score: row.score, meta: row.meta }
      const existingId = existingIdByUser.get(row.userId)
      if (existingId !== undefined) {
        toUpdate.push({ ...base, id: existingId })
      } else {
        toInsert.push(base)
      }
    }

    if (toUpdate.length > 0) {
      const { error } = await ctx.supabase.from('pot_standings_snapshots').upsert(toUpdate, { onConflict: 'id' })
      if (error) {
        throw new Error(`Failed to update standings: ${error.message}`)
      }
    }
    if (toInsert.length > 0) {
      const { error } = await ctx.supabase.from('pot_standings_snapshots').insert(toInsert)
      if (error) {
        throw new Error(`Failed to insert standings: ${error.message}`)
      }
    }
  }

  // Shared between determineWinner() and a future awardPrize() — same
  // split LmsEngine's own classifyOutcome()/determineWinner() already
  // established (a rich, reusable classification behind a thin GE-6
  // wrapper). One outcome type simpler than LMS's four
  // (in_progress/single_survivor/wipeout/season_end): Predictor has no
  // elimination concept at all (GE-5.3 — every entry stays in for the
  // whole season, ranked by cumulative points, confirmed since Slice 1's
  // own architecture review), so there is no "single survivor" or
  // "wipeout" case to distinguish — the competition can only ever
  // conclude one way, at the season's actual end.
  //
  // Eight questions, answered before writing this method:
  //
  // 1. What constitutes a completed Predictor competition? The pot's
  //    designated final gameweek (pots.end_gameweek_id — a shared,
  //    mode-agnostic column, GE-4.1, not an LMS-specific concept borrowed
  //    without justification) has actually passed its deadline. Same
  //    mechanism LmsEngine.classifyOutcome() already uses for its own
  //    season_end case, reused here for the identical reason: nothing
  //    about "has this season's real-world calendar end been reached"
  //    differs between the two modes. Unlike LMS, this is Predictor's
  //    *only* conclusion path — no elimination means no earlier-than-
  //    end-gameweek conclusion is structurally possible.
  //
  // 2. How does predictor_cycle_mode affect this? Not at all, confirmed
  //    by reasoning rather than assumed silently. GE-6's fixed
  //    determineWinner(ctx, potId) signature has no way to express "which
  //    half" — it can only ever answer one question, "who has the most
  //    cumulative points once the season ends," and that computation is
  //    identical regardless of predictor_cycle_mode: a two_halves pot's
  //    season-end winner is still whoever has the most points across the
  //    whole season, exactly like a single_cycle pot's. The genuinely
  //    open, still-unresolved question — whether a two_halves pot ALSO
  //    needs a SEPARATE, earlier determination at its half-cycle boundary
  //    (docs/decisions.md § Score Predictor architecture review; GE-15's
  //    "half_cycle boundary computation... needs resolving") — is a
  //    question about a different, not-yet-designed invocation this
  //    method has no part of, not something this slice guesses at or
  //    blocks on.
  //
  // 3. Once per season, once per half, or both? Once per season only —
  //    the only concept the fixed interface can express (see Q2). "Once
  //    per half" would need a different method signature entirely, not
  //    something to invent here per "implement determineWinner() only."
  //
  // 4. Ties? Revised, Milestone 6 Slice 8, 2026-08-08 — the repo owner
  //    supplied a real product rule (originally presented labelled as a
  //    Pick 5 change; its own vocabulary — "exact score predictions,"
  //    "correct goalscorer predictions" — matches nothing in Pick 5's
  //    actual pick model at all, only Predictor's own
  //    game_entry_predictor.exact_score_count/correct_scorer_count, so
  //    this was confirmed with the repo owner directly rather than guessed
  //    at or silently applied to the wrong mode; Pick 5's own
  //    determineWinner()/awardPrize() are unchanged by this slice).
  //    Winner hierarchy, applied only when the tier above is tied:
  //      1. Highest total_points.
  //      2. Most exact_score_count.
  //      3. Most correct_scorer_count.
  //      4. Still tied — every remaining entry wins jointly, net prize
  //         split equally (awardPrize()'s existing floorToCents behavior,
  //         unchanged).
  //    Deliberately NOT applied to generateStandings()'s own ranking
  //    (Slice 6) — the repo owner's own instruction for this correction
  //    said "no changes to standings unless genuinely required," and nothing
  //    about awarding the actual prize requires the ongoing leaderboard
  //    display to adopt the same tiebreak; that leaderboard still uses
  //    the shared "every rank-1 entry ties, no further tiebreak" rule
  //    every other standings view in this codebase uses.
  //
  // 5. Standings snapshots, or recompute from source? Recompute directly
  //    from game_entries/game_entry_predictor — explicitly required
  //    ("never depend on cached state, recompute from authoritative
  //    data"), and matches LmsEngine.classifyOutcome()'s own choice, not
  //    Pick5Engine.determineWinner()'s (which does read
  //    pot_standings_snapshots — safe for Pick 5 only because a settled
  //    gameweek's snapshot can never change retroactively; Predictor's
  //    season-end snapshot could in principle be stale if
  //    generateStandings() hasn't been re-run since the last score
  //    change, so trusting it here would be trusting a cache, not the
  //    source of truth).
  //
  // 6. Reinstated entries? Included automatically, no special-case code —
  //    this method has no memory of any previous call, reads
  //    game_entries.status and game_entry_predictor fresh every time, and
  //    a successful reinstatement (docs/decisions.md § Late Payment
  //    Override) already leaves both correctly updated by the time this
  //    runs.
  //
  // 7. Can a void entry become eligible again? Yes, via the same
  //    reinstatement flow — this method excludes status = 'void' entries
  //    at read time (same .neq('status', 'void') filter
  //    generateStandings() uses), so a still-void entry never wins, but
  //    nothing here remembers that exclusion between calls; once
  //    reinstated, it's simply no longer void the next time this runs.
  //
  // 8. Idempotent? Yes, trivially — this method (and classifyOutcome())
  //    performs no writes of any kind, same "only determine the outcome"
  //    discipline the repo owner required of LmsEngine.determineWinner().
  //    A pure read of current state is idempotent by construction; two
  //    calls with no state change in between return identical results,
  //    and a call after a real state change (a rescored gameweek, a
  //    reinstatement) correctly reflects it — never stale, because
  //    nothing is ever cached.
  private async classifyOutcome(ctx: GameEngineContext, potId: string): Promise<{ type: 'in_progress' } | { type: 'season_end'; winnerIds: string[] }> {
    const { data: pot, error: potError } = await ctx.supabase
      .from('pots')
      .select('end_gameweek_id')
      .eq('id', potId)
      .maybeSingle()

    if (potError) {
      throw new Error(`Failed to look up pot: ${potError.message}`)
    }
    if (!pot?.end_gameweek_id) {
      return { type: 'in_progress' } // no designated season end configured — cannot conclude
    }

    const { data: endGameweek, error: gameweekError } = await ctx.supabase
      .from('gameweeks')
      .select('deadline_utc')
      .eq('id', pot.end_gameweek_id)
      .maybeSingle()

    if (gameweekError) {
      throw new Error(`Failed to look up the pot's final gameweek: ${gameweekError.message}`)
    }
    if (!endGameweek?.deadline_utc || ctx.now() < new Date(endGameweek.deadline_utc)) {
      return { type: 'in_progress' }
    }

    // Season has concluded — recompute the leaderboard directly from
    // source tables, same non-void filter as generateStandings() (Slice 6).
    // exact_score_count/correct_scorer_count are read alongside
    // total_points now (Slice 8) — both already existed on
    // game_entry_predictor since Slice 4, maintained by calculateScore()'s
    // own full-recompute design, so no schema change and no new query
    // this method didn't already need most of.
    const { data: entries, error: entriesError } = await ctx.supabase
      .from('game_entries')
      .select('user_id, game_entry_predictor(total_points, exact_score_count, correct_scorer_count)')
      .eq('pot_id', potId)
      .neq('status', 'void')

    if (entriesError) {
      throw new Error(`Failed to look up entries: ${entriesError.message}`)
    }

    type PredictorStats = { total_points: number; exact_score_count: number; correct_scorer_count: number }
    type PredictorEmbed = PredictorStats | PredictorStats[] | null
    type EntryRow = { user_id: string; game_entry_predictor: PredictorEmbed }

    type Candidate = { userId: string; totalPoints: number; exactScoreCount: number; correctScorerCount: number }
    const candidatesByUser = new Map<string, Candidate>()
    for (const entry of (entries ?? []) as EntryRow[]) {
      const stats = Array.isArray(entry.game_entry_predictor) ? entry.game_entry_predictor[0] : entry.game_entry_predictor
      if (!stats) continue // malformed — no extension row; excluded rather than guessed at
      candidatesByUser.set(entry.user_id, {
        userId: entry.user_id,
        totalPoints: stats.total_points,
        exactScoreCount: stats.exact_score_count,
        correctScorerCount: stats.correct_scorer_count,
      })
    }

    if (candidatesByUser.size === 0) {
      return { type: 'season_end', winnerIds: [] } // concluded, but nobody eligible to win
    }

    // Tiebreak hierarchy — each level only narrows the field further when
    // the level above is genuinely tied; a level that already narrows to
    // one candidate short-circuits the rest, same as a real "first
    // criterion that breaks the tie wins" rule would.
    let candidates = [...candidatesByUser.values()]

    const maxPoints = Math.max(...candidates.map((c) => c.totalPoints))
    candidates = candidates.filter((c) => c.totalPoints === maxPoints)

    if (candidates.length > 1) {
      const maxExactScores = Math.max(...candidates.map((c) => c.exactScoreCount))
      candidates = candidates.filter((c) => c.exactScoreCount === maxExactScores)
    }

    if (candidates.length > 1) {
      const maxCorrectScorers = Math.max(...candidates.map((c) => c.correctScorerCount))
      candidates = candidates.filter((c) => c.correctScorerCount === maxCorrectScorers)
    }

    return { type: 'season_end', winnerIds: candidates.map((c) => c.userId) }
  }

  // GE-6: "Identify the winner(s)." Reviewed Pick5Engine.determineWinner()
  // and LmsEngine.determineWinner() first — modeled on neither wholesale.
  // A thin wrapper over classifyOutcome(), same shape as LmsEngine's own
  // (not Pick5Engine's one-line pot_standings_snapshots lookup — see
  // classifyOutcome()'s own comment, point 5, for why). No writes of any
  // kind — no pot_prizes, no notifications — per the repo owner's
  // explicit "only determine the outcome" instruction, same discipline
  // already established for LMS.
  async determineWinner(ctx: GameEngineContext, potId: string): Promise<string[]> {
    const outcome = await this.classifyOutcome(ctx, potId)
    return outcome.type === 'season_end' ? outcome.winnerIds : []
  }

  // GE-6: "Split net prize pool equally." Reviewed Pick5Engine.awardPrize()
  // and LmsEngine.awardPrize() first, plus the prize-deduction math and
  // every transaction-ordering correction already applied to both
  // (hardening sprint, 2026-08-06). Not modeled on either wholesale —
  // justified per question below.
  //
  // Seven questions, answered before writing this method:
  //
  // 1. How does predictor_cycle_mode affect prize awarding? Not at all —
  //    same reasoning as determineWinner() (above): the fixed
  //    awardPrize(ctx, potId) signature can only ever award the season-end
  //    outcome determineWinner() identified, and that computation and
  //    payout are both unchanged by cycle mode. The still-open "does
  //    two_halves need a SEPARATE, earlier payout at its half-cycle
  //    boundary" question is not resolved or guessed at here — it would
  //    need its own, not-yet-designed invocation this method has no part
  //    of, exactly the same conclusion determineWinner() already reached.
  //
  // 2. One pot_prizes row, or multiple? One — scope='season', matching
  //    LmsEngine's shape exactly, not Pick5Engine's (which legitimately
  //    creates a new scope='gameweek' row every week because a new
  //    payable instance — a weekly jackpot — concludes weekly for Pick 5).
  //    Predictor has exactly one conclusion, ever, per pot (GE-5.3, no
  //    elimination, no recurring weekly payout concept) — the identical
  //    structural fact that already made LMS a single-row mode.
  //
  // 3. How are tied winners paid? Equally, via the same floorToCents split
  //    every mode already uses — the tiebreak hierarchy above (Slice 8)
  //    narrows determineWinner()'s output as far as points/exact-score/
  //    scorer-count can resolve it; whatever's left after that genuinely
  //    ties and splits, same as Pick 5's/LMS's own remaining-tie handling.
  //    No tied recipient is ever favored by rounding — the remainder (at
  //    most winnerCount - 1 cents) is never paid to anyone, identical rule
  //    platform-wide.
  //
  // 4. Does Predictor use prize deductions identically to Pick 5/LMS? Yes
  //    — admin_fee_*/charity_fee_* are shared, mode-agnostic pots columns
  //    (GE-4.1), calculated with the identical roundToCents/fee-percentage
  //    math (calculatePredictorFeeAmount, above — a private duplicate of
  //    the same logic, per GE-18). One genuine divergence: gross_amount
  //    has no carry_over_amount term the way LmsEngine's does — LMS's
  //    carry-over exists specifically for its own rollover-pot mechanism
  //    (a wipeout resolving as roll_prize, GE-5.2), a structurally LMS-only
  //    concept with no Predictor equivalent (Predictor pots' own
  //    carry_over_amount is always 0, since nothing ever sets it for this
  //    game_type) — including a always-zero term would be dead code, not
  //    a faithful port.
  //
  // 5. Should awardPrize() consume determineWinner() directly? Yes —
  //    unlike LmsEngine.awardPrize() (which calls classifyOutcome()
  //    directly, because it genuinely needs the richer outcome type to
  //    distinguish wipeout/season_end/single_survivor's different payout
  //    groups and the wipeout-only rollover branch), Predictor's
  //    classifyOutcome() carries no information determineWinner() doesn't
  //    already flatten faithfully — there is only one non-trivial outcome
  //    shape, season_end, and no further branching by outcome type. Calling
  //    determineWinner() directly here matches Pick5Engine.awardPrize()'s
  //    own choice, for the same reason: nothing richer to lose by using
  //    the thin wrapper instead of the private helper. Confirms, rather
  //    than duplicates, determineWinner()'s own tiebreak logic — the
  //    entire reason this question was asked was to avoid re-implementing
  //    that hierarchy a second time here.
  //
  // 6. Idempotent across repeated execution? Yes — identical mechanism to
  //    Pick5Engine's/LmsEngine's own: an existing, settled pot_prizes row
  //    (scope='season') short-circuits the whole method before any
  //    classification or writes happen.
  //
  // 7. Any additional transaction-ordering risks? Simpler than LMS's, not
  //    riskier — Predictor has no rollover-pot-creation step (that's an
  //    LMS-only wipeout mechanism), so there are only three writes: settle
  //    entries to 'settled' (idempotent UPDATE), write payouts (idempotent
  //    UPDATE), then the pot_prizes row LAST — applying the exact ordering
  //    lesson the hardening sprint had to retrofit onto Pick5Engine/
  //    LmsEngine from the start, not rediscovering it. is_settled=true is
  //    written only once every other write has already succeeded, so a
  //    failure anywhere above it leaves the pot safely retryable — every
  //    write above it is naturally idempotent, requiring no separate
  //    compensating-rollback logic the way LmsEngine's own rollover step
  //    needs.
  //
  // Every non-void entry (not just winners) transitions to status =
  // 'settled' once a real outcome is reached — deferred exactly this far,
  // same "'settled' only makes sense once the competition has concluded"
  // reasoning Slice 5 already established and explicitly deferred to here.
  async awardPrize(ctx: GameEngineContext, potId: string): Promise<void> {
    const { data: existingPrize, error: existingPrizeError } = await ctx.supabase
      .from('pot_prizes')
      .select('id, is_settled')
      .eq('pot_id', potId)
      .eq('scope', 'season')
      .maybeSingle()

    if (existingPrizeError) {
      throw new Error(`Failed to look up existing prize: ${existingPrizeError.message}`)
    }
    if ((existingPrize as { id: number; is_settled: boolean } | null)?.is_settled) {
      return
    }

    const winners = await this.determineWinner(ctx, potId)
    if (winners.length === 0) {
      // Deliberately silent, matching LmsEngine.awardPrize()'s philosophy,
      // not Pick5Engine's (which throws Pick5NoEligibleWinnersError on
      // zero winners): "season not concluded yet" is Predictor's normal,
      // overwhelmingly common state (this method is intended to be called
      // on every settle() tick, same as LMS), and a genuinely-concluded
      // pot with zero eligible entries has zero money to award either
      // (gross_amount will compute to 0) — internally consistent, not an
      // anomaly worth failing loudly for the way Pick 5's own "settled
      // entries exist but nobody ranks 1" case is.
      return
    }

    const { data: pot, error: potError } = await ctx.supabase
      .from('pots')
      .select('entry_fee, admin_fee_type, admin_fee_amount, admin_fee_percentage, charity_fee_type, charity_fee_amount, charity_fee_percentage')
      .eq('id', potId)
      .single()

    if (potError) {
      throw new Error(`Failed to look up pot fee configuration: ${potError.message}`)
    }

    type PotFeeConfig = {
      entry_fee: number
      admin_fee_type: 'none' | 'fixed' | 'percentage'
      admin_fee_amount: number | null
      admin_fee_percentage: number | null
      charity_fee_type: 'none' | 'fixed' | 'percentage'
      charity_fee_amount: number | null
      charity_fee_percentage: number | null
    }
    const potConfig = pot as PotFeeConfig

    // Gross amount: every non-void entry counts (not just 'settled' ones
    // — that transition hasn't happened yet at this point in the method,
    // same reasoning as LmsEngine.awardPrize()'s identical gross-amount
    // query; Pick5Engine's own version can count 'settled' entries only
    // because its settle() already made that transition earlier). No
    // carry_over_amount term — see Q4 above.
    const { data: nonVoidEntries, error: nonVoidError } = await ctx.supabase
      .from('game_entries')
      .select('id')
      .eq('pot_id', potId)
      .neq('status', 'void')

    if (nonVoidError) {
      throw new Error(`Failed to count non-void entries: ${nonVoidError.message}`)
    }

    const grossAmount = roundToCents(potConfig.entry_fee * (nonVoidEntries?.length ?? 0))
    const adminFeeAmount = calculatePredictorFeeAmount(potConfig.admin_fee_type, potConfig.admin_fee_amount, potConfig.admin_fee_percentage, grossAmount)
    const charityFeeAmount = calculatePredictorFeeAmount(potConfig.charity_fee_type, potConfig.charity_fee_amount, potConfig.charity_fee_percentage, grossAmount)
    const netAmount = roundToCents(grossAmount - adminFeeAmount - charityFeeAmount)

    if (netAmount < 0) {
      throw new PredictorPrizePoolExceededError(potId, grossAmount, adminFeeAmount, charityFeeAmount)
    }

    // Settle every non-void entry (not just winners) — idempotent UPDATE,
    // safe to repeat on retry. Written before the payout loop, matching
    // Pick5Engine's/LmsEngine's own ordering (both naturally-idempotent
    // updates, order between them doesn't affect retry-safety either way,
    // kept consistent with precedent for readability).
    const { error: settleEntriesError } = await ctx.supabase
      .from('game_entries')
      .update({ status: 'settled', settled_at: ctx.now().toISOString() })
      .eq('pot_id', potId)
      .neq('status', 'void')

    if (settleEntriesError) {
      throw new Error(`Failed to settle entries: ${settleEntriesError.message}`)
    }

    const perWinnerAmount = floorToCents(netAmount / winners.length)

    for (const userId of winners) {
      const { error: payoutError } = await ctx.supabase
        .from('game_entries')
        .update({ payout_amount: perWinnerAmount })
        .eq('pot_id', potId)
        .eq('user_id', userId)

      if (payoutError) {
        throw new Error(`Failed to write payout for user ${userId}: ${payoutError.message}`)
      }
    }

    // Written LAST, deliberately — applying the hardening-sprint lesson
    // from the start rather than retrofitting it: is_settled=true here is
    // what makes every future call treat this pot as concluded, so
    // nothing above this line may be allowed to run again "for free"
    // after it. Every write above is a naturally idempotent UPDATE, safe
    // to repeat on a retry.
    const prizeRow = {
      pot_id: potId,
      scope: 'season' as const,
      gameweek_id: null,
      gross_amount: grossAmount,
      admin_fee_amount: adminFeeAmount,
      charity_fee_amount: charityFeeAmount,
      is_settled: true,
      settled_at: ctx.now().toISOString(),
    }

    // Same get-or-create-then-write-by-id workaround pot_standings_snapshots
    // needed (GE-4.6) — pot_prizes has the identical partial-unique-index
    // shape (pot_prizes_season_key on (pot_id) where scope='season').
    if (existingPrize) {
      const { error: updateError } = await ctx.supabase
        .from('pot_prizes')
        .update(prizeRow)
        .eq('id', (existingPrize as { id: number }).id)

      if (updateError) {
        throw new Error(`Failed to update prize: ${updateError.message}`)
      }
    } else {
      const { error: insertError } = await ctx.supabase.from('pot_prizes').insert(prizeRow)

      if (insertError) {
        throw new Error(`Failed to insert prize: ${insertError.message}`)
      }
    }

    // GE-8.7/decisions.md § Notifications: called last, deliberately —
    // after the trailing pot_prizes write above, not from inside the
    // payout loop. Reviewed Pick5Engine's/LmsEngine's own call sites
    // first — reused, not reinvented: same invariant both already
    // established (a notification only ever fires once both the money
    // AND the settlement record it describes are already durably
    // written), same placement relative to the pot_prizes write LMS uses
    // (LMS also writes pot_prizes last, for the identical reason Slice 8
    // gave this method the same ordering from the start). Best-effort —
    // a failure here must never unwind or block a payout already
    // written, and must never stop the loop from notifying this pot's
    // remaining winners, so it's caught and logged rather than left to
    // propagate, exactly like both existing modes' own call sites.
    // notifyUsers() itself still throws on error (like every other
    // GameEngine method) — the try/catch boundary belongs here, at the
    // one call site that knows this specific write is allowed to fail
    // silently, not inside notifyUsers() itself.
    //
    // One notification per winning user (never once per pot) — the same
    // loop shape both existing modes use, uniform regardless of whether
    // winners.length is 1 (a sole winner) or more (a tied group splitting
    // the prize): no special-casing by winner count, since a "tied
    // winner" notification and a "sole winner" notification are the same
    // write with a different payload, not a structurally different flow.
    //
    // Idempotent the same way both existing modes already are — not via
    // any dedup mechanism on the notifications table itself (there is
    // none, matching established precedent), but because this entire
    // loop is only ever reached once per pot's actual conclusion: the
    // is_settled short-circuit at the top of this method means a pot
    // that has already been awarded never reaches this loop again on any
    // later call, so notifications can never be duplicated by a retry of
    // the outer method. A single recipient's own notification write
    // failing (logged, not retried) is an accepted, pre-existing
    // limitation this design shares with Pick5Engine's/LmsEngine's own —
    // not a new gap introduced here, and not something this slice
    // redesigns.
    for (const userId of winners) {
      try {
        await this.notifyUsers(ctx, {
          userId,
          potId,
          type: 'predictor.prize_awarded' satisfies PredictorNotificationType,
          payload: { amount: perWinnerAmount, tied: winners.length > 1 },
        })
      } catch (notifyError) {
        console.error(
          `notifyUsers failed for pot ${potId}, user ${userId} (prize already awarded, not affected): ` +
            (notifyError instanceof Error ? notifyError.message : String(notifyError))
        )
      }
    }
  }

  // GE-6: "Write to notifications." A pure domain-event emitter — inserts
  // one row and returns, no delivery mechanism of any kind (email/push/
  // SMS remain explicitly out of scope, docs/decisions.md § Notifications).
  // Reviewed Pick5Engine.notifyUsers() and LmsEngine.notifyUsers() first —
  // both are byte-for-byte identical to each other already (insert one
  // row, throw on error), confirming this is genuinely shared-platform-
  // shaped, zero-mode-specific-logic behavior, not something to
  // reinterpret for Predictor. Duplicated privately per GE-18 rather than
  // imported, same as every other genuinely-shared-mechanics helper in
  // this file (rankWithTies(), the money helpers, the pot_prizes upsert
  // workaround).
  async notifyUsers(ctx: GameEngineContext, event: NotificationEvent): Promise<void> {
    const { error } = await ctx.supabase.from('notifications').insert({
      user_id: event.userId,
      pot_id: event.potId,
      type: event.type,
      payload: event.payload ?? null,
    })

    if (error) {
      throw new Error(`Failed to write notification: ${error.message}`)
    }
  }
}
