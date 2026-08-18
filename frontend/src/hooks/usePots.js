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
          id, name, description, status, game_type, created_at,
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
// queries." Pick 5 payments/entries are gameweek-scoped (picked the row
// matching the current gameweek, if any); LMS/Predictor are season-scoped
// (gameweek_id IS NULL) — a season-scoped "has an entry" is reported as
// "Joined", not overclaimed as "picked this week", since confirming a
// specific week's pick for those two modes would need a further
// mode-specific query per pot, not a fair trade for a secondary,
// deliberately concise dashboard section.
export function useDashboardPotStatus(potIds, currentGameweekId) {
  return useQuery({
    queryKey: ['dashboard-pot-status', potIds, currentGameweekId],
    enabled: potIds.length > 0,
    queryFn: async () => {
      const { data: payments, error: paymentsError } = await supabase
        .from('entry_payments')
        .select('pot_id, gameweek_id, is_paid')
        .in('pot_id', potIds)
      if (paymentsError) throw paymentsError

      const { data: entries, error: entriesError } = await supabase
        .from('game_entries')
        .select('pot_id, gameweek_id, status')
        .in('pot_id', potIds)
      if (entriesError) throw entriesError

      const statusByPot = new Map()
      for (const potId of potIds) {
        const payment = (payments ?? []).find(
          (p) => p.pot_id === potId && (p.gameweek_id === null || p.gameweek_id === currentGameweekId)
        )
        const entry = (entries ?? []).find(
          (e) => e.pot_id === potId && (e.gameweek_id === null || e.gameweek_id === currentGameweekId)
        )
        statusByPot.set(potId, {
          isPaid: payment?.is_paid ?? null,
          hasEntry: !!entry,
          entryScoped: entry ? entry.gameweek_id !== null : null,
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