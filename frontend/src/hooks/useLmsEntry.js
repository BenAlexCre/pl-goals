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

// Phase 10B, Part 3/4/10 — every entrant's pick history for this pot, in one
// query, for the LMS main page's "who picked what" view. Safe to read across
// members: lms_team_picks_select_member and game_entry_lms's own SELECT
// policy both already gate on is_pot_member(pot_id) (confirmed via pg_policy
// introspection before writing this), so this is a pure frontend addition —
// no RLS change, no new backend surface. Same season-scoped shape as
// useLmsEntry() above (gameweek_id IS NULL on game_entries), just across
// every entrant instead of the signed-in user only. currentGameweekId is
// applied client-side only (it doesn't change which rows are fetched, only
// which pick each entry reports as "current") so it isn't part of the query
// key.
export function useLmsCompetitionPicks(potId, currentGameweekId) {
  return useQuery({
    queryKey: ['lms-competition-picks', potId],
    enabled: !!potId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('game_entries')
        .select(`
          id,
          user_id,
          profiles!game_entries_user_id_fkey(id, username, display_name, avatar_url),
          game_entry_lms(competitive_status, eliminated_gameweek_id),
          lms_team_picks(id, gameweek_id, team_id, result, locked_at, teams(id, name, short_name, crest_url))
        `)
        .eq('pot_id', potId)
        .is('gameweek_id', null)
      if (error) throw error

      return (data ?? []).map((row) => {
        const picks = row.lms_team_picks ?? []
        return {
          userId: row.user_id,
          profile: row.profiles,
          competitiveStatus: row.game_entry_lms?.competitive_status ?? 'alive',
          eliminatedGameweekId: row.game_entry_lms?.eliminated_gameweek_id ?? null,
          picks,
          currentPick: currentGameweekId
            ? picks.find((p) => p.gameweek_id === currentGameweekId) ?? null
            : null,
        }
      })
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
