// Pick5Engine — the first real GameEngine implementation (GE-6). Landed
// incrementally, one method per Milestone 4 slice (docs/game-engine.md §
// GE-12): validateEntry (Slice 2), lockEntries (Slice 3), calculateScore
// (Slice 4), settle (Slice 5), generateStandings (Slice 6), determineWinner
// and awardPrize (Slice 8, wired together — see settle()), notifyUsers
// (Slice 9, called from within awardPrize() — see that method's comment).
// All eight GameEngine contract methods are now implemented.

import type { GameEngine, GameEngineContext } from '../contracts.ts'
import type { GameEntry, NotificationEvent, StandingsRow } from '../types.ts'
import { Pick5NoEligibleWinnersError, Pick5PrizePoolExceededError, Pick5ValidationError } from './errors.ts'

// GE-4.8: notifications.type is free text at the schema level — each mode
// chooses and documents its own catalog rather than the DB enforcing one.
// Only one event exists for Pick 5 so far: a winner being awarded a prize
// (see docs/decisions.md § Notifications: domain events, not delivery).
// Other candidate events (entry voided for non-payment, non-winner results)
// were considered and deliberately deferred — see that same ADR — rather
// than added speculatively with no consumer to verify them against.
export type Pick5NotificationType = 'pick5.prize_awarded'

export const PICK5_PICK_COUNT = 5

// Money helpers — deliberately separate rounding rules for two different
// situations, per docs/decisions.md § Prize pool deductions:
// roundToCents (standard round-half-up) for the gross/fee/net calculation
// itself, a conventional default that wasn't one of the two edge cases the
// repo owner was explicitly asked about; floorToCents (always down) for
// splitting the net pool across multiple winners, the repo owner's explicit
// decision so no tied winner is ever favored by rounding.
function roundToCents(amount: number): number {
  return Math.round(amount * 100) / 100
}

function floorToCents(amount: number): number {
  return Math.floor(amount * 100) / 100
}

// pots.{admin,charity}_fee_{type,amount,percentage) -> the calculated euro
// amount to deduct from a specific instance's gross pool. 'none' -> 0;
// 'fixed' -> the configured amount as-is (never more than the config, by
// construction); 'percentage' -> gross x pct / 100, rounded to cents.
function calculateFeeAmount(
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

    // Hardening sprint, 2026-08-06 (architecture review finding): picks are
    // voided BEFORE the entries themselves, deliberately reversed from the
    // most natural reading order. The entries query above selects by
    // status = 'locked' — once an entry flips to 'void', it drops out of
    // that selection on any future call. With the old order (entries
    // first, picks second), a failure on the picks write left the entry
    // permanently 'void' with its picks never voided, and no retry could
    // ever find that entry again to finish the job. Voiding picks first
    // has no such gate: it doesn't depend on, or change, entries.status,
    // so if IT fails, the entry is still 'locked' and a retry re-derives
    // the same unpaidEntryIds and simply tries again — idempotently, since
    // re-voiding an already-void pick is a no-op. Only once the picks
    // write has actually succeeded does the entry itself flip to 'void'.
    if (unpaidEntryIds.length > 0) {
      const { error: voidPicksError } = await ctx.supabase
        .from('pick5_picks')
        .update({ result: 'void' })
        .in('game_entry_id', unpaidEntryIds)

      if (voidPicksError) {
        throw new Error(`Failed to void unpaid entries' picks: ${voidPicksError.message}`)
      }

      const { error: voidEntriesError } = await ctx.supabase
        .from('game_entries')
        .update({ status: 'void' })
        .in('id', unpaidEntryIds)

      if (voidEntriesError) {
        throw new Error(`Failed to void unpaid entries: ${voidEntriesError.message}`)
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

    // GE-8.4's Settlement sequence diagram shows generateStandings() and
    // (Slice 8) determineWinner()/awardPrize() as self-calls from within
    // settle() — "GE->>GE: generateStandings(...)" / "GE->>GE:
    // determineWinner(...)" / "GE->>Pz: awardPrize(...)" — not separate
    // steps the Edge Function dispatches, so both are invoked here, once
    // per distinct pot represented in this gameweek's entries, rather than
    // from settle-gameweek/index.ts. Runs even for a pot whose entries were
    // all voided this gameweek: the overall/cumulative standings snapshot
    // must still reflect current reality either way, and regenerating is
    // idempotent (upsert), so there's no correctness reason to skip it —
    // awardPrize() itself then correctly finds no settled entries for a
    // gameweek nobody paid for and, via getMostRecentGameweekWithStandings(),
    // either no-ops against an already-awarded earlier gameweek or has
    // nothing to do at all.
    // Production readiness audit (2026-08-05): a single pot's awardPrize()
    // failure (e.g. Pick5PrizePoolExceededError — a real, documented
    // failure mode) used to propagate straight out of this loop, so every
    // other pot in the same gameweek — entirely unrelated, correctly
    // configured — silently never got its standings/prize processed
    // either. Each pot's processing is now isolated; entry
    // voiding/settlement above (already durably written) is unaffected
    // either way. settle()'s own return type is part of the fixed
    // GameEngine contract (GE-6) and can't change to return a per-pot
    // error list, so failures are collected and, if any occurred, raised
    // as a single aggregated error only after every pot has had its
    // chance to process — not on the first failure. settle-gameweek's own
    // per-gameweek try/catch (the identical fix, one layer up) is what
    // actually catches this and keeps it from blocking other gameweeks.
    const distinctPotIds = [...new Set(entries.map((e: { pot_id: string }) => e.pot_id))]
    const potErrors: { potId: string; message: string }[] = []
    for (const potId of distinctPotIds) {
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

  // GE-6: "Identify the winner(s)." For Pick 5 specifically, "competition end" is
  // the gameweek just settled, not a season finale — the jackpot is per-gameweek
  // (GE-4.4: pot_prizes.scope = 'gameweek' for Pick 5, unlike LMS/Predictor's
  // season-long pots). This method only receives a potId (GE-6's fixed contract),
  // not a gameweekId, so it identifies "the most recently settled gameweek" from
  // pot_standings_snapshots itself — correct as long as it's only ever called
  // right after that gameweek's settle()/generateStandings() pair has run, which
  // is the only way it's invoked (see settle()'s own comment on why this isn't
  // wired in yet — Slice 7 doesn't call this method from anywhere; it exists
  // standalone, ready for Slice 8 to wire in alongside awardPrize()).
  //
  // Winners are every user at rank 1 for that gameweek — possibly more than one,
  // by design, since Slice 6's tie-break rule is "ties share a rank," not a forced
  // single winner. Splitting a prize among multiple winners is awardPrize()'s job.
  //
  // Deliberately does not read pot_prizes at all — "who ranked first" and
  // "is there a prize configured to award them" are different questions;
  // conflating them here would make this method's correctness depend on prize
  // configuration existing, which it doesn't yet (see session-log.md — no
  // admin flow creates a pot_prizes row anywhere in the current codebase).
  async determineWinner(ctx: GameEngineContext, potId: string): Promise<string[]> {
    const gameweekId = await this.getMostRecentGameweekWithStandings(ctx, potId)
    if (gameweekId === null) {
      return []
    }

    const { data: winners, error: winnersError } = await ctx.supabase
      .from('pot_standings_snapshots')
      .select('user_id')
      .eq('pot_id', potId)
      .eq('gameweek_id', gameweekId)
      .eq('rank', 1)

    if (winnersError) {
      throw new Error(`Failed to look up winners: ${winnersError.message}`)
    }

    return ((winners ?? []) as { user_id: string }[]).map((w) => w.user_id)
  }

  // Extracted from determineWinner() when awardPrize() (Slice 8) needed the
  // identical "which gameweek" derivation — both methods only receive a
  // potId (GE-6's fixed contract), so both independently need to identify
  // the gameweek their caller (settle()) just processed.
  private async getMostRecentGameweekWithStandings(ctx: GameEngineContext, potId: string): Promise<number | null> {
    const { data: latestGameweek, error: latestError } = await ctx.supabase
      .from('pot_standings_snapshots')
      .select('gameweek_id')
      .eq('pot_id', potId)
      .not('gameweek_id', 'is', null)
      .order('gameweek_id', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latestError) {
      throw new Error(`Failed to look up the most recent settled gameweek: ${latestError.message}`)
    }

    return latestGameweek ? (latestGameweek as { gameweek_id: number }).gameweek_id : null
  }

  // GE-6: "Split net prize pool equally." Money-critical — every branch here
  // was an explicit decision, not an inferred default (docs/decisions.md §
  // Prize pool deductions):
  //   - pot_prizes row created lazily, here, at award time (not pre-created
  //     anywhere else — docs/decisions.md § pot_prizes row creation is lazy).
  //   - gross = entry_fee x count(this instance's verified-paid, settled
  //     entries) — read directly from settle()'s already-finalized state,
  //     never tracked separately, so settlement stays the single source of
  //     truth.
  //   - fees are the CALCULATED euro amounts for this instance, derived from
  //     the pot's config at this moment — never the config itself (GE-4.1
  //     vs GE-4.4).
  //   - net = gross - adminFee - charityFee; only net is ever distributed,
  //     never gross.
  //   - zero eligible winners: fails loudly (Pick5NoEligibleWinnersError),
  //     never silently skips or invents a default.
  //   - fees exceeding gross (net would be negative): fails loudly
  //     (Pick5PrizePoolExceededError) rather than clamping — the DB's own
  //     `net_amount >= 0` CHECK constraint is the backstop if this method's
  //     own pre-check is ever bypassed.
  //   - an uneven split across tied winners rounds DOWN per winner; the
  //     leftover remainder (at most winnerCount - 1 cents) is never paid to
  //     anyone.
  //   - idempotent: a gameweek whose pot_prizes row is already `is_settled`
  //     is left untouched and this method returns without re-awarding.
  //
  // Hardening sprint, 2026-08-06 (architecture review finding): the
  // pot_prizes write is deliberately the LAST write in this method, not
  // the first — mirrors the identical correction already applied to
  // LmsEngine.awardPrize(). is_settled=true is the exact flag this
  // method's own idempotency check, above, trusts as "this gameweek has
  // already been awarded." Writing it only once every payout has already
  // succeeded means a payout failing partway through (winner 2 of 3, say)
  // leaves the gameweek safely retryable — a retry re-derives the same
  // winners/amounts and simply re-applies the same payout_amount values
  // (harmless; UPDATEs are naturally idempotent), rather than getting
  // permanently stuck: with the old ordering, is_settled was already true
  // by the time any payout could fail, so every future call would
  // short-circuit before ever reaching the unpaid winner. See
  // docs/decisions.md § LMS prize awarding: transactionality correction
  // for the original investigation this reuses.
  async awardPrize(ctx: GameEngineContext, potId: string): Promise<void> {
    const gameweekId = await this.getMostRecentGameweekWithStandings(ctx, potId)
    if (gameweekId === null) {
      return
    }

    const { data: existingPrize, error: existingPrizeError } = await ctx.supabase
      .from('pot_prizes')
      .select('id, is_settled')
      .eq('pot_id', potId)
      .eq('gameweek_id', gameweekId)
      .maybeSingle()

    if (existingPrizeError) {
      throw new Error(`Failed to look up existing prize: ${existingPrizeError.message}`)
    }
    if ((existingPrize as { id: string; is_settled: boolean } | null)?.is_settled) {
      return
    }

    const winners = await this.determineWinner(ctx, potId)
    if (winners.length === 0) {
      throw new Pick5NoEligibleWinnersError(potId, gameweekId)
    }

    const { data: pot, error: potError } = await ctx.supabase
      .from('pots')
      .select('entry_fee, admin_fee_type, admin_fee_amount, admin_fee_percentage, charity_fee_type, charity_fee_amount, charity_fee_percentage')
      .eq('id', potId)
      .single()

    if (potError) {
      throw new Error(`Failed to look up pot fee configuration: ${potError.message}`)
    }

    const { data: settledEntries, error: settledEntriesError } = await ctx.supabase
      .from('game_entries')
      .select('id')
      .eq('pot_id', potId)
      .eq('gameweek_id', gameweekId)
      .eq('status', 'settled')

    if (settledEntriesError) {
      throw new Error(`Failed to count settled entries: ${settledEntriesError.message}`)
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

    const grossAmount = roundToCents(potConfig.entry_fee * (settledEntries?.length ?? 0))
    const adminFeeAmount = calculateFeeAmount(potConfig.admin_fee_type, potConfig.admin_fee_amount, potConfig.admin_fee_percentage, grossAmount)
    const charityFeeAmount = calculateFeeAmount(potConfig.charity_fee_type, potConfig.charity_fee_amount, potConfig.charity_fee_percentage, grossAmount)
    const netAmount = roundToCents(grossAmount - adminFeeAmount - charityFeeAmount)

    if (netAmount < 0) {
      throw new Pick5PrizePoolExceededError(potId, gameweekId, grossAmount, adminFeeAmount, charityFeeAmount)
    }

    const perWinnerAmount = floorToCents(netAmount / winners.length)

    for (const userId of winners) {
      const { error: payoutError } = await ctx.supabase
        .from('game_entries')
        .update({ payout_amount: perWinnerAmount })
        .eq('pot_id', potId)
        .eq('gameweek_id', gameweekId)
        .eq('user_id', userId)

      if (payoutError) {
        throw new Error(`Failed to write payout for user ${userId}: ${payoutError.message}`)
      }
    }

    // Written LAST, deliberately — see this method's own comment above for
    // why. is_settled=true here is what makes every future call treat this
    // gameweek as concluded, so nothing above this line may be allowed to
    // run again "for free" after it — the payout loop above is a naturally
    // idempotent UPDATE, safe to repeat on a retry.
    const prizeRow = {
      pot_id: potId,
      scope: 'gameweek' as const,
      gameweek_id: gameweekId,
      gross_amount: grossAmount,
      admin_fee_amount: adminFeeAmount,
      charity_fee_amount: charityFeeAmount,
      is_settled: true,
      settled_at: ctx.now().toISOString(),
    }

    // Two-step get-or-create-then-write by real PK, same pattern established
    // in generateStandings()'s upsertStandingsGroup() — pot_prizes has the
    // identical shape of partial unique indexes that made a direct
    // upsert(onConflict: 'pot_id,gameweek_id') fail live in Slice 6.
    //
    // Hardening sprint, 2026-08-06: these used to throw
    // Pick5PrizePoolExceededError on ANY update/insert failure, not just
    // the fee-exceeds-gross case that error class actually describes — a
    // real bug (found while reviewing this exact write path for the
    // reorder above), since a caller catching that specific error to mean
    // "the pot's fee configuration needs fixing" would misdiagnose a
    // transient database/network failure the same way. Now throws a
    // generic Error for a write failure, matching LmsEngine.awardPrize()'s
    // own pattern — Pick5PrizePoolExceededError is reserved for its one
    // actual meaning: the netAmount < 0 pre-check above.
    if (existingPrize) {
      const { error: updateError } = await ctx.supabase
        .from('pot_prizes')
        .update(prizeRow)
        .eq('id', (existingPrize as { id: string }).id)

      if (updateError) {
        throw new Error(`Failed to update prize: ${updateError.message}`)
      }
    } else {
      const { error: insertError } = await ctx.supabase.from('pot_prizes').insert(prizeRow)

      if (insertError) {
        throw new Error(`Failed to insert prize: ${insertError.message}`)
      }
    }

    // GE-8.7/decisions.md § Notifications: called after the trailing
    // pot_prizes write above, not from inside the payout loop the way this
    // method used to (hardening sprint, 2026-08-06 — moved for the same
    // reason the write itself moved: keeps the invariant that a
    // notification only ever fires once both the money AND the settlement
    // record it describes are already durably written, matching
    // LmsEngine.awardPrize()'s own Slice-9 placement). Best-effort — a
    // failure here must never unwind or block a payout already written,
    // and must never stop the loop from notifying this gameweek's
    // remaining winners, so it's caught and logged rather than left to
    // propagate like every other write in this method. notifyUsers()
    // itself still throws on error (like every other GameEngine method) —
    // the try/catch boundary belongs here, at the one call site that knows
    // this specific write is allowed to fail silently, not inside
    // notifyUsers() itself.
    for (const userId of winners) {
      try {
        await this.notifyUsers(ctx, {
          userId,
          potId,
          type: 'pick5.prize_awarded' satisfies Pick5NotificationType,
          payload: { gameweekId, amount: perWinnerAmount },
        })
      } catch (notifyError) {
        console.error(
          `notifyUsers failed for pot ${potId}, gameweek ${gameweekId}, user ${userId} (prize already awarded, not affected): ` +
            (notifyError instanceof Error ? notifyError.message : String(notifyError))
        )
      }
    }
  }

  // GE-6: "Write to notifications." A pure domain-event emitter — inserts
  // one row and returns. Deliberately does not know about, or call, any
  // delivery channel (email/push/SMS); see docs/decisions.md § Notifications
  // for why that split is the recommended design, not just the current gap.
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
