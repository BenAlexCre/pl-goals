import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, extractFunctionError } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

// Season-scoped (entry_scope='season', gameweek_id IS NULL — GE-4.5), same
// shape as LMS. predictor_fixture_picks span every gameweek predicted so
// far, fetched in full for the cumulative-score/history views.
export function usePredictorEntry(potId) {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['predictor-entry', potId, user?.id],
    enabled: !!user?.id && !!potId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('game_entries')
        .select(`
          *,
          game_entry_predictor(total_points, exact_score_count, correct_scorer_count),
          predictor_fixture_picks(
            id, gameweek_id, fixture_id, predicted_home_score, predicted_away_score,
            goalscorer_player_id, points_awarded, is_exact_score, scorer_bonus_awarded, locked_at,
            fixtures(id, home_team:teams!home_team_id(id,name,short_name,crest_url), away_team:teams!away_team_id(id,name,short_name,crest_url), home_goals, away_goals, status),
            goalscorer:players(id, display_name)
          )
        `)
        .eq('pot_id', potId)
        .eq('user_id', user.id)
        .is('gameweek_id', null)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

// Fixtures in the given gameweek, for the "pick one fixture to predict"
// selector — mirrors PredictorEngine.validateEntry()'s own "fixture must
// belong to this gameweek" check.
export function useFixturesForGameweek(gameweekId) {
  return useQuery({
    queryKey: ['fixtures-for-gameweek', gameweekId],
    enabled: !!gameweekId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fixtures')
        .select(`
          id, kickoff_utc, status,
          home_team:teams!home_team_id(id, name, short_name, crest_url),
          away_team:teams!away_team_id(id, name, short_name, crest_url)
        `)
        .eq('gameweek_id', gameweekId)
        .order('kickoff_utc', { ascending: true })
      if (error) throw error
      return data ?? []
    },
  })
}

// Eligible goalscorer candidates for a fixture — mirrors
// PredictorEngine.validateEntry()'s own eligibility check (an active
// player_team_history row on either of the fixture's two teams). Optional
// pick, per GE-5.3 — the selector using this must always allow "no
// prediction" as a valid choice.
export function usePlayersForFixture(homeTeamId, awayTeamId) {
  return useQuery({
    queryKey: ['players-for-fixture', homeTeamId, awayTeamId],
    enabled: !!homeTeamId && !!awayTeamId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_team_history')
        .select('team_id, players(id, display_name, photo_url, position)')
        .eq('is_active', true)
        .in('team_id', [homeTeamId, awayTeamId])
      if (error) throw error
      return (data ?? [])
        .filter((row) => row.players)
        .map((row) => ({ ...row.players, team_id: row.team_id }))
        .sort((a, b) => a.display_name.localeCompare(b.display_name))
    },
  })
}

export function useGetOrCreatePredictorEntry() {
  const qc = useQueryClient()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async (potId) => {
      const { data, error } = await supabase.functions.invoke('get-or-create-predictor-entry', {
        body: { pot_id: potId },
      })
      if (error) throw await extractFunctionError(error)
      if (data?.error) throw new Error(data.error)
      return data.entry
    },
    onSuccess: (_entry, potId) => qc.invalidateQueries({ queryKey: ['predictor-entry', potId, user?.id] }),
  })
}

export function useSubmitPredictorPicks() {
  const qc = useQueryClient()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async ({ gameEntryId, gameweekId, fixtureId, predictedHomeScore, predictedAwayScore, goalscorerPlayerId, potId }) => {
      const { data, error } = await supabase.functions.invoke('submit-predictor-picks', {
        body: {
          game_entry_id: gameEntryId,
          gameweek_id: gameweekId,
          fixture_id: fixtureId,
          predicted_home_score: predictedHomeScore,
          predicted_away_score: predictedAwayScore,
          goalscorer_player_id: goalscorerPlayerId ?? null,
        },
      })
      if (error) throw await extractFunctionError(error)
      if (data?.error) throw new Error(data.error)
      return { pick: data.pick, potId }
    },
    onSuccess: ({ potId }) => {
      qc.invalidateQueries({ queryKey: ['predictor-entry', potId, user?.id] })
      qc.invalidateQueries({ queryKey: ['leaderboard', potId] })
    },
  })
}
