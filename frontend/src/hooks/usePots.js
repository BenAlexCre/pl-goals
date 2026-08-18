import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export function usePots() {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['pots', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pots')
        .select(`
          id, name, description, status, game_type, created_at, season_id, league_id,
          seasons(name, year_start),
          leagues(name),
          pot_members!inner(user_id, role)
        `)
        .eq('pot_members.user_id', user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

// Phase 9A — Dashboard "your competitions" section. One batched query per
// fact (not one per pot): entry_payments/game_entries are both already
// readable under each pot's existing RLS (entry_payments_select_member/
// pot member policies) — nothing new on the backend, this just reads them
// scoped to `user_id` + `pot_id IN (...)` in a single round trip regardless
// of how many pots the user is in, matching Part 27's "no unnecessary
// queries."
//
// Phase 11 — Part E/9 ("Your upcoming picks" / gameweek status). Takes the
// full `pots` array (not just IDs) because each pot's own "next actionable
// gameweek" must be resolved from THAT pot's own season_id/league_id, not
// one global gameweek — a pot can legitimately be on a different
// league/season (e.g. one of this account's own pots still points at the
// FIFA World Cup reference league, ISSUE-52). Batched by DISTINCT
// (season_id, league_id) pair across the caller's pots, not per pot — with
// today's real data that's one query for every pot sharing the one real
// Premier League pot the account plays in. Adds two further small,
// conditional batched reads (lms_team_picks/predictor_fixture_picks) only
// when the caller actually has a season-scoped (LMS/Predictor) entry
// somewhere, to answer the genuinely new question Phase 9A's version of
// this hook explicitly deferred: not just "have you joined", but "have you
// made THIS gameweek's pick" — Pick 5's own game_entries row already
// answers this for that mode (an entry is created lazily on save), so no
// extra query is needed there.
export function useDashboardPotStatus(pots) {
  const { user } = useAuthStore()
  const potIds = pots.map((p) => p.id)
  return useQuery({
    queryKey: ['dashboard-pot-status', potIds, user?.id],
    enabled: potIds.length > 0 && !!user?.id,
    queryFn: async () => {
      const pairKey = (seasonId, leagueId) => `${seasonId}:${leagueId}`
      const pairs = [...new Map(pots.map((p) => [pairKey(p.season_id, p.league_id), { seasonId: p.season_id, leagueId: p.league_id }])).values()]
      const seasonIds = [...new Set(pairs.map((p) => p.seasonId))]
      const leagueIds = [...new Set(pairs.map((p) => p.leagueId))]

      // Soonest non-completed gameweek per (season, league) pair — the
      // same "what's next" definition useNextGameweek() uses, just scoped
      // per pot instead of app-wide.
      const { data: gwRows, error: gwError } = await supabase
        .from('gameweeks')
        .select('id, number, season_id, league_id, status, deadline_utc')
        .in('season_id', seasonIds)
        .in('league_id', leagueIds)
        .neq('status', 'completed')
        .order('number', { ascending: true })
      if (gwError) throw gwError

      const nextGwByPair = new Map()
      for (const gw of gwRows ?? []) {
        const key = pairKey(gw.season_id, gw.league_id)
        if (!nextGwByPair.has(key)) nextGwByPair.set(key, gw)
      }

      // Phase 11 — real, pre-existing bug found and fixed live while
      // verifying this hook's own new pickSubmitted feature (ISSUE-53):
      // neither query was ever scoped to the signed-in user, only to
      // `pot_id`. entry_payments/game_entries are both readable
      // pot-member-wide by design (the deadline/payment reveal feature
      // every pot's own detail page already relies on), so on any pot
      // with more than one member, `.find()` below could silently match
      // a DIFFERENT member's entry or payment row — reporting someone
      // else's "hasEntry"/"isPaid"/"pickSubmitted" as the viewer's own.
      // Confirmed live: a 51-member demo pot the viewer had never entered
      // still showed "Completed" here, sourced from another member's
      // season-scoped entry. Scoping to `user_id = <signed-in user>`
      // closes it — a plain missing filter, not an RLS gap (RLS already
      // correctly allows the pot-wide read for the pages that need it).
      const { data: payments, error: paymentsError } = await supabase
        .from('entry_payments')
        .select('pot_id, gameweek_id, is_paid')
        .eq('user_id', user.id)
        .in('pot_id', potIds)
      if (paymentsError) throw paymentsError

      const { data: entries, error: entriesError } = await supabase
        .from('game_entries')
        .select('id, pot_id, gameweek_id, status, game_entry_lms(competitive_status)')
        .eq('user_id', user.id)
        .in('pot_id', potIds)
      if (entriesError) throw entriesError

      const seasonScopedEntryIds = (entries ?? [])
        .filter((e) => e.gameweek_id === null)
        .map((e) => e.id)

      let lmsPicks = []
      let predictorPicks = []
      if (seasonScopedEntryIds.length > 0) {
        const nextGwIds = [...nextGwByPair.values()].map((gw) => gw.id)
        const [lmsResult, predictorResult] = await Promise.all([
          supabase.from('lms_team_picks').select('game_entry_id, gameweek_id').in('game_entry_id', seasonScopedEntryIds).in('gameweek_id', nextGwIds),
          supabase.from('predictor_fixture_picks').select('game_entry_id, gameweek_id').in('game_entry_id', seasonScopedEntryIds).in('gameweek_id', nextGwIds),
        ])
        if (lmsResult.error) throw lmsResult.error
        if (predictorResult.error) throw predictorResult.error
        lmsPicks = lmsResult.data ?? []
        predictorPicks = predictorResult.data ?? []
      }

      // Phase 12, Part 18 — "32 players remaining" on each LMS competition
      // card needs every entrant's survival status, not just the viewer's
      // own — deliberately NOT scoped to `user_id` (unlike every query
      // above): this is the same pot-wide aggregate `useLmsCompetitionPicks`
      // (Phase 10B) already reads under the same RLS
      // (`is_pot_member(pot_id)`), just reduced to a count here instead of
      // full pick history. Not the Phase 11 bug reappearing — that bug was
      // treating another member's row as the VIEWER's own; this is an
      // aggregate every member is already allowed to see in full on the
      // pot's own page.
      const lmsPotIds = pots.filter((p) => p.game_type === 'last_man_standing').map((p) => p.id)
      const lmsSurvivalByPot = new Map()
      if (lmsPotIds.length > 0) {
        const { data: lmsEntries, error: lmsEntriesError } = await supabase
          .from('game_entries')
          .select('pot_id, game_entry_lms(competitive_status)')
          .in('pot_id', lmsPotIds)
          .is('gameweek_id', null)
        if (lmsEntriesError) throw lmsEntriesError
        for (const row of lmsEntries ?? []) {
          const counts = lmsSurvivalByPot.get(row.pot_id) ?? { alive: 0, eliminated: 0, total: 0 }
          counts.total += 1
          if (row.game_entry_lms?.competitive_status === 'eliminated') counts.eliminated += 1
          else counts.alive += 1
          lmsSurvivalByPot.set(row.pot_id, counts)
        }
      }

      const statusByPot = new Map()
      for (const pot of pots) {
        const nextGameweek = nextGwByPair.get(pairKey(pot.season_id, pot.league_id)) ?? null
        const payment = (payments ?? []).find(
          (p) => p.pot_id === pot.id && (p.gameweek_id === null || p.gameweek_id === nextGameweek?.id)
        )
        const entry = (entries ?? []).find(
          (e) => e.pot_id === pot.id && (e.gameweek_id === null || e.gameweek_id === nextGameweek?.id)
        )
        const seasonEntry = (entries ?? []).find((e) => e.pot_id === pot.id && e.gameweek_id === null)

        // null = "can't tell" (no next gameweek resolved, or no entry at
        // all yet) — kept distinct from `false` so the UI can tell "not
        // your turn yet" apart from "genuinely nothing to show".
        let pickSubmitted = null
        if (pot.game_type === 'pick5') {
          pickSubmitted = nextGameweek
            ? (entries ?? []).some((e) => e.pot_id === pot.id && e.gameweek_id === nextGameweek.id)
            : null
        } else if (pot.game_type === 'last_man_standing') {
          pickSubmitted = seasonEntry && nextGameweek
            ? lmsPicks.some((p) => p.game_entry_id === seasonEntry.id && p.gameweek_id === nextGameweek.id)
            : (seasonEntry ? false : null)
        } else if (pot.game_type === 'score_predictor') {
          pickSubmitted = seasonEntry && nextGameweek
            ? predictorPicks.some((p) => p.game_entry_id === seasonEntry.id && p.gameweek_id === nextGameweek.id)
            : (seasonEntry ? false : null)
        }

        statusByPot.set(pot.id, {
          isPaid: payment?.is_paid ?? null,
          hasEntry: !!entry,
          entryScoped: entry ? entry.gameweek_id !== null : null,
          nextGameweek,
          pickSubmitted,
          lmsSurvival: pot.game_type === 'last_man_standing' ? (lmsSurvivalByPot.get(pot.id) ?? null) : null,
          // Phase 12 — real bug found live: an eliminated LMS entrant was
          // still shown "Make your pick" (hasEntry/pickSubmitted alone
          // don't know the viewer is out). LmsPotDetail.jsx's own
          // `canPick` already excludes eliminated entrants; the Dashboard
          // CTA needs the same fact.
          lmsEliminated: pot.game_type === 'last_man_standing'
            ? (seasonEntry?.game_entry_lms?.competitive_status === 'eliminated')
            : null,
        })
      }
      return statusByPot
    },
  })
}

export function usePot(potId) {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['pot', potId],
    enabled: !!potId && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pots')
        .select(`
          *,
          seasons(name, year_start),
          leagues(name),
          pot_members(
            user_id, role, joined_at,
            profiles(id, display_name, username, avatar_url)
          )
        `)
        .eq('id', potId)
        .single()
      if (error) throw error
      return data
    },
  })
}

// Full pot-contract shape (game_type, fees, mode-specific config) — see
// ISSUE-34 (docs/current-state.md). Every field beyond name/league/season
// is optional at the call site; omitted mode-specific fields are left off
// the insert entirely so the column keeps its DB default rather than being
// explicitly (and possibly wrongly) set to null.
export function useCreatePot() {
  const qc = useQueryClient()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async (config) => {
      const {
        name,
        description,
        seasonId,
        leagueId,
        gameType,
        entryFee,
        maxMembers,
        adminFeeType,
        adminFeeAmount,
        adminFeePercentage,
        charityFeeType,
        charityFeeAmount,
        charityFeePercentage,
        endGameweekId,
        startGameweekId,
        wipeoutResolution,
        seasonEndTieRule,
        predictorCycleMode,
        predictorScorerScope,
        predictorExactScorePoints,
        predictorCorrectResultPoints,
        predictorScorerBonusPoints,
      } = config

      const row = {
        name,
        description: description || null,
        created_by: user.id,
        season_id: seasonId,
        league_id: leagueId,
        game_type: gameType,
        entry_fee: entryFee,
        max_members: maxMembers || null,
        admin_fee_type: adminFeeType,
        admin_fee_amount: adminFeeType === 'fixed' ? adminFeeAmount : null,
        admin_fee_percentage: adminFeeType === 'percentage' ? adminFeePercentage : null,
        charity_fee_type: charityFeeType,
        charity_fee_amount: charityFeeType === 'fixed' ? charityFeeAmount : null,
        charity_fee_percentage: charityFeeType === 'percentage' ? charityFeePercentage : null,
      }

      // wipeout_resolution/season_end_tie_rule are "only meaningful when
      // game_type = last_man_standing" (013_lms_wipeout_and_rollover.sql);
      // predictor_cycle_mode/predictor_scorer_scope/the three scoring point
      // columns are the Predictor equivalent. end_gameweek_id is shared:
      // both engines' determineWinner() read it as the season-conclusion
      // marker, so it's required by the caller for both modes, never for
      // Pick 5 (which has no season-end concept — see decisions.md § Score
      // Predictor architecture review). start_gameweek_id is set for LMS
      // (its entry-window cutoff) always, and for Score Predictor only when
      // predictorCycleMode is 'single_cycle' (Phase 7 — Competition
      // Configuration UX Polish: a "Custom competition" pot's start bound,
      // enforced by PredictorEngine.validateEntry()) — a "Two half-season"
      // pot leaves it unset, same as every Predictor pot before this change.
      if (gameType === 'last_man_standing') {
        row.start_gameweek_id = startGameweekId
        row.end_gameweek_id = endGameweekId
        row.wipeout_resolution = wipeoutResolution
        row.season_end_tie_rule = seasonEndTieRule
      } else if (gameType === 'score_predictor') {
        row.end_gameweek_id = endGameweekId
        if (predictorCycleMode === 'single_cycle') {
          row.start_gameweek_id = startGameweekId
        }
        row.predictor_cycle_mode = predictorCycleMode
        row.predictor_scorer_scope = predictorScorerScope
        row.predictor_exact_score_points = predictorExactScorePoints
        row.predictor_correct_result_points = predictorCorrectResultPoints
        row.predictor_scorer_bonus_points = predictorScorerBonusPoints
      }

      const { data: pot, error } = await supabase
        .from('pots')
        .insert(row)
        .select()
        .single()
      if (error) throw error

      const { error: memberError } = await supabase.from('pot_members').insert({
        pot_id: pot.id,
        user_id: user.id,
        role: 'admin',
      })
      if (memberError) throw memberError

      return pot
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pots'] }),
  })
}