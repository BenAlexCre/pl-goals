import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, extractFunctionError } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

// Milestone 4 frontend cutover: reads game_entries + pick5_picks (the Game
// Engine schema) instead of the retired user_entries/user_entry_picks. Same
// exported names/shapes as before so PicksPage/GameweekPage need minimal
// changes — only the embedded relation name (pick5_picks, not
// user_entry_picks) and game_entries' status values (which reuse the exact
// same entry_status enum as user_entries, including 'void' as a status
// value rather than a separate is_void boolean) differ at the call sites.
export function useEntry(potId, gameweekId) {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['entry', potId, gameweekId, user?.id],
    enabled: !!user?.id && !!potId && !!gameweekId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('game_entries')
        .select(`
          *,
          pick5_picks(
            id, pick_position, player_id, goal_threshold, goals_scored, result,
            players(
              id, display_name, photo_url,
              player_team_history(
                is_active,
                teams(id, name, short_name, crest_url)
              )
            )
          )
        `)
        .eq('pot_id', potId)
        .eq('gameweek_id', gameweekId)
        .eq('user_id', user.id)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      return data ?? null
    },
  })
}

export function usePotEntries(potId, gameweekId) {
  return useQuery({
    queryKey: ['pot-entries', potId, gameweekId],
    enabled: !!potId && !!gameweekId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('game_entries')
        .select(`
          *,
          profiles(id, display_name, username, avatar_url),
          pick5_picks(
            id, pick_position, player_id, goal_threshold, goals_scored, result,
            players(id, display_name, photo_url)
          )
        `)
        .eq('pot_id', potId)
        .eq('gameweek_id', gameweekId)
      if (error) throw error
      return data ?? []
    },
    refetchInterval: 30_000,
  })
}

// Returns a map of player_id → appearance status for all fixtures in a gameweek
export function useFixturePlayerStatuses(gameweekId) {
  return useQuery({
    queryKey: ['player-statuses', gameweekId],
    enabled: !!gameweekId,
    staleTime: 30_000,
    queryFn: async () => {
      // Get all fixture IDs for the gameweek first
      const { data: fixtures, error: fxError } = await supabase
        .from('fixtures')
        .select('id')
        .eq('gameweek_id', gameweekId)

      if (fxError) throw fxError

      const fixtureIds = (fixtures ?? []).map(f => f.id)
      if (!fixtureIds.length) return new Map()

      const { data, error } = await supabase
        .from('fixture_player_status')
        .select('player_id, status, started, came_on_minute, went_off_minute, fixture_id')
        .in('fixture_id', fixtureIds)

      if (error) throw error

      // Priority: sub_on > sub_off > starting > bench
      const priority = { sub_on: 4, sub_off: 3, starting: 2, bench: 1, not_in_squad: 0 }
      const map = new Map()

      for (const row of data ?? []) {
        const existing = map.get(row.player_id)
        const currentPriority = priority[row.status] ?? 0
        const existingPriority = existing ? (priority[existing.status] ?? 0) : -1

        if (currentPriority > existingPriority) {
          map.set(row.player_id, row)
        }
      }

      return map
    },
  })
}

// Replaces the direct user_entries/user_entry_picks writes with the two
// Game Engine Edge Functions: get-or-create-pick5-entry (idempotent —
// returns the existing row if one's already there) then submit-pick5-picks,
// which runs Pick5Engine.validateEntry() server-side (exact-5 count,
// eligibility, goalkeeper exclusion) before writing pick5_picks. This is a
// real correctness improvement, not just a table swap — the old path had no
// server-side validation at all, only the client-side eligibility check
// below, which validateEntry() now makes redundant (it returns a more
// specific error per-player), so it isn't duplicated here.
export function useSubmitPicks() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ potId, gameweekId, picks }) => {
      if (picks.length !== 5)
        throw new Error('You must select exactly 5 picks.')

      const { data: gw } = await supabase
        .from('gameweeks')
        .select('deadline_utc')
        .eq('id', gameweekId)
        .single()
      if (!gw) throw new Error('Gameweek not found.')
      if (new Date(gw.deadline_utc) <= new Date())
        throw new Error('The deadline has passed. Picks are now locked.')

      const { data: entryData, error: entryError } = await supabase.functions.invoke(
        'get-or-create-pick5-entry',
        { body: { pot_id: potId, gameweek_id: gameweekId } }
      )
      if (entryError) throw await extractFunctionError(entryError)
      if (entryData?.error) throw new Error(entryData.error)

      const { data: picksData, error: picksError } = await supabase.functions.invoke(
        'submit-pick5-picks',
        {
          body: {
            game_entry_id: entryData.entry.id,
            player_ids: picks.map((p) => p.player_id),
          },
        }
      )
      if (picksError) throw await extractFunctionError(picksError)
      if (picksData?.error) throw new Error(picksData.error)

      return entryData.entry
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['entry', vars.potId, vars.gameweekId] })
      qc.invalidateQueries({ queryKey: ['pot-entries', vars.potId, vars.gameweekId] })
      qc.invalidateQueries({ queryKey: ['leaderboard', vars.potId] })
    },
  })
}