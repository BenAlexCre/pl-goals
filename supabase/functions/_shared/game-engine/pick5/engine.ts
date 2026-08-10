// Pick5Engine — the first real GameEngine implementation (GE-6). Landed
// incrementally, one method per Milestone 4 slice (docs/game-engine.md §
// GE-12): validateEntry (Slice 2), lockEntries (Slice 3), calculateScore
// (Slice 4), settle (Slice 5), generateStandings (Slice 6), determineWinner
// and awardPrize (Slice 8, wired together — see settle()), notifyUsers
// (Slice 9, called from within awardPrize() — see that method's comment).
// All eight GameEngine contract methods are now implemented.

import type { GameEngine, GameEngineContext } from '../contracts.ts'
import type { GameEntry, NotificationEvent, StandingsRow } from '../types.ts'
import { resolveNextSeasonLeague, resolveSeasonGameweekBounds } from '../season-resolution.ts'
import { Pick5PrizePoolExceededError, Pick5ValidationError } from './errors.ts'

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
  // Reads public.player_fixture_goals, same as the retired prototype did.
  // ISSUE-3 (confirmed live during the Sprint 2 audit — the view was never
  // automatically refreshed, so this always read zero goals) is fixed at
  // the call site: compute-scores/index.ts now refreshes the view once per
  // run, before calling this method for any mode.
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
  // is the only way it's invoked.
  //
  // Product rule revision, 2026-08-09 (docs/decisions.md § Pick 5 jackpot and
  // season rollover — approved "Design A"): a Pick 5 entry only wins with
  // EXACTLY 5/5, never merely the best score of the week. Changed from
  // `.eq('rank', 1)` to `.eq('score', PICK5_PICK_COUNT)` — the smallest
  // possible change, since pot_standings_snapshots.score for a Pick 5
  // gameweek row already IS picks_won (generateStandings() writes it
  // directly from that value, unchanged by this revision). Rank and "5/5"
  // are now genuinely different concepts: the leaderboard's rank 1 can be a
  // 3/5 week with no winner at all — generateStandings()'s own ranking is
  // deliberately left untouched, since "who did best this week" is still a
  // meaningful thing to show even when nobody won the jackpot. Multiple
  // simultaneous 5/5s remain legitimate joint winners, exactly as multiple
  // rank-1 ties were before — splitting the prize among them is still
  // awardPrize()'s job, unchanged.
  //
  // Deliberately does not read pot_prizes at all — "who hit 5/5" and
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
      .eq('score', PICK5_PICK_COUNT)

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

  // Product rule revision, 2026-08-09 (docs/decisions.md § Pick 5 jackpot
  // and season rollover). Finds the most recent pot_prizes row for this pot
  // that concluded before the given gameweek — the jackpot's own carry
  // history. Naturally skips gaps (a gameweek with zero entries never gets
  // a pot_prizes row at all — settle()'s own per-pot loop only ever
  // processes pots with at least one entry that gameweek), since this
  // looks for "the most recent EXISTING row before this one," not "the row
  // for gameweekId - 1" specifically. Fetches every row and filters/finds
  // in TypeScript rather than a server-side "less than" filter — the same
  // "fetch, then compare in code" style already used elsewhere in this
  // file (rankWithTies(), upsertStandingsGroup()), since this table's
  // per-pot row count is always small (at most one per gameweek in a
  // season).
  private async getMostRecentPriorPrizeRow(
    ctx: GameEngineContext,
    potId: string,
    currentGameweekId: number
  ): Promise<{ gross_amount: number; admin_fee_amount: number; charity_fee_amount: number; rollover: boolean } | null> {
    const { data: rows, error } = await ctx.supabase
      .from('pot_prizes')
      .select('gameweek_id, gross_amount, admin_fee_amount, charity_fee_amount, rollover')
      .eq('pot_id', potId)
      .eq('scope', 'gameweek')
      .order('gameweek_id', { ascending: false })

    if (error) {
      throw new Error(`Failed to look up prior prize history: ${error.message}`)
    }

    type PriorRow = { gameweek_id: number; gross_amount: number; admin_fee_amount: number; charity_fee_amount: number; rollover: boolean }
    const previous = ((rows ?? []) as PriorRow[]).find((r) => r.gameweek_id !== currentGameweekId)
    return previous ?? null
  }

  // Whether gameweekId is the last (highest-numbered) gameweek in the pot's
  // own league/season — the automatic trigger for rule 2's season-end
  // rollover. Pick 5 deliberately never exposes end_gameweek_id as
  // organiser-configurable (unlike LMS/Predictor — docs/decisions.md §
  // Pick 5 jackpot and season rollover: "do not expose end_gameweek_id for
  // Pick 5"); this method always recomputes the season's real final
  // gameweek live rather than trusting any stored column, including on a
  // rollover pot, whose own end_gameweek_id (corrections pass, 2026-08-10)
  // is populated automatically for the organiser's information only, never
  // read back by this method. Ordered by number, not
  // gameweek_id — number is the actual authoritative season-week-index;
  // id ordering (used elsewhere in this file, e.g.
  // getMostRecentGameweekWithStandings()) only coincides with it as an
  // implementation detail of how gameweeks happen to be inserted.
  private async isFinalGameweekOfSeason(
    ctx: GameEngineContext,
    leagueId: number,
    seasonId: number,
    gameweekId: number
  ): Promise<boolean> {
    const { data: lastGameweek, error } = await ctx.supabase
      .from('gameweeks')
      .select('id')
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .order('number', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      throw new Error(`Failed to look up the season's final gameweek: ${error.message}`)
    }

    return (lastGameweek as { id: number } | null)?.id === gameweekId
  }

  // Mirrors LmsEngine.createRolloverPot() as closely as GE-18's mode
  // isolation allows (per the repo owner's explicit "reuse the LMS
  // rollover lifecycle wherever practical... do not invent a second
  // lifecycle" instruction) — private to this engine, not a shared/
  // imported helper, same as every other mode-specific duplicate in this
  // codebase. Same idempotency guard (an existing rollover_source_pot_id
  // match short-circuits before creating a duplicate on retry), same
  // "draft, never auto-activated" status — the organiser reviews and
  // activates it later, identical to LMS's own lifecycle — same
  // "(Rollover #N)" name derivation. `resolveNextSeasonLeague()` is shared
  // with `LmsEngine` (`../season-resolution.ts`) — no mode-specific
  // variation exists in "find next season's matching league," so GE-18's
  // duplicate-small-logic convention doesn't apply here.
  //
  // Corrections pass, 2026-08-10 (docs/decisions.md § Pick 5 jackpot and
  // season rollover): the rollover pot must be created with its
  // `start_gameweek_id`/`end_gameweek_id` already resolved to the next
  // season's first/final gameweek — never left null. This is unambiguous
  // for Pick 5 specifically (rule 3: no organiser-configurable cutoff,
  // always the whole season) in a way it is NOT for LMS (see
  // `LmsEngine.createRolloverPot()`'s own comment for why LMS's
  // `end_gameweek_id` is deliberately NOT resolved the same way).
  // `end_gameweek_id` being populated here is informational only —
  // `awardPrize()`/`isFinalGameweekOfSeason()` still always recompute the
  // season's final gameweek live rather than trusting a stored column,
  // unchanged by this correction.
  private async createPick5RolloverPot(
    ctx: GameEngineContext,
    sourcePotId: string,
    sourcePot: {
      name: string
      created_by: string
      league_id: number
      entry_fee: number
      admin_fee_type: 'none' | 'fixed' | 'percentage'
      admin_fee_amount: number | null
      admin_fee_percentage: number | null
      charity_fee_type: 'none' | 'fixed' | 'percentage'
      charity_fee_amount: number | null
      charity_fee_percentage: number | null
      rollover_generation: number
    },
    carryOverAmount: number
  ): Promise<void> {
    const { data: existingRolloverPot, error: existingRolloverError } = await ctx.supabase
      .from('pots')
      .select('id')
      .eq('rollover_source_pot_id', sourcePotId)
      .maybeSingle()

    if (existingRolloverError) {
      throw new Error(`Failed to check for an existing rollover pot: ${existingRolloverError.message}`)
    }
    if (existingRolloverPot) {
      return // a prior, since-failed awardPrize() attempt already created this — do not create a second one
    }

    const nextLeague = await resolveNextSeasonLeague(ctx, sourcePot.league_id)
    if (!nextLeague) {
      throw new Error(
        `Cannot create a Pick 5 rollover pot for ${sourcePotId}: no next-season league found yet for league ${sourcePot.league_id}. ` +
          `Retry once next season's league data has been synced.`
      )
    }

    const bounds = await resolveSeasonGameweekBounds(ctx, nextLeague.id, nextLeague.season_id)
    if (!bounds) {
      throw new Error(
        `Cannot create a Pick 5 rollover pot for ${sourcePotId}: next season's league ${nextLeague.id} has no gameweeks synced yet. ` +
          `Retry once its fixture calendar has been synced.`
      )
    }

    const baseName = sourcePot.name.replace(/\s*\(Rollover #\d+\)\s*$/, '')
    const newGeneration = sourcePot.rollover_generation + 1
    const newName = `${baseName} (Rollover #${newGeneration})`

    const { data: newPot, error: potInsertError } = await ctx.supabase
      .from('pots')
      .insert({
        name: newName,
        season_id: nextLeague.season_id,
        league_id: nextLeague.id,
        created_by: sourcePot.created_by,
        game_type: 'pick5',
        status: 'draft',
        entry_fee: sourcePot.entry_fee,
        admin_fee_type: sourcePot.admin_fee_type,
        admin_fee_amount: sourcePot.admin_fee_amount,
        admin_fee_percentage: sourcePot.admin_fee_percentage,
        charity_fee_type: sourcePot.charity_fee_type,
        charity_fee_amount: sourcePot.charity_fee_amount,
        charity_fee_percentage: sourcePot.charity_fee_percentage,
        rollover_source_pot_id: sourcePotId,
        carry_over_amount: carryOverAmount,
        rollover_generation: newGeneration,
        start_gameweek_id: bounds.firstGameweekId,
        end_gameweek_id: bounds.finalGameweekId,
      })
      .select('id')
      .single()

    if (potInsertError) {
      throw new Error(`Failed to create Pick 5 rollover pot: ${potInsertError.message}`)
    }

    // Bug found during Phase 7 Stage 2 Slice 4's frontend integration
    // (organiser rollover-management UI): unlike LmsEngine.createRolloverPot(),
    // this method never added the organiser as a pot_members row on the new
    // pot — `created_by` alone satisfies the pots-table RLS SELECT policies,
    // but every pot_members-based query (usePotsForAdmin's admin-pot list,
    // admin-actions' own pot-admin authorization gate for any future action
    // against this pot) requires an actual row and would silently never
    // find this pot at all. Fixed to match LMS's existing pattern exactly,
    // including the same compensating rollback (no cross-table transaction
    // available) if the membership insert fails.
    const { error: memberError } = await ctx.supabase.from('pot_members').insert({
      pot_id: newPot.id,
      user_id: sourcePot.created_by,
      role: 'admin',
    })

    if (memberError) {
      await ctx.supabase.from('pots').delete().eq('id', newPot.id)
      throw new Error(`Failed to add organiser to rollover pot: ${memberError.message}`)
    }
  }

  // GE-6: "Split net prize pool equally." Money-critical — every branch here
  // was an explicit decision, not an inferred default (docs/decisions.md §
  // Prize pool deductions and, since 2026-08-09, § Pick 5 jackpot and season
  // rollover — "Design A", approved by the repo owner):
  //   - pot_prizes row created lazily, here, at award time (not pre-created
  //     anywhere else — docs/decisions.md § pot_prizes row creation is lazy).
  //   - weekGross = entry_fee x count(this instance's verified-paid, settled
  //     entries) — read directly from settle()'s already-finalized state,
  //     never tracked separately, so settlement stays the single source of
  //     truth. This is only THIS gameweek's own fresh contribution — see
  //     carryIn below for the accumulated jackpot.
  //   - fees are the CALCULATED euro amounts for THIS gameweek's weekGross
  //     only, derived from the pot's config at this moment — never the
  //     config itself (GE-4.1 vs GE-4.4), and never re-applied to a
  //     carried-forward balance (see the carryIn comment below for why).
  //   - weekNet = weekGross - adminFee - charityFee.
  //   - zero winners (nobody hit exactly 5/5): the normal, common case
  //     now, not an error — the jackpot (weekNet + any carry-in) rolls
  //     forward into the next gameweek, or into a new season's rollover
  //     pot if this was the season's own final gameweek. Matches
  //     LmsEngine/PredictorEngine's own "not concluded yet" philosophy,
  //     not this method's own pre-2026-08-09 "should be impossible" one.
  //   - fees exceeding weekGross (weekNet would be negative): fails loudly
  //     (Pick5PrizePoolExceededError) rather than clamping — the DB's own
  //     `net_amount >= 0` CHECK constraint is the backstop if this method's
  //     own pre-check is ever bypassed.
  //   - an uneven split across tied winners rounds DOWN per winner; the
  //     leftover remainder (at most winnerCount - 1 cents) is never paid to
  //     anyone.
  //   - idempotent: a gameweek whose pot_prizes row is already `is_settled`
  //     is left untouched and this method returns without re-processing.
  //
  // Hardening sprint, 2026-08-06 (architecture review finding, still
  // honored here): the pot_prizes write is deliberately the LAST write in
  // this method, in BOTH the winner and no-winner branches — mirrors the
  // identical correction already applied to LmsEngine.awardPrize().
  // is_settled=true is the exact flag this method's own idempotency check,
  // above, trusts as "this gameweek has already been processed." Writing
  // it only once every payout (or rollover-pot creation) has already
  // succeeded means a partial failure leaves the gameweek safely
  // retryable — a retry re-derives the identical winners/carryIn/amounts
  // and simply re-applies them (harmless; every write here is naturally
  // idempotent), rather than getting permanently stuck. See
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

    const { data: pot, error: potError } = await ctx.supabase
      .from('pots')
      .select('name, created_by, league_id, season_id, entry_fee, admin_fee_type, admin_fee_amount, admin_fee_percentage, charity_fee_type, charity_fee_amount, charity_fee_percentage, carry_over_amount, rollover_generation')
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

    type PotConfig = {
      name: string
      created_by: string
      league_id: number
      season_id: number
      entry_fee: number
      admin_fee_type: 'none' | 'fixed' | 'percentage'
      admin_fee_amount: number | null
      admin_fee_percentage: number | null
      charity_fee_type: 'none' | 'fixed' | 'percentage'
      charity_fee_amount: number | null
      charity_fee_percentage: number | null
      carry_over_amount: number
      rollover_generation: number
    }
    const potConfig = pot as PotConfig

    // Deliberately named "week*", not "gross"/"net" — these describe ONLY
    // this gameweek's own fresh entry fees, never re-taxed against a
    // carried-forward balance. This is a deliberate divergence from
    // LmsEngine.awardPrize()'s own carry_over_amount handling (which folds
    // its one-time carry-in into the SAME figure fees are calculated
    // against, since an LMS rollover pot only ever concludes once): the
    // approved Pick 5 design is explicit — "the full net jackpot
    // carries... the next week's entry fees are added on top" — the carry
    // is already net and stays that way. Reusing LMS's approach here would
    // mean the same rolling balance gets fee-deducted again on every
    // consecutive no-winner week, quietly eroding it, which the approved
    // wording doesn't support.
    const weekGross = roundToCents(potConfig.entry_fee * (settledEntries?.length ?? 0))
    const weekAdminFee = calculateFeeAmount(potConfig.admin_fee_type, potConfig.admin_fee_amount, potConfig.admin_fee_percentage, weekGross)
    const weekCharityFee = calculateFeeAmount(potConfig.charity_fee_type, potConfig.charity_fee_amount, potConfig.charity_fee_percentage, weekGross)
    const weekNet = roundToCents(weekGross - weekAdminFee - weekCharityFee)

    if (weekNet < 0) {
      throw new Pick5PrizePoolExceededError(potId, gameweekId, weekGross, weekAdminFee, weekCharityFee)
    }

    // carryIn: the immediately preceding gameweek's unclaimed net_amount
    // (0 if that gameweek had a winner, or none exists), OR — only for
    // this pot's very first-ever settled gameweek, when no prior
    // pot_prizes row exists at all — pots.carry_over_amount, the one-time
    // balance a rollover pot was created with (mirrors
    // LmsEngine.awardPrize()'s own "added once, at the start" reading of
    // that column). Every later gameweek finds a real prior row and never
    // re-reads carry_over_amount again.
    const priorRow = await this.getMostRecentPriorPrizeRow(ctx, potId, gameweekId)
    const carryIn = priorRow
      ? priorRow.rollover
        ? roundToCents(priorRow.gross_amount - priorRow.admin_fee_amount - priorRow.charity_fee_amount)
        : 0
      : potConfig.carry_over_amount

    const totalAvailable = roundToCents(carryIn + weekNet)
    // Stores the FULL pool this gameweek's decision was made against
    // (carry-in + this week's fresh gross), not just the fresh portion —
    // so that net_amount (the generated gross - admin_fee - charity_fee
    // column) equals totalAvailable exactly, with no separate
    // carry-tracking column needed anywhere. admin/charity fee amounts
    // stored below are still only ever this week's own calculated values.
    const prizeGrossAmount = roundToCents(carryIn + weekGross)

    if (winners.length === 0) {
      // No 5/5 this week — the normal, common case now. The jackpot
      // carries forward: this row is marked rollover=true (the same
      // column/meaning 013_lms_wipeout_and_rollover.sql already
      // established for LMS's own wipeout-with-no-winner case) so the
      // NEXT gameweek's own awardPrize() call finds it and adds its
      // net_amount back in as carryIn, above.
      const isFinal = await this.isFinalGameweekOfSeason(ctx, potConfig.league_id, potConfig.season_id, gameweekId)

      if (isFinal) {
        // Rule 2: the season ends with nobody at 5/5 — automatically
        // create next season's rollover pot (draft, never auto-activated;
        // the organiser reviews and activates it later, identical to
        // LMS's own lifecycle — "do not invent a second lifecycle").
        // Runs BEFORE the trailing pot_prizes write below, same
        // write-ordering discipline as the payout loop in the winner
        // branch: a retry after a failure here re-derives the identical
        // winners/carryIn/isFinal, and createPick5RolloverPot()'s own
        // idempotency guard (checked by rollover_source_pot_id) prevents
        // a duplicate pot either way.
        await this.createPick5RolloverPot(
          ctx,
          potId,
          {
            name: potConfig.name,
            created_by: potConfig.created_by,
            league_id: potConfig.league_id,
            entry_fee: potConfig.entry_fee,
            admin_fee_type: potConfig.admin_fee_type,
            admin_fee_amount: potConfig.admin_fee_amount,
            admin_fee_percentage: potConfig.admin_fee_percentage,
            charity_fee_type: potConfig.charity_fee_type,
            charity_fee_amount: potConfig.charity_fee_amount,
            charity_fee_percentage: potConfig.charity_fee_percentage,
            rollover_generation: potConfig.rollover_generation,
          },
          totalAvailable
        )
      }
    }

    const perWinnerAmount = winners.length > 0 ? floorToCents(totalAvailable / winners.length) : 0

    if (winners.length > 0) {
      // Award the ENTIRE accumulated jackpot (this week's fresh net plus
      // every prior unclaimed week's carry), then reset — the next
      // gameweek's own carryIn lookup will find this row's rollover=false
      // (the default, set explicitly below) and correctly start fresh.
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
    }

    // Written LAST, deliberately, in both branches — see this method's own
    // comment above for why.
    const prizeRow = {
      pot_id: potId,
      scope: 'gameweek' as const,
      gameweek_id: gameweekId,
      gross_amount: prizeGrossAmount,
      admin_fee_amount: weekAdminFee,
      charity_fee_amount: weekCharityFee,
      is_settled: true,
      settled_at: ctx.now().toISOString(),
      rollover: winners.length === 0,
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
    // actual meaning: the weekNet < 0 pre-check above.
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

    if (winners.length === 0) {
      return
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
    // notifyUsers() itself. No no-winner notification event exists — like
    // LMS's own rollover, considered and deliberately not built
    // speculatively (docs/decisions.md § Pick 5 jackpot and season
    // rollover); a future addition if actually asked for.
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
