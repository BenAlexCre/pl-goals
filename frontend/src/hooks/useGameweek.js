import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useCurrentGameweek() {
  return useQuery({
    queryKey: ['gameweek', 'current'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gameweeks')
        .select(`
          *,
          fixtures(
            *,
            home_team:teams!home_team_id(id, name, short_name, crest_url),
            away_team:teams!away_team_id(id, name, short_name, crest_url),
            fixture_events(
              id, player_id, team_id, event_type,
              minute, extra_minute, assist_player_id,
              is_own_goal, is_penalty
            )
          )
        `)
        .eq('is_current', true)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      return data ?? null
    },
  })
}

export function useGameweek(gameweekId) {
  return useQuery({
    queryKey: ['gameweek', gameweekId],
    enabled: !!gameweekId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gameweeks')
        .select(`
          *,
          fixtures(
            *,
            home_team:teams!home_team_id(id, name, short_name, crest_url),
            away_team:teams!away_team_id(id, name, short_name, crest_url),
            fixture_events(
              id, player_id, team_id, event_type,
              minute, extra_minute, assist_player_id,
              is_own_goal, is_penalty
            )
          )
        `)
        .eq('id', gameweekId)
        .single()
      if (error) throw error
      return data
    },
  })
}

export function useAllGameweeks() {
  return useQuery({
    queryKey: ['gameweeks', 'all'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gameweeks')
        .select('id, number, name, status, deadline_utc, is_current')
        .order('number')
      if (error) throw error
      return data ?? []
    },
  })
}