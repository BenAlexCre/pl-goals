// Milestone 5 (docs/game-engine.md § GE-5.2, GE-12): validateEntry (Slice 2),
// lockEntries (Slice 3), calculateScore (Slice 4), settle (Slice 5),
// generateStandings (Slice 6), and determineWinner (Slice 7) are
// implemented — awardPrize/notifyUsers still throw
// GameEngineNotImplementedError, same "half-built mode fails loudly"
// pattern Pick5Engine used between its own Slice 2 and Slice 9.
// determineWinner() is deliberately not wired into settle() (or anywhere
// else) this slice — it exists standalone, read-only, exactly like
// Pick5Engine's own determineWinner() did between its Slice 7 and Slice 8
// (when awardPrize() first called it).
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
// settle() therefore has much less left to do than Pick5Engine's version,
// per the repo owner's explicit 2026-08-06 instruction not to duplicate
// calculateScore()'s work: it does the payment-void check ONLY (genuinely
// settlement's job, untouched by calculateScore()) and nothing else. Two
// things Pick5Engine's settle() does are deliberately NOT done here:
//   - It never transitions game_entries.status to 'settled'. That status
//     must stay 'pending' across the whole competition (same reasoning as
//     lockEntries() never touching it) — 'settled' only makes sense once
//     the competition has actually concluded, which isn't every gameweek's
//     settle() call the way a Pick 5 gameweek concludes weekly.
//   - It never calls determineWinner()/awardPrize(). Pick 5 calls them
//     every gameweek because a new payable instance concludes every
//     gameweek (GE-8.4). LMS's competition only concludes once (a
//     wipeout, or one survivor) — calling award-adjacent methods on every
//     ordinary gameweek's settle() would be structurally wrong, not just
//     premature. Detecting "has this competition just concluded" is real,
//     unstarted design work (wipeout detection), correctly left for a
//     later slice rather than guessed at here.
//
// generateStandings() (Slice 6) IS called from settle(), though — Slice
// 5's own reasoning grouped it with determineWinner()/awardPrize(), but on
// reflection that was imprecise: standings are a harmless, idempotent
// snapshot, not a competition-concluding action, so refreshing them every
// gameweek has real value (same as Pick5Engine.settle() already does) —
// see docs/decisions.md § LMS standings for the full reasoning, including
// why the standings *shape* itself is not modeled on Pick 5's at all
// (no points exist for LMS; ranking is alive-tied-at-1 then eliminated-by-
// recency, not a score comparison).

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
  private async getEligibleLmsPotIds(ctx: GameEngineContext, gameweekId: number): Promise<string[]> {
    const { data: pots, error } = await ctx.supabase
      .from('pots')
      .select('id')
      .eq('game_type', 'last_man_standing')
      .lte('start_gameweek_id', gameweekId)

    if (error) {
      throw new Error(`Failed to look up LMS pots: ${error.message}`)
    }

    return (pots ?? []).map((p: { id: string }) => p.id)
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

    const { data: potEntries, error: potEntriesError } = await ctx.supabase
      .from('game_entries')
      .select('id')
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

      if (unpaidEntryIds.length > 0) {
        const { error: voidEntriesError } = await ctx.supabase
          .from('game_entries')
          .update({ status: 'void' })
          .in('id', unpaidEntryIds)

        if (voidEntriesError) {
          throw new Error(`Failed to void unpaid entries: ${voidEntriesError.message}`)
        }

        const { error: voidPicksError } = await ctx.supabase
          .from('lms_team_picks')
          .update({ result: 'void' })
          .in('game_entry_id', unpaidEntryIds)

        if (voidPicksError) {
          throw new Error(`Failed to void unpaid entries' picks: ${voidPicksError.message}`)
        }
      }
    }

    // Same per-pot failure isolation as Pick5Engine.settle() (production
    // hardening sprint, 2026-08-05) — one pot's standings failure must
    // never block another's, or the payment-void work above (already
    // durably written) for unrelated pots.
    const potErrors: { potId: string; message: string }[] = []
    for (const potId of potIds) {
      try {
        await this.generateStandings(ctx, potId)
      } catch (err) {
        potErrors.push({ potId, message: err instanceof Error ? err.message : String(err) })
      }
    }

    if (potErrors.length > 0) {
      throw new Error(
        `settle() finalized entries for gameweek ${gameweekId}, but standings processing failed for ${potErrors.length} pot(s): ` +
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

  // GE-6: "Identify the winner(s)." Not modeled on Pick5Engine's version at
  // all — that one is a one-line "rank 1 of the most recently settled
  // gameweek" lookup because for Pick 5, every settled gameweek genuinely
  // is a concluded, payable instance (a weekly jackpot). LMS's competition
  // concludes exactly once, so "no outcome yet, still in progress" has to
  // be a real, first-class return value here, with no Pick 5 equivalent to
  // borrow from.
  //
  // Four outcomes, decided 2026-08-06 by reasoning through the approved
  // rules (docs/decisions.md § LMS winner determination has the full
  // design, including what's still unresolved):
  //   - exactly one alive entry -> that entry wins immediately, [userId].
  //   - zero alive entries -> a wipeout. Returns every entry eliminated in
  //     the most recent (max) eliminated_gameweek_id among them — "all
  //     remaining players eliminated in the same gameweek." What to DO
  //     with that group (split vs. roll) is Wipeout Resolution's job
  //     (awardPrize(), not built yet) — this method only identifies who's
  //     in the group, never reads pots.wipeout_resolution itself.
  //   - more than one alive entry, AND the pot's designated final gameweek
  //     (pots.end_gameweek_id) has already passed its deadline -> a
  //     season-end tie. Returns every still-alive entry. Season End
  //     Resolution (split vs. Final Prediction) is equally out of scope
  //     here, deliberately — this is a genuinely separate concept from
  //     Wipeout Resolution and must not be resolved by the same code path
  //     (explicit repo owner instruction) — the caller distinguishes this
  //     case from a wipeout by checking competitive_status on the returned
  //     ids (all 'alive' here; all 'eliminated' for a wipeout) rather than
  //     this method returning two different shapes for a fixed-by-GE-6
  //     string[] contract.
  //   - more than one alive entry, and the final gameweek hasn't concluded
  //     (or pots.end_gameweek_id isn't set at all) -> still in progress,
  //     []. Same meaning as Pick5Engine's own "nothing to report yet" [].
  //
  // No writes of any kind happen here — no elimination (calculateScore()'s
  // job already), no pot_prizes, no rollover pot creation. Purely a read
  // and a classification, per the repo owner's explicit "only determine
  // the outcome" instruction.
  async determineWinner(ctx: GameEngineContext, potId: string): Promise<string[]> {
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
      return [alive[0].userId]
    }

    if (alive.length === 0) {
      if (eliminated.length === 0) {
        return [] // no entries resolved at all yet — nothing to determine
      }
      const mostRecentGameweek = Math.max(...eliminated.map((e) => e.eliminatedGameweekId))
      return eliminated.filter((e) => e.eliminatedGameweekId === mostRecentGameweek).map((e) => e.userId)
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
      return []
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
      return []
    }

    return alive.map((a) => a.userId)
  }

  async awardPrize(_ctx: GameEngineContext, _potId: string): Promise<void> {
    throw new GameEngineNotImplementedError('last_man_standing', 'awardPrize')
  }

  async notifyUsers(_ctx: GameEngineContext, _event: NotificationEvent): Promise<void> {
    throw new GameEngineNotImplementedError('last_man_standing', 'notifyUsers')
  }
}
