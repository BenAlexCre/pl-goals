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
