// Pick5Engine — the first real GameEngine implementation (GE-6). Milestone 4
// Slice 2 landed validateEntry(); Slice 3 adds lockEntries(). Every other
// lifecycle method still throws GameEngineNotImplementedError, per the
// pattern errors.ts documents for a mode landing incrementally
// (calculateScore/settle/etc. in later slices, following
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

// GE-6/GE-8.4: standard competition ranking ("1224" — ties share a rank;
// the next distinct score skips ahead by however many were tied). Resolves
// ISSUE-17 — confirmed with the repo owner rather than invented, since
// real money is riding on it and no rule could be inferred from existing
// docs. Tied members are never arbitrarily favored over one another;
// splitting a prize among tied winners is awardPrize()'s job (a later
// slice), not this ranking function's.
function rankWithTies(entries: { userId: string; score: number }[]): { userId: string; score: number; rank: number }[] {
  const sorted = [...entries].sort((a, b) => b.score - a.score)
  const ranked: { userId: string; score: number; rank: number }[] = []
  for (let index = 0; index < sorted.length; index++) {
    const rank = index === 0 || sorted[index].score < sorted[index - 1].score ? index + 1 : ranked[index - 1].rank
    ranked.push({ ...sorted[index], rank })
  }
  return ranked
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
  // Shared by lockEntries()/calculateScore()/settle() — extracted in Slice 5
  // once a third method needed the identical "which pots are pick5" lookup.
  // Internal reuse within one mode's own implementation, not the
  // cross-mode duplication GE-3/GE-18 forbid (LMS/Predictor each have their
  // own equivalent, private to their own engine).
  private async getPick5PotIds(ctx: GameEngineContext): Promise<string[]> {
    const { data: pick5Pots, error } = await ctx.supabase
      .from('pots')
      .select('id')
      .eq('game_type', 'pick5')

    if (error) {
      throw new Error(`Failed to look up pick5 pots: ${error.message}`)
    }

    return (pick5Pots ?? []).map((p: { id: string }) => p.id)
  }

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

  // GE-6: "Transition eligible game_entries from pending to locked." Whether
  // the deadline has actually passed is the caller's decision (compute-deadlines
  // already computes gameweeks.deadline_utc and only calls this once it has) —
  // this method's own job is just the pick5-scoped transition for a gameweek
  // the caller has already selected, mirroring how calculateScore()/settle()
  // also take a caller-selected gameweekId rather than re-deriving eligibility.
  //
  // Scoped to pick5 pots explicitly (a two-step lookup, not a single query
  // with an implicit join) rather than relying on "only pick5 entries have a
  // non-null gameweek_id" (true today per GE-4.5, but not something this
  // method should silently depend on holding forever) — see GE-18's
  // mode-isolation invariant.
  async lockEntries(ctx: GameEngineContext, gameweekId: number): Promise<number> {
    const potIds = await this.getPick5PotIds(ctx)
    if (potIds.length === 0) {
      return 0
    }

    const { data: locked, error: updateError } = await ctx.supabase
      .from('game_entries')
      .update({ status: 'locked' })
      .eq('gameweek_id', gameweekId)
      .eq('status', 'pending')
      .in('pot_id', potIds)
      .select('id')

    if (updateError) {
      throw new Error(`Failed to lock entries: ${updateError.message}`)
    }

    return locked?.length ?? 0
  }

  // GE-6: "Resolve picks against real fixture data." Only touches game_entries
  // that are already 'locked' — a 'pending' entry can still have its picks
  // edited (Slice 2), so scoring one would be meaningless and unstable; a
  // 'settled' entry is already finalized by settle() (a later slice) and
  // must not be silently overwritten. Deliberately does NOT touch payment
  // status or void anything for non-payment — docs/business-rules.md's
  // "unpaid entries are voided at scoring time" rule is real, but voiding is
  // a finalization concern (settle()'s job per GE-6's "Finalize this
  // gameweek's outcome"), not a scoring concern; conflating the two here
  // would make this method do two unrelated things. See session-log.md for
  // this call.
  //
  // Reads public.player_fixture_goals, same as the retired prototype did —
  // inherits ISSUE-3 (the view is never automatically refreshed) unchanged;
  // fixing that is out of scope for this slice.
  async calculateScore(ctx: GameEngineContext, gameweekId: number): Promise<void> {
    const potIds = await this.getPick5PotIds(ctx)
    if (potIds.length === 0) {
      return
    }

    const { data: liveFixtures, error: liveError } = await ctx.supabase
      .from('fixtures')
      .select('id')
      .eq('gameweek_id', gameweekId)
      .eq('status', 'live')
      .limit(1)

    if (liveError) {
      throw new Error(`Failed to check live fixture status: ${liveError.message}`)
    }
    const isLive = (liveFixtures?.length ?? 0) > 0

    const { data: entries, error: entriesError } = await ctx.supabase
      .from('game_entries')
      .select('id')
      .eq('gameweek_id', gameweekId)
      .eq('status', 'locked')
      .in('pot_id', potIds)

    if (entriesError) {
      throw new Error(`Failed to look up locked entries: ${entriesError.message}`)
    }

    const entryIds = (entries ?? []).map((e: { id: string }) => e.id)
    if (entryIds.length === 0) {
      return
    }

    const { data: picks, error: picksError } = await ctx.supabase
      .from('pick5_picks')
      .select('id, game_entry_id, player_id, pick_position, goal_threshold')
      .in('game_entry_id', entryIds)

    if (picksError) {
      throw new Error(`Failed to look up picks: ${picksError.message}`)
    }
    if (!picks?.length) {
      return
    }

    const playerIds = [...new Set(picks.map((p: { player_id: number }) => p.player_id))]

    const { data: goalRows, error: goalsError } = await ctx.supabase
      .from('player_fixture_goals')
      .select('player_id, goals')
      .eq('gameweek_id', gameweekId)
      .in('player_id', playerIds)

    if (goalsError) {
      throw new Error(`Failed to look up player goals: ${goalsError.message}`)
    }

    const goalsByPlayer = new Map<number, number>()
    for (const row of (goalRows ?? []) as { player_id: number; goals: number }[]) {
      goalsByPlayer.set(row.player_id, (goalsByPlayer.get(row.player_id) ?? 0) + (row.goals ?? 0))
    }

    const picksWonByEntry = new Map<string, number>()
    type PickRow = { id: number; game_entry_id: string; player_id: number; pick_position: number; goal_threshold: number }
    // Upsert requires every NOT NULL column without a default (game_entry_id,
    // player_id, pick_position), not just the ones actually changing — Postgres
    // validates the candidate row before it knows the ON CONFLICT branch will
    // fire. Re-sending the unchanged player_id also re-fires
    // trg_pick5_goal_thresholds (it triggers on "update of player_id" being
    // targeted, not on the value actually differing) — harmless, just a
    // redundant recompute of the same numbers.
    const pickUpdates = picks.map((pick: PickRow) => {
      const goals = goalsByPlayer.get(pick.player_id) ?? 0
      const met = goals >= pick.goal_threshold
      const result = met ? (isLive ? 'winning' : 'won') : (isLive ? 'losing' : 'lost')
      if (met) {
        picksWonByEntry.set(pick.game_entry_id, (picksWonByEntry.get(pick.game_entry_id) ?? 0) + 1)
      }
      return {
        id: pick.id,
        game_entry_id: pick.game_entry_id,
        player_id: pick.player_id,
        pick_position: pick.pick_position,
        goals_scored: goals,
        result,
      }
    })

    const { error: pickUpdateError } = await ctx.supabase
      .from('pick5_picks')
      .upsert(pickUpdates, { onConflict: 'id' })

    if (pickUpdateError) {
      throw new Error(`Failed to write pick results: ${pickUpdateError.message}`)
    }

    const entryUpdates = entryIds.map((id) => ({
      game_entry_id: id,
      picks_won: picksWonByEntry.get(id) ?? 0,
    }))

    const { error: entryUpdateError } = await ctx.supabase
      .from('game_entry_pick5')
      .upsert(entryUpdates, { onConflict: 'game_entry_id' })

    if (entryUpdateError) {
      throw new Error(`Failed to write entry scores: ${entryUpdateError.message}`)
    }
  }

  // GE-6: "Finalize this gameweek's outcome for the mode." Only touches
  // 'locked' entries — mirrors calculateScore()'s reasoning: a 'pending'
  // entry can't be finalized (it was never locked), and a 'settled'/'void'
  // entry is already finalized and must not be silently reprocessed. Whether
  // the gameweek's fixtures are actually all finished is the caller's
  // decision (settle-gameweek already computes this), not this method's —
  // same caller-selected-gameweekId pattern as every other lifecycle method.
  //
  // Implements docs/business-rules.md's payment-void rule (§ Payment rules):
  // "An entry that is not marked paid by the time scoring runs is
  // automatically voided." Deliberately deferred out of calculateScore()
  // (Slice 4) into this method, since voiding is a finalization concern, not
  // a scoring one (see that slice's session-log entry for the reasoning).
  //
  // Does NOT create payout_amount or touch pot_prizes — that's
  // awardPrize()'s job (a later slice), called only once determineWinner()
  // has run, per GE-8.4.
  async settle(ctx: GameEngineContext, gameweekId: number): Promise<void> {
    const potIds = await this.getPick5PotIds(ctx)
    if (potIds.length === 0) {
      return
    }

    const { data: entries, error: entriesError } = await ctx.supabase
      .from('game_entries')
      .select('id, pot_id, user_id')
      .eq('gameweek_id', gameweekId)
      .eq('status', 'locked')
      .in('pot_id', potIds)

    if (entriesError) {
      throw new Error(`Failed to look up locked entries: ${entriesError.message}`)
    }
    if (!entries?.length) {
      return
    }

    const { data: payments, error: paymentsError } = await ctx.supabase
      .from('entry_payments')
      .select('pot_id, user_id, is_paid')
      .eq('gameweek_id', gameweekId)
      .eq('scope', 'gameweek')
      .in('pot_id', potIds)

    if (paymentsError) {
      throw new Error(`Failed to look up payments: ${paymentsError.message}`)
    }

    const paidKeys = new Set(
      ((payments ?? []) as { pot_id: string; user_id: string; is_paid: boolean }[])
        .filter((p) => p.is_paid)
        .map((p) => `${p.pot_id}:${p.user_id}`)
    )

    const unpaidEntryIds: string[] = []
    const paidEntryIds: string[] = []
    for (const entry of entries as { id: string; pot_id: string; user_id: string }[]) {
      if (paidKeys.has(`${entry.pot_id}:${entry.user_id}`)) {
        paidEntryIds.push(entry.id)
      } else {
        unpaidEntryIds.push(entry.id)
      }
    }

    if (unpaidEntryIds.length > 0) {
      const { error: voidEntriesError } = await ctx.supabase
        .from('game_entries')
        .update({ status: 'void' })
        .in('id', unpaidEntryIds)

      if (voidEntriesError) {
        throw new Error(`Failed to void unpaid entries: ${voidEntriesError.message}`)
      }

      const { error: voidPicksError } = await ctx.supabase
        .from('pick5_picks')
        .update({ result: 'void' })
        .in('game_entry_id', unpaidEntryIds)

      if (voidPicksError) {
        throw new Error(`Failed to void unpaid entries' picks: ${voidPicksError.message}`)
      }
    }

    if (paidEntryIds.length > 0) {
      const { error: settleError } = await ctx.supabase
        .from('game_entries')
        .update({ status: 'settled', settled_at: ctx.now().toISOString() })
        .in('id', paidEntryIds)

      if (settleError) {
        throw new Error(`Failed to settle paid entries: ${settleError.message}`)
      }
    }

    // GE-8.4's Settlement sequence diagram shows generateStandings() as a
    // self-call from within settle() ("GE->>GE: generateStandings(ctx, potId)"),
    // not a separate step the Edge Function dispatches — so it's invoked
    // here, once per distinct pot represented in this gameweek's entries,
    // rather than from settle-gameweek/index.ts. Runs even for a pot whose
    // entries were all voided this gameweek: the overall/cumulative
    // standings snapshot must still reflect current reality either way, and
    // regenerating is idempotent (upsert), so there's no correctness reason
    // to skip it.
    const distinctPotIds = [...new Set(entries.map((e: { pot_id: string }) => e.pot_id))]
    for (const potId of distinctPotIds) {
      await this.generateStandings(ctx, potId)
    }
  }

  // GE-6: "Write pot_standings_snapshots rows." Called (per GE-8.4) from
  // within settle() after finalizing a gameweek, and potentially on-demand
  // elsewhere later — this method itself doesn't care which. Only 'settled'
  // entries are ranked; 'void' entries are excluded entirely
  // (docs/business-rules.md § Payment rules: "excluded from the leaderboard
  // entirely, regardless of how well its picks would have scored").
  //
  // Writes two shapes per docs/game-engine.md § GE-4.6 / the schema's own
  // two partial unique indexes: one row per (pot, gameweek, user) for every
  // gameweek this pot has ever settled, plus one row per (pot, user) with
  // gameweek_id null — the cumulative/overall standing, resolving ISSUE-15
  // (the prototype's leaderboard_snapshots never wrote this shape at all).
  // Recomputed from scratch across the pot's full settled history each
  // call rather than just the gameweek just settled, since this method only
  // receives a potId (GE-6's contract), not a gameweekId — full recompute
  // is the only way to stay correct regardless of call order, and upserting
  // makes repeat calls idempotent rather than accumulating duplicates.
  //
  // Ranking is standard competition ranking with no further tie-break — see
  // rankWithTies() above for the ISSUE-17 resolution and reasoning.
  async generateStandings(ctx: GameEngineContext, potId: string): Promise<StandingsRow[]> {
    const { data: entries, error: entriesError } = await ctx.supabase
      .from('game_entries')
      .select('user_id, gameweek_id, game_entry_pick5(picks_won)')
      .eq('pot_id', potId)
      .eq('status', 'settled')

    if (entriesError) {
      throw new Error(`Failed to look up settled entries: ${entriesError.message}`)
    }
    if (!entries?.length) {
      return []
    }

    // Same defensive array-or-object handling as compute-deadlines/
    // compute-scores/settle-gameweek's embedded-resource reads — supabase-js
    // infers this many-to-one relation's shape generically without a
    // generated Database type.
    type Pick5Embed = { picks_won: number } | { picks_won: number }[] | null
    type EntryRow = { user_id: string; gameweek_id: number; game_entry_pick5: Pick5Embed }

    const byGameweek = new Map<number, { userId: string; score: number }[]>()
    const overallByUser = new Map<string, number>()

    for (const entry of entries as EntryRow[]) {
      const picksWon = Array.isArray(entry.game_entry_pick5)
        ? entry.game_entry_pick5[0]?.picks_won ?? 0
        : entry.game_entry_pick5?.picks_won ?? 0

      if (!byGameweek.has(entry.gameweek_id)) {
        byGameweek.set(entry.gameweek_id, [])
      }
      byGameweek.get(entry.gameweek_id)!.push({ userId: entry.user_id, score: picksWon })
      overallByUser.set(entry.user_id, (overallByUser.get(entry.user_id) ?? 0) + picksWon)
    }

    const standingsRows: StandingsRow[] = []

    for (const [gameweekId, rows] of byGameweek) {
      const ranked = rankWithTies(rows)
      for (const r of ranked) {
        standingsRows.push({ potId, gameweekId, userId: r.userId, rank: r.rank, score: r.score })
      }
      await this.upsertStandingsGroup(ctx, potId, gameweekId, ranked)
    }

    const overallEntries = [...overallByUser.entries()].map(([userId, score]) => ({ userId, score }))
    const overallRanked = rankWithTies(overallEntries)
    for (const r of overallRanked) {
      standingsRows.push({ potId, gameweekId: null, userId: r.userId, rank: r.rank, score: r.score })
    }
    await this.upsertStandingsGroup(ctx, potId, null, overallRanked)

    return standingsRows
  }

  // pot_standings_snapshots has TWO partial unique indexes
  // (pot_standings_gameweek_key on (pot_id,gameweek_id,user_id) WHERE
  // gameweek_id IS NOT NULL, and pot_standings_overall_key on
  // (pot_id,user_id) WHERE gameweek_id IS NULL — 004_game_engine_shared_platform.sql).
  // PostgREST's upsert(onConflict: '...') generates a bare
  // `ON CONFLICT (columns) DO UPDATE`, and Postgres's conflict-target
  // inference does not match a partial index unless the WHERE predicate is
  // also specified — which the JS client has no way to pass. Confirmed live
  // (not assumed): upserting directly against either partial index by
  // column list fails with "there is no unique or exclusion constraint
  // matching the ON CONFLICT specification." Worked around by never using
  // ON CONFLICT against these partial indexes at all — look up existing
  // rows by their natural key first, then upsert the matches by `id` (the
  // real, non-partial primary key) and plain-insert the rest.
  private async upsertStandingsGroup(
    ctx: GameEngineContext,
    potId: string,
    gameweekId: number | null,
    rows: { userId: string; score: number; rank: number }[]
  ): Promise<void> {
    if (rows.length === 0) {
      return
    }

    let existingQuery = ctx.supabase.from('pot_standings_snapshots').select('id, user_id').eq('pot_id', potId)
    existingQuery = gameweekId === null ? existingQuery.is('gameweek_id', null) : existingQuery.eq('gameweek_id', gameweekId)
    const { data: existing, error: existingError } = await existingQuery

    if (existingError) {
      throw new Error(`Failed to look up existing standings: ${existingError.message}`)
    }

    const existingIdByUser = new Map<string, number>(
      ((existing ?? []) as { id: number; user_id: string }[]).map((r) => [r.user_id, r.id])
    )

    const toUpdate: Record<string, unknown>[] = []
    const toInsert: Record<string, unknown>[] = []

    for (const row of rows) {
      const base = { pot_id: potId, gameweek_id: gameweekId, user_id: row.userId, rank: row.rank, score: row.score }
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
