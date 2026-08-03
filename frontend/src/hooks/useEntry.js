import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export function useEntry(potId, gameweekId) {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['entry', potId, gameweekId, user?.id],
    enabled: !!user?.id && !!potId && !!gameweekId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_entries')
        .select(`
          *,
          user_entry_picks(
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
        .from('user_entries')
        .select(`
          *,
          profiles(id, display_name, username, avatar_url),
          user_entry_picks(
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

export function useSubmitPicks() {
  const qc = useQueryClient()
  const { user } = useAuthStore()

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

      const playerIds = picks.map(p => p.player_id)
      const { data: valid } = await supabase
        .from('available_players_by_gameweek')
        .select('player_id')
        .eq('gameweek_id', gameweekId)
        .in('player_id', playerIds)

      const validSet = new Set((valid ?? []).map(p => p.player_id))
      const invalid = playerIds.filter(id => !validSet.has(id))
      if (invalid.length > 0)
        throw new Error('One or more selected players have no fixture this gameweek.')

      const { data: entry, error: entryErr } = await supabase
        .from('user_entries')
        .upsert(
          {
            pot_id: potId,
            user_id: user.id,
            gameweek_id: gameweekId,
            submitted_at: new Date().toISOString(),
            status: 'pending',
            is_void: false,
          },
          { onConflict: 'pot_id,user_id,gameweek_id' }
        )
        .select()
        .single()
      if (entryErr) throw entryErr

      await supabase.from('user_entry_picks').delete().eq('entry_id', entry.id)

      const { error: pickErr } = await supabase.from('user_entry_picks').insert(
        picks.map((p, i) => ({
          entry_id: entry.id,
          player_id: p.player_id,
          pick_position: i + 1,
        }))
      )
      if (pickErr) throw pickErr

      return entry
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['entry', vars.potId, vars.gameweekId] })
      qc.invalidateQueries({ queryKey: ['pot-entries', vars.potId, vars.gameweekId] })
      qc.invalidateQueries({ queryKey: ['leaderboard', vars.potId] })
    },
  })
}