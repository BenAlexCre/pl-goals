import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, extractFunctionError } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

// Season-scoped (entry_scope='season', gameweek_id IS NULL — GE-4.5), one
// row for the whole competition, unlike Pick 5's per-gameweek entry. Picks
// (lms_team_picks) span every gameweek the player has ever submitted for,
// fetched in full here — the "previously used teams" journey item needs
// every past pick, not just the current gameweek's.
export function useLmsEntry(potId) {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['lms-entry', potId, user?.id],
    enabled: !!user?.id && !!potId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('game_entries')
        .select(`
          *,
          game_entry_lms(competitive_status, eliminated_gameweek_id),
          lms_team_picks(id, gameweek_id, team_id, result, locked_at, teams(id, name, short_name, crest_url))
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

// Teams with a fixture in the given gameweek — mirrors
// LmsEngine.validateEntry()'s own "team has a fixture in this gameweek"
// check (fixtures.home_team_id/away_team_id), so the picker only ever
// offers teams the server will actually accept.
export function useTeamsForGameweek(gameweekId) {
  return useQuery({
    queryKey: ['teams-for-gameweek', gameweekId],
    enabled: !!gameweekId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fixtures')
        .select(`
          id,
          home_team:teams!home_team_id(id, name, short_name, crest_url),
          away_team:teams!away_team_id(id, name, short_name, crest_url)
        `)
        .eq('gameweek_id', gameweekId)
      if (error) throw error

      const teams = []
      const seen = new Set()
      for (const fixture of data ?? []) {
        for (const team of [fixture.home_team, fixture.away_team]) {
          if (team && !seen.has(team.id)) {
            seen.add(team.id)
            teams.push(team)
          }
        }
      }
      return teams.sort((a, b) => a.name.localeCompare(b.name))
    },
  })
}

export function useGetOrCreateLmsEntry() {
  const qc = useQueryClient()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async (potId) => {
      const { data, error } = await supabase.functions.invoke('get-or-create-lms-entry', {
        body: { pot_id: potId },
      })
      if (error) throw await extractFunctionError(error)
      if (data?.error) throw new Error(data.error)
      return data.entry
    },
    onSuccess: (_entry, potId) => qc.invalidateQueries({ queryKey: ['lms-entry', potId, user?.id] }),
  })
}

export function useSubmitLmsPick() {
  const qc = useQueryClient()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async ({ gameEntryId, gameweekId, teamId, potId }) => {
      const { data, error } = await supabase.functions.invoke('submit-lms-pick', {
        body: { game_entry_id: gameEntryId, gameweek_id: gameweekId, team_id: teamId },
      })
      if (error) throw await extractFunctionError(error)
      if (data?.error) throw new Error(data.error)
      return { pick: data.pick, potId }
    },
    onSuccess: ({ potId }) => {
      qc.invalidateQueries({ queryKey: ['lms-entry', potId, user?.id] })
      qc.invalidateQueries({ queryKey: ['leaderboard', potId] })
    },
  })
}
