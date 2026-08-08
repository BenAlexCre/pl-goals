// Milestone 5 (docs/game-engine.md § GE-5.2, GE-12): validateEntry (Slice 2),
// lockEntries (Slice 3), calculateScore (Slice 4), settle (Slice 5),
// generateStandings (Slice 6), determineWinner (Slice 7), awardPrize
// (Slice 8), and notifyUsers (Slice 9, called from within awardPrize() —
// see that method's comment) are implemented. All eight GameEngine contract
// methods are now implemented.
//
// lockEntries() deliberately does NOT touch game_entries.status, unlike
// Pick5Engine's version. game_entries is season-scoped for LMS (GE-4.5) —
// one row for the whole competition — so locking the parent entry at a
// single gameweek's deadline would make it impossible to ever submit a
// pick for the *next* gameweek. What actually needs to become immutable at
// a deadline is this specific gameweek's pick (lms_team_picks.locked_at),
// not the season-long entry. See docs/decisions.md § LMS locking.
//
// calculateScore() also diverges from Pick5Engine's split of responsibility:
// Pick 5 keeps calculateScore() purely about resolving pick outcomes and
// defers every consequential status change (voiding, settling) to settle().
// LMS's calculateScore() eliminates entries directly, per the repo owner's
// explicit 2026-08-05 decision ("the player is immediately eliminated...
// no grace period"). This is safe precisely because elimination only ever
// depends on ONE fixture (the picked team's own) being finished, not on
// the whole gameweek being finished the way Pick 5's settle() waits for
// (GE-8.4) — so there's no need to defer it to a later slice. See
// docs/decisions.md § LMS scoring and elimination.
//
// settle() therefore starts with much less to do than Pick5Engine's
// version — the payment-void check only (genuinely settlement's job,
// untouched by calculateScore()) — but as of Slice 8 it DOES call
// generateStandings() and awardPrize() per eligible pot, same as
// Pick5Engine.settle() does, once both those methods existed to call.
// game_entries.status still never becomes 'settled' *inside* settle()
// itself, though — that transition happens inside awardPrize(), only once
// a real outcome (not "still in progress") is reached, per Slice 5's own
// reasoning that 'settled' only makes sense once the competition has
// actually concluded.
//
// generateStandings() (Slice 6) and awardPrize() (Slice 8) are both called
// unconditionally, every gameweek, from settle() — unlike Pick 5, most of
// those calls correctly do nothing (competition still in progress) and
// return silently; see docs/decisions.md § LMS standings and § LMS prize
// awarding for the full reasoning behind each, including why the standings
// *shape* itself is not modeled on Pick 5's at all (no points exist for
// LMS; ranking is alive-tied-at-1 then eliminated-by-recency, not a score
// comparison).

import type { GameEngine, GameEngineContext } from '../contracts.ts'
import type { GameEntry, NotificationEvent, StandingsRow } from '../types.ts'
import { LmsFinalPredictionNotImplementedError, LmsPrizePoolExceededError, LmsValidationError } from './errors.ts'

export interface LmsPickInput {
  gameweekId: number
  teamId: number
}

// GE-4.8: notifications.type is free text at the schema level — same
// per-mode catalog approach Pick5NotificationType established. Only one
// event exists for LMS so far, mirroring Pick 5's own single
// 'pick5.prize_awarded': a real payout, for every actual recipient
// (single_survivor, wipeout split_prize, season_end split_prize). A
// rollover event (wipeout roll_prize — nobody is paid, a new pot is
// created instead) was considered and deliberately NOT added this slice:
// it has no Pick 5 equivalent to model, and the organiser already becomes
// the new pot's sole member programmatically (Slice 8) — a genuine
// candidate for a future notification, not built ahead of being asked
// for, same "flag, don't guess" discipline this milestone has used
// throughout (Final Prediction, pot activation).
export type LmsNotificationType = 'lms.prize_awarded'

// Shared between determineWinner() and awardPrize() — see classifyOutcome()
// below for why a plain string[] isn't rich enough for awardPrize() to use
// directly.
type LmsOutcome =
  | { type: 'in_progress' }
  | { type: 'single_survivor'; winnerId: string }
  | { type: 'wipeout'; gameweekId: number; memberIds: string[] }
  | { type: 'season_end'; aliveIds: string[] }

// Money helpers — same rounding rules as Pick5Engine's own (docs/decisions.md
// § Prize pool deductions): roundToCents (standard round-half-up) for the
// gross/fee/net calculation itself; floorToCents (always down) when
// splitting the net pool across multiple recipients, so no tied recipient
// is ever favored by rounding. Genuinely shared-platform money math, not
// LMS-specific — reimplemented privately here rather than imported from
// pick5/engine.ts (GE-18 forbids cross-mode imports), same acknowledged-
// duplication category as the pot_standings_snapshots upsert workaround
// (see generateStandings()'s own comment) — a future extraction into a
// shared _shared/game-engine/ helper would cover both.
function roundToCents(amount: number): number {
  return Math.round(amount * 100) / 100
}

function floorToCents(amount: number): number {
  return Math.floor(amount * 100) / 100
}

function calculateLmsFeeAmount(
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

  // Private, LMS-only — same "internal reuse, not cross-mode duplication"
  // reasoning Pick5Engine's own private helpers use (GE-3/GE-18). LMS pots
  // whose competition hasn't reached gameweekId yet (a draft rollover pot
  // with a future start_gameweek_id, for instance) must never have their
  // entries touched by a gameweek they haven't started.
  //
  // Milestone 5 Slice 8: also excludes any pot whose competition has
  // already concluded (a settled, scope='season' pot_prizes row exists) —
  // this is what closes the Slice 7 sequencing gap. Before this, nothing
  // stopped calculateScore() from continuing to process a pot after its
  // sole survivor had effectively already won, since it had no awareness
  // of "has awardPrize() already run for this pot." Reusing
  // pot_prizes.is_settled (the same signal awardPrize() itself uses for
  // its own idempotency, below) rather than inventing a second "is this
  // pot done" flag — one source of truth for "has this competition
  // concluded," read by calculateScore(), settle(), and awardPrize() alike.
  private async getEligibleLmsPotIds(ctx: GameEngineContext, gameweekId: number): Promise<string[]> {
    const { data: pots, error } = await ctx.supabase
      .from('pots')
      .select('id')
      .eq('game_type', 'last_man_standing')
      .lte('start_gameweek_id', gameweekId)

    if (error) {
      throw new Error(`Failed to look up LMS pots: ${error.message}`)
    }

    const candidateIds = (pots ?? []).map((p: { id: string }) => p.id)
    if (candidateIds.length === 0) {
      return []
    }

    const { data: concludedPrizes, error: concludedError } = await ctx.supabase
      .from('pot_prizes')
      .select('pot_id')
      .eq('scope', 'season')
      .eq('is_settled', true)
      .in('pot_id', candidateIds)

    if (concludedError) {
      throw new Error(`Failed to look up concluded pots: ${concludedError.message}`)
    }

    const concludedPotIds = new Set((concludedPrizes ?? []).map((p: { pot_id: string }) => p.pot_id))
    return candidateIds.filter((id) => !concludedPotIds.has(id))
  }

  // GE-6: "Resolve picks against real fixture data." Two things happen for
  // gameweekId, both gated on its deadline having passed (no consequential
  // action before then — mirrors validateEntry()'s live deadline check):
  //
  //   1. Every existing pick is resolved against its team's own fixture.
  //      While that fixture is still live, the result is an interim label
  //      only ('winning'/'losing', same non-consequential pattern Pick 5
  //      uses) — no elimination yet, since a live scoreline can still
  //      change. Once the fixture is finished, the result is final
  //      ('won', or 'lost' for both an actual loss and a draw — pick_result
  //      has no separate "drew" value, and a draw eliminates identically to
  //      a loss per the repo owner's rule, so reusing 'lost' is accurate
  //      for the one thing that value is ever checked for) and, if not
  //      'won', the entry is eliminated.
  //   2. Every ALIVE entry in an eligible LMS pot with NO pick row at all
  //      for gameweekId is eliminated too — "missing a pick is treated
  //      exactly the same as selecting a team that does not win... no
  //      grace period... no automatic pick" (repo owner, 2026-08-05). No
  //      placeholder pick is ever created for these entries.
  async calculateScore(ctx: GameEngineContext, gameweekId: number): Promise<void> {
    const { data: gameweek, error: gameweekError } = await ctx.supabase
      .from('gameweeks')
      .select('deadline_utc')
      .eq('id', gameweekId)
      .maybeSingle()

    if (gameweekError) {
      throw new Error(`Failed to look up gameweek deadline: ${gameweekError.message}`)
    }
    if (!gameweek?.deadline_utc || ctx.now() < new Date(gameweek.deadline_utc)) {
      return
    }

    const potIds = await this.getEligibleLmsPotIds(ctx, gameweekId)
    if (potIds.length === 0) {
      return
    }

    // Cross-slice correction, 2026-08-08 (post-Slice-5 review, see
    // docs/decisions.md § calculateScore() must not mutate a voided entry):
    // status = 'pending' excludes a voided entry from this method entirely,
    // regardless of its own, possibly-stale game_entry_lms.competitive_status
    // (settle() never touches that column when it voids an entry). Without
    // this filter, a voided entry stayed in aliveEntryIds below indefinitely
    // and a later gameweek's calculateScore() could still eliminate it (the
    // "missing pick" branch) or overwrite an already-voided pick's result —
    // scoring mutating state settle() had already finalized. LMS entries
    // never reach any status besides 'pending'/'void' at this stage (never
    // 'locked'/'settled' — GE-5.2), so this is exactly equivalent to
    // "exclude void," not an accidental narrowing.
    const { data: potEntries, error: potEntriesError } = await ctx.supabase
      .from('game_entries')
      .select('id')
      .eq('status', 'pending')
      .in('pot_id', potIds)

    if (potEntriesError) {
      throw new Error(`Failed to look up entries: ${potEntriesError.message}`)
    }

    const entryIds = (potEntries ?? []).map((e: { id: string }) => e.id)
    if (entryIds.length === 0) {
      return
    }

    const { data: aliveRows, error: aliveError } = await ctx.supabase
      .from('game_entry_lms')
      .select('game_entry_id')
      .in('game_entry_id', entryIds)
      .eq('competitive_status', 'alive')

    if (aliveError) {
      throw new Error(`Failed to look up alive entries: ${aliveError.message}`)
    }

    const aliveEntryIds = (aliveRows ?? []).map((r: { game_entry_id: string }) => r.game_entry_id)
    if (aliveEntryIds.length === 0) {
      return
    }

    const { data: picks, error: picksError } = await ctx.supabase
      .from('lms_team_picks')
      .select('id, game_entry_id, team_id, result')
      .eq('gameweek_id', gameweekId)
      .in('game_entry_id', aliveEntryIds)

    if (picksError) {
      throw new Error(`Failed to look up picks: ${picksError.message}`)
    }

    const { data: fixtures, error: fixturesError } = await ctx.supabase
      .from('fixtures')
      .select('home_team_id, away_team_id, status, home_goals, away_goals')
      .eq('gameweek_id', gameweekId)

    if (fixturesError) {
      throw new Error(`Failed to look up fixtures: ${fixturesError.message}`)
    }

    type FixtureRow = {
      home_team_id: number
      away_team_id: number
      status: string
      home_goals: number
      away_goals: number
    }
    const fixtureByTeam = new Map<number, FixtureRow>()
    for (const fixture of (fixtures ?? []) as FixtureRow[]) {
      fixtureByTeam.set(fixture.home_team_id, fixture)
      fixtureByTeam.set(fixture.away_team_id, fixture)
    }

    type PickRow = { id: number; game_entry_id: string; team_id: number; result: string }
    // onConflict: 'id' requires every NOT NULL, no-default column in each
    // row, not just the one actually changing (Postgres validates the
    // candidate row before it knows the ON CONFLICT branch will fire) —
    // same gotcha Pick5Engine.calculateScore() documents for pick5_picks.
    const pickUpdates: { id: number; game_entry_id: string; gameweek_id: number; team_id: number; result: string }[] = []
    const eliminatedEntryIds: string[] = []
    const pickedEntryIds = new Set<string>()

    for (const pick of (picks ?? []) as PickRow[]) {
      pickedEntryIds.add(pick.game_entry_id)
      const fixture = fixtureByTeam.get(pick.team_id)
      if (!fixture) continue // no fixture data yet — leave 'pending'

      const isHome = fixture.home_team_id === pick.team_id
      const teamGoals = isHome ? fixture.home_goals : fixture.away_goals
      const oppGoals = isHome ? fixture.away_goals : fixture.home_goals
      const isWinning = teamGoals > oppGoals

      if (fixture.status === 'live') {
        const result = isWinning ? 'winning' : 'losing'
        if (result !== pick.result) {
          pickUpdates.push({ id: pick.id, game_entry_id: pick.game_entry_id, gameweek_id: gameweekId, team_id: pick.team_id, result })
        }
      } else if (fixture.status === 'finished') {
        const result = isWinning ? 'won' : 'lost'
        if (result !== pick.result) {
          pickUpdates.push({ id: pick.id, game_entry_id: pick.game_entry_id, gameweek_id: gameweekId, team_id: pick.team_id, result })
        }
        if (!isWinning) eliminatedEntryIds.push(pick.game_entry_id)
      }
      // scheduled/postponed/cancelled/tbd: nothing has happened yet, leave as-is.
    }

    for (const entryId of aliveEntryIds) {
      if (!pickedEntryIds.has(entryId)) {
        eliminatedEntryIds.push(entryId)
      }
    }

    if (pickUpdates.length > 0) {
      const { error: pickUpdateError } = await ctx.supabase
        .from('lms_team_picks')
        .upsert(pickUpdates, { onConflict: 'id' })

      if (pickUpdateError) {
        throw new Error(`Failed to write pick results: ${pickUpdateError.message}`)
      }
    }

    if (eliminatedEntryIds.length > 0) {
      const { error: eliminateError } = await ctx.supabase
        .from('game_entry_lms')
        .update({ competitive_status: 'eliminated', eliminated_gameweek_id: gameweekId })
        .in('game_entry_id', eliminatedEntryIds)

      if (eliminateError) {
        throw new Error(`Failed to eliminate entries: ${eliminateError.message}`)
      }
    }
  }

  // GE-6: "Finalize this gameweek's outcome for the mode." For LMS that's
  // the payment-void rule (docs/business-rules.md § Payment verification
  // rules) — see the module comment above for what's deliberately NOT done
  // here (generateStandings()/determineWinner()/awardPrize() reasoning).
  // LMS payment is scope='season' (one flat entry fee per competition,
  // decided 2026-08-05 — GE-4.3), so this reads entry_payments once per
  // pot, not once per gameweek the way Pick 5's scope='gameweek' check
  // does; voiding an unpaid entry voids ALL of its picks across every
  // gameweek, not just this one, since the entry's whole-competition
  // participation is what's being voided.
  //
  // generateStandings() IS called here, unlike determineWinner()/
  // awardPrize() — Milestone 5 Slice 6 revises Slice 5's reasoning for
  // this one method specifically: standings are a harmless, idempotent
  // snapshot of current alive/eliminated state, not a competition-
  // concluding action, so (unlike a winner/payout) there's real value in
  // refreshing them every gameweek, same as Pick5Engine.settle() already
  // does. Wired in now because Slice 6 is what makes generateStandings()
  // real — Slice 5 couldn't call a method that only threw
  // GameEngineNotImplementedError.
  async settle(ctx: GameEngineContext, gameweekId: number): Promise<void> {
    const potIds = await this.getEligibleLmsPotIds(ctx, gameweekId)
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

      // Hardening sprint, 2026-08-06 (architecture review finding, same
      // fix as Pick5Engine.settle()): picks are voided BEFORE the entries
      // themselves, deliberately reversed from the most natural reading
      // order. The entries query above selects by status = 'pending' —
      // once an entry flips to 'void', it drops out of that selection on
      // any future call. With the old order (entries first, picks
      // second), a failure on the picks write left the entry permanently
      // 'void' with its picks never voided, and no retry could ever find
      // that entry again to finish the job. Voiding picks first has no
      // such gate: it doesn't depend on, or change, entries.status, so if
      // IT fails, the entry is still 'pending' and a retry re-derives the
      // same unpaidEntryIds and simply tries again — idempotently, since
      // re-voiding an already-void pick is a no-op. Only once the picks
      // write has actually succeeded does the entry itself flip to 'void'.
      if (unpaidEntryIds.length > 0) {
        const { error: voidPicksError } = await ctx.supabase
          .from('lms_team_picks')
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
    }

    // Same per-pot failure isolation as Pick5Engine.settle() (production
    // hardening sprint, 2026-08-05) — one pot's standings/award failure
    // must never block another's, or the payment-void work above (already
    // durably written) for unrelated pots. awardPrize() wired in here as
    // of Slice 8 (mirrors Pick5Engine.settle() calling generateStandings()
    // then awardPrize() per pot) — most calls will find the competition
    // still in progress and no-op silently, exactly like generateStandings()
    // being idempotent/harmless on an ordinary gameweek.
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

  // GE-6: "Write pot_standings_snapshots rows." Deliberately NOT modeled on
  // Pick5Engine's version — LMS isn't a points game, so "who's ahead" isn't
  // a score comparison, and there's no meaningful *per-gameweek* standings
  // snapshot the way Pick 5 has one (a fresh score every week): LMS's
  // standing is a single, continuously-updated state — alive or eliminated,
  // and since when — so this writes only the overall row (gameweek_id =
  // null), never a per-gameweek one.
  //
  // Ranking, decided 2026-08-06 by reasoning through the shape (no existing
  // rule to copy — Pick 5's rankWithTies() sorts by score, which doesn't
  // exist here):
  //   - Every currently-alive entry ties for rank 1. Nothing distinguishes
  //     one alive survivor from another — inventing a tie-break signal
  //     among them (e.g. "closer results") isn't a rule anyone's stated,
  //     so none is invented.
  //   - Eliminated entries rank below the alive group, ordered by
  //     eliminated_gameweek_id descending — outlasting other eliminated
  //     players is genuinely meaningful, so "eliminated more recently"
  //     ranks better. Standard competition ranking (ties share a rank, the
  //     next distinct rank skips ahead by however many were tied), same
  //     "1224" shape as Pick 5's rankWithTies(), continuing from wherever
  //     the alive tier left off — not restarting at 1.
  //   - score is a plain 1 (alive) / 0 (eliminated) indicator — the only
  //     honest numeric value available for a mode with no points; the
  //     actual elimination gameweek (the interesting fact) lives in `meta`
  //     instead, exactly the kind of display-only detail GE-4.6/GE-20
  //     already anticipated meta for ("elimination gameweek" is one of
  //     that column's own original examples) — this is meta's first real
  //     use anywhere in the codebase, Pick 5 has never populated it.
  async generateStandings(ctx: GameEngineContext, potId: string): Promise<StandingsRow[]> {
    const { data: entries, error: entriesError } = await ctx.supabase
      .from('game_entries')
      .select('user_id, game_entry_lms(competitive_status, eliminated_gameweek_id)')
      .eq('pot_id', potId)

    if (entriesError) {
      throw new Error(`Failed to look up entries: ${entriesError.message}`)
    }
    if (!entries?.length) {
      return []
    }

    // Same defensive array-or-object handling as Pick5Engine's own embedded-
    // resource reads — supabase-js infers this shape generically without a
    // generated Database type.
    type LmsEmbed = { competitive_status: string; eliminated_gameweek_id: number | null }
      | { competitive_status: string; eliminated_gameweek_id: number | null }[]
      | null
    type EntryRow = { user_id: string; game_entry_lms: LmsEmbed }

    const alive: { userId: string }[] = []
    const eliminated: { userId: string; eliminatedGameweekId: number }[] = []

    for (const entry of entries as EntryRow[]) {
      const lms = Array.isArray(entry.game_entry_lms) ? entry.game_entry_lms[0] : entry.game_entry_lms
      if (!lms) continue // malformed — no extension row; excluded rather than guessed at
      if (lms.competitive_status === 'alive') {
        alive.push({ userId: entry.user_id })
      } else if (lms.eliminated_gameweek_id !== null) {
        eliminated.push({ userId: entry.user_id, eliminatedGameweekId: lms.eliminated_gameweek_id })
      }
    }

    const standingsRows: StandingsRow[] = []

    for (const a of alive) {
      standingsRows.push({
        potId,
        gameweekId: null,
        userId: a.userId,
        rank: 1,
        score: 1,
        meta: { competitiveStatus: 'alive', eliminatedGameweekId: null },
      })
    }

    const sortedEliminated = [...eliminated].sort((x, y) => y.eliminatedGameweekId - x.eliminatedGameweekId)
    const startRank = alive.length + 1
    for (let i = 0; i < sortedEliminated.length; i++) {
      const rank =
        i === 0 || sortedEliminated[i].eliminatedGameweekId < sortedEliminated[i - 1].eliminatedGameweekId
          ? startRank + i
          : standingsRows[standingsRows.length - 1].rank
      standingsRows.push({
        potId,
        gameweekId: null,
        userId: sortedEliminated[i].userId,
        rank,
        score: 0,
        meta: { competitiveStatus: 'eliminated', eliminatedGameweekId: sortedEliminated[i].eliminatedGameweekId },
      })
    }

    await this.upsertOverallStandings(ctx, potId, standingsRows)

    return standingsRows
  }

  // pot_standings_snapshots has two partial unique indexes (GE-4.6) that
  // PostgREST's upsert(onConflict: '...') can't target directly — confirmed
  // live during Pick 5's own Slice 6 ("no unique or exclusion constraint
  // matching the ON CONFLICT specification"). Same workaround here: look up
  // existing rows by their natural key first, then upsert only by `id` (the
  // real, non-partial primary key). This mirrors Pick5Engine's private
  // upsertStandingsGroup() closely — genuinely shared-platform-table
  // mechanics, not LMS-specific — but stays a separate copy rather than a
  // cross-mode import, per GE-18 ("pick5/ must never import from lms/, and
  // vice versa"); a future extraction into a shared _shared/game-engine/
  // helper would be a legitimate, low-risk cleanup, not attempted here.
  private async upsertOverallStandings(
    ctx: GameEngineContext,
    potId: string,
    rows: StandingsRow[]
  ): Promise<void> {
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

  // Private, shared by determineWinner() and awardPrize() (Milestone 5
  // Slice 8 extracted this out of determineWinner()'s own Slice 7 body —
  // same "internal reuse within one mode" pattern as
  // getMostRecentGameweekWithStandings() in Pick5Engine, extracted for the
  // identical reason: awardPrize() needs the exact same classification
  // determineWinner() already computes, and re-deriving it from a plain
  // string[] would be ambiguous — a wipeout group of size 1 (a real,
  // if unintended, edge case; see the sequencing-gap note below) is
  // indistinguishable from a single survivor by array length alone, so
  // awardPrize() needs the richer, typed outcome, not just the ids.
  //
  // Four outcomes, decided 2026-08-06 by reasoning through the approved
  // rules (docs/decisions.md § LMS winner determination has the full
  // design):
  //   - exactly one alive entry -> that entry wins immediately.
  //   - zero alive entries -> a wipeout. The group is every entry
  //     eliminated in the most recent (max) eliminated_gameweek_id among
  //     them — "all remaining players eliminated in the same gameweek."
  //   - more than one alive entry, AND the pot's designated final gameweek
  //     (pots.end_gameweek_id) has already passed its deadline -> a
  //     season-end tie, every still-alive entry.
  //   - more than one alive entry, and the final gameweek hasn't concluded
  //     (or pots.end_gameweek_id isn't set at all) -> still in progress.
  //
  // Never reads pots.wipeout_resolution/season_end_tie_rule — deciding
  // what to DO with a wipeout/season-end group is awardPrize()'s job
  // (below), kept deliberately separate per the repo owner's explicit
  // instruction not to mix Wipeout Resolution and Season End Resolution
  // into the same code path.
  private async classifyOutcome(ctx: GameEngineContext, potId: string): Promise<LmsOutcome> {
    const { data: entries, error: entriesError } = await ctx.supabase
      .from('game_entries')
      .select('user_id, game_entry_lms(competitive_status, eliminated_gameweek_id)')
      .eq('pot_id', potId)

    if (entriesError) {
      throw new Error(`Failed to look up entries: ${entriesError.message}`)
    }
    if (!entries?.length) {
      return { type: 'in_progress' }
    }

    type LmsEmbed = { competitive_status: string; eliminated_gameweek_id: number | null }
      | { competitive_status: string; eliminated_gameweek_id: number | null }[]
      | null
    type EntryRow = { user_id: string; game_entry_lms: LmsEmbed }

    const alive: { userId: string }[] = []
    const eliminated: { userId: string; eliminatedGameweekId: number }[] = []

    for (const entry of entries as EntryRow[]) {
      const lms = Array.isArray(entry.game_entry_lms) ? entry.game_entry_lms[0] : entry.game_entry_lms
      if (!lms) continue // malformed — no extension row; excluded rather than guessed at
      if (lms.competitive_status === 'alive') {
        alive.push({ userId: entry.user_id })
      } else if (lms.eliminated_gameweek_id !== null) {
        eliminated.push({ userId: entry.user_id, eliminatedGameweekId: lms.eliminated_gameweek_id })
      }
    }

    if (alive.length === 1) {
      return { type: 'single_survivor', winnerId: alive[0].userId }
    }

    if (alive.length === 0) {
      if (eliminated.length === 0) {
        return { type: 'in_progress' } // no entries resolved at all yet
      }
      const mostRecentGameweek = Math.max(...eliminated.map((e) => e.eliminatedGameweekId))
      const memberIds = eliminated.filter((e) => e.eliminatedGameweekId === mostRecentGameweek).map((e) => e.userId)
      return { type: 'wipeout', gameweekId: mostRecentGameweek, memberIds }
    }

    // alive.length > 1 — only a season-end tie if the pot's own designated
    // final gameweek has actually passed; otherwise still in progress.
    const { data: pot, error: potError } = await ctx.supabase
      .from('pots')
      .select('end_gameweek_id')
      .eq('id', potId)
      .maybeSingle()

    if (potError) {
      throw new Error(`Failed to look up pot: ${potError.message}`)
    }
    if (!pot?.end_gameweek_id) {
      return { type: 'in_progress' }
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

    return { type: 'season_end', aliveIds: alive.map((a) => a.userId) }
  }

  // GE-6: "Identify the winner(s)." Not modeled on Pick5Engine's version at
  // all — that one is a one-line "rank 1 of the most recently settled
  // gameweek" lookup because for Pick 5, every settled gameweek genuinely
  // is a concluded, payable instance (a weekly jackpot). LMS's competition
  // concludes exactly once, so "no outcome yet, still in progress" has to
  // be a real, first-class return value here, with no Pick 5 equivalent to
  // borrow from. Thin wrapper over classifyOutcome() (Slice 8) — flattens
  // the rich outcome into GE-6's fixed Promise<string[]> shape. A caller
  // distinguishes a wipeout from a season-end tie by checking
  // competitive_status on the returned ids (all 'eliminated' for a
  // wipeout; all 'alive' for a season-end tie), not from this return value
  // alone.
  //
  // No writes of any kind happen here — no elimination (calculateScore()'s
  // job already), no pot_prizes, no rollover pot creation. Purely a read
  // and a classification, per the repo owner's explicit "only determine
  // the outcome" instruction.
  async determineWinner(ctx: GameEngineContext, potId: string): Promise<string[]> {
    const outcome = await this.classifyOutcome(ctx, potId)
    switch (outcome.type) {
      case 'in_progress':
        return []
      case 'single_survivor':
        return [outcome.winnerId]
      case 'wipeout':
        return outcome.memberIds
      case 'season_end':
        return outcome.aliveIds
    }
  }

  // GE-6: "Split net prize pool equally." / GE-8.4: awardPrize() internally
  // calls determineWinner() (here, classifyOutcome() directly, to reuse the
  // richer typed result rather than re-deriving it from a flattened
  // string[] — see classifyOutcome()'s own comment for why that ambiguity
  // matters). Designed from the approved LMS outcome model, not
  // Pick5Engine's version — reused where the underlying mechanics are
  // genuinely shared (money math, the pot_prizes partial-index upsert
  // workaround, floor-not-round-so-no-one-is-favored splitting), diverged
  // everywhere the outcome model itself differs:
  //   - single_survivor: the net prize goes entirely to that one entry.
  //   - wipeout, wipeout_resolution = 'split_prize': split equally among
  //     the wipeout group (same multi-winner split Pick 5 already uses).
  //   - wipeout, wipeout_resolution = 'roll_prize': nobody is paid; this
  //     pot's pot_prizes row is marked rollover = true and the net amount
  //     becomes the new pot's carry_over_amount — see createRolloverPot().
  //   - season_end, season_end_tie_rule = 'split_prize': identical split
  //     logic to a Split Prize wipeout, just a different source group
  //     (every still-alive entry, not an eliminated one).
  //   - season_end, season_end_tie_rule = 'final_prediction': not
  //     implemented — throws LmsFinalPredictionNotImplementedError rather
  //     than guessing, per the repo owner's explicit instruction.
  //   - in_progress: a no-op, silently. Unlike Pick5Engine's version (which
  //     throws Pick5NoEligibleWinnersError when winners.length === 0
  //     despite settled entries existing — genuinely anomalous there),
  //     "not concluded yet" is LMS's normal, expected, most common state:
  //     awardPrize() is called from settle() every gameweek (see below),
  //     so most calls correctly finding nothing to do yet must be silent,
  //     not an error.
  //
  // Idempotent the same way Pick5Engine's version is: an existing, settled
  // pot_prizes row (scope='season') short-circuits the whole method before
  // any classification or writes happen — this is also the exact signal
  // getEligibleLmsPotIds() now checks to close the Slice 7 sequencing gap,
  // so a concluded pot's calculateScore()/settle() calls stop reaching this
  // method's own entries at all, not just this method itself no-oping.
  //
  // Every entry in the pot (not just the winner(s)) is transitioned to
  // status = 'settled' once a real outcome is reached — deliberately
  // deferred exactly this far, per Slice 5's own reasoning ("'settled'
  // only makes sense once the competition has actually concluded").
  //
  // NOT fully transactional — supabase-js has no cross-table transaction,
  // so this is several separate writes, same constraint every other
  // multi-step write in this codebase already lives with. The write order
  // is deliberately chosen so a failure ANYWHERE is safely retryable: the
  // pot_prizes row (whose is_settled=true is this method's own idempotency
  // gate, above) is written LAST, only once every other write —
  // settling/paying entries, and creating the rollover pot — has already
  // succeeded. Found and fixed 2026-08-06 (Slice 8 review, before Slice 9):
  // the original ordering wrote pot_prizes FIRST, which meant any failure
  // in a later step (entry settlement, payout, or rollover-pot creation)
  // left is_settled permanently true with the rest of the work undone and
  // no way to retry — this method would short-circuit on every future call
  // without ever finishing. Settling/paying entries are naturally
  // idempotent updates (re-applying the same value twice is harmless), so
  // reordering them alone is safe; createRolloverPot() is not (it INSERTs
  // a new row), so it now has its own idempotency guard — see its comment.
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

    const outcome = await this.classifyOutcome(ctx, potId)
    if (outcome.type === 'in_progress') {
      return
    }

    const { data: pot, error: potError } = await ctx.supabase
      .from('pots')
      .select('name, created_by, season_id, league_id, entry_fee, end_gameweek_id, wipeout_resolution, season_end_tie_rule, admin_fee_type, admin_fee_amount, admin_fee_percentage, charity_fee_type, charity_fee_amount, charity_fee_percentage, carry_over_amount, rollover_generation')
      .eq('id', potId)
      .single()

    if (potError) {
      throw new Error(`Failed to look up pot: ${potError.message}`)
    }

    type PotConfig = {
      name: string
      created_by: string
      season_id: number
      league_id: number
      entry_fee: number
      end_gameweek_id: number | null
      wipeout_resolution: 'split_prize' | 'roll_prize'
      season_end_tie_rule: 'split_prize' | 'final_prediction'
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

    if (outcome.type === 'season_end' && potConfig.season_end_tie_rule === 'final_prediction') {
      throw new LmsFinalPredictionNotImplementedError(potId)
    }

    const { data: nonVoidEntries, error: nonVoidError } = await ctx.supabase
      .from('game_entries')
      .select('id')
      .eq('pot_id', potId)
      .neq('status', 'void')

    if (nonVoidError) {
      throw new Error(`Failed to count paid entries: ${nonVoidError.message}`)
    }

    const grossAmount = roundToCents(potConfig.entry_fee * (nonVoidEntries?.length ?? 0) + potConfig.carry_over_amount)
    const adminFeeAmount = calculateLmsFeeAmount(potConfig.admin_fee_type, potConfig.admin_fee_amount, potConfig.admin_fee_percentage, grossAmount)
    const charityFeeAmount = calculateLmsFeeAmount(potConfig.charity_fee_type, potConfig.charity_fee_amount, potConfig.charity_fee_percentage, grossAmount)
    const netAmount = roundToCents(grossAmount - adminFeeAmount - charityFeeAmount)

    if (netAmount < 0) {
      throw new LmsPrizePoolExceededError(potId, grossAmount, adminFeeAmount, charityFeeAmount)
    }

    const rollover = outcome.type === 'wipeout' && potConfig.wipeout_resolution === 'roll_prize'
    const recipients: string[] =
      outcome.type === 'single_survivor' ? [outcome.winnerId]
      : outcome.type === 'wipeout' && potConfig.wipeout_resolution === 'split_prize' ? outcome.memberIds
      : outcome.type === 'season_end' ? outcome.aliveIds // season_end_tie_rule === 'split_prize', final_prediction already threw above
      : [] // roll_prize

    const { error: settleEntriesError } = await ctx.supabase
      .from('game_entries')
      .update({ status: 'settled', settled_at: ctx.now().toISOString() })
      .eq('pot_id', potId)
      .neq('status', 'void')

    if (settleEntriesError) {
      throw new Error(`Failed to settle entries: ${settleEntriesError.message}`)
    }

    const perRecipientAmount = recipients.length > 0 ? floorToCents(netAmount / recipients.length) : 0

    if (recipients.length > 0) {
      for (const userId of recipients) {
        const { error: payoutError } = await ctx.supabase
          .from('game_entries')
          .update({ payout_amount: perRecipientAmount })
          .eq('pot_id', potId)
          .eq('user_id', userId)

        if (payoutError) {
          throw new Error(`Failed to write payout for user ${userId}: ${payoutError.message}`)
        }
      }
    }

    if (rollover) {
      await this.createRolloverPot(ctx, potId, potConfig, netAmount)
    }

    // Written LAST, deliberately — see this method's own comment above for
    // why. is_settled=true here is what makes every future call (and
    // getEligibleLmsPotIds()'s Slice-8 sequencing-gap check) treat this
    // pot as concluded, so nothing above this line may be allowed to run
    // again "for free" after it — everything above is either a naturally
    // idempotent update or (createRolloverPot()) has its own guard.
    const prizeRow = {
      pot_id: potId,
      scope: 'season' as const,
      gameweek_id: null,
      gross_amount: grossAmount,
      admin_fee_amount: adminFeeAmount,
      charity_fee_amount: charityFeeAmount,
      is_settled: true,
      settled_at: ctx.now().toISOString(),
      rollover,
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
    // payout loop the way Pick5Engine's does (there, pot_prizes is written
    // FIRST, so by the time its payout loop runs, pot_prizes already
    // exists; here it's written LAST, so placing the notification here
    // instead keeps the same invariant: every notification fires only
    // once both the money AND the settlement record it describes are
    // already durably written). Best-effort, same reasoning and shape as
    // Pick5Engine's own call site — a failure here must never unwind or
    // block money already paid, so it's caught and logged, not propagated.
    for (const userId of recipients) {
      try {
        await this.notifyUsers(ctx, {
          userId,
          potId,
          type: 'lms.prize_awarded' satisfies LmsNotificationType,
          payload: { amount: perRecipientAmount, outcome: outcome.type },
        })
      } catch (notifyError) {
        console.error(
          `notifyUsers failed for pot ${potId}, user ${userId} (prize already awarded, not affected): ` +
            (notifyError instanceof Error ? notifyError.message : String(notifyError))
        )
      }
    }
  }

  // Milestone 5 Slice 8: automatic rollover-pot creation, per the repo
  // owner's explicit "do NOT ask the organiser to create the rollover pot
  // manually" decision (2026-08-05). Only ever called from awardPrize()
  // above — but, since Slice 8's review before Slice 9, awardPrize() now
  // writes its own pot_prizes row LAST (see that method's comment), this
  // can legitimately run twice for the same source pot if a first attempt
  // got this far and then failed on a later step (the pot_members insert
  // below, or awardPrize()'s own trailing pot_prizes write) — the whole
  // method is retried from the top on the next call, since is_settled
  // never became true. Self-checks for that case: an existing pot whose
  // rollover_source_pot_id already points at sourcePotId means a prior
  // attempt already finished creating it, so this call reuses it instead
  // of creating a second rollover pot for the same wipeout.
  //
  // Compensating rollback, same pattern get-or-create-pick5-entry/
  // get-or-create-lms-entry already established — supabase-js has no
  // cross-table transaction, so if the pot_members insert fails after the
  // pots insert succeeds, the just-created pot is deleted rather than left
  // as an orphaned rollover pot with no organiser member.
  private async createRolloverPot(
    ctx: GameEngineContext,
    sourcePotId: string,
    sourcePot: {
      name: string
      created_by: string
      season_id: number
      league_id: number
      entry_fee: number
      end_gameweek_id: number | null
      wipeout_resolution: 'split_prize' | 'roll_prize'
      season_end_tie_rule: 'split_prize' | 'final_prediction'
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

    // Strips any existing "(Rollover #N)" suffix before appending the new
    // one, so a rollover-of-a-rollover gets "Base Name (Rollover #3)", not
    // "Base Name (Rollover #2) (Rollover #3)".
    const baseName = sourcePot.name.replace(/\s*\(Rollover #\d+\)\s*$/, '')
    const newGeneration = sourcePot.rollover_generation + 1
    const newName = `${baseName} (Rollover #${newGeneration})`

    const { data: newPot, error: potInsertError } = await ctx.supabase
      .from('pots')
      .insert({
        name: newName,
        season_id: sourcePot.season_id,
        league_id: sourcePot.league_id,
        created_by: sourcePot.created_by,
        game_type: 'last_man_standing',
        status: 'draft',
        entry_fee: sourcePot.entry_fee,
        end_gameweek_id: sourcePot.end_gameweek_id,
        wipeout_resolution: sourcePot.wipeout_resolution,
        season_end_tie_rule: sourcePot.season_end_tie_rule,
        admin_fee_type: sourcePot.admin_fee_type,
        admin_fee_amount: sourcePot.admin_fee_amount,
        admin_fee_percentage: sourcePot.admin_fee_percentage,
        charity_fee_type: sourcePot.charity_fee_type,
        charity_fee_amount: sourcePot.charity_fee_amount,
        charity_fee_percentage: sourcePot.charity_fee_percentage,
        rollover_source_pot_id: sourcePotId,
        carry_over_amount: carryOverAmount,
        rollover_generation: newGeneration,
        // start_gameweek_id deliberately left null — the organiser chooses
        // it during this draft pot's own pre-launch workflow (GE-5.2), not
        // at automatic-creation time.
      })
      .select('id')
      .single()

    if (potInsertError) {
      throw new Error(`Failed to create rollover pot: ${potInsertError.message}`)
    }

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

  // GE-6: "Write to notifications." A pure domain-event emitter, identical
  // in every respect to Pick5Engine's own — inserts one row and returns.
  // Genuinely shared platform mechanics (the `notifications` table shape,
  // GE-4.8), not mode-specific, so this is a one-for-one copy rather than
  // a redesign; kept as a separate implementation rather than a shared
  // helper only because GE-18 forbids `lms/` importing from `pick5/` (or
  // vice versa) — the same acknowledged-duplication category as the money
  // math and the pot_prizes/pot_standings_snapshots upsert workaround.
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
