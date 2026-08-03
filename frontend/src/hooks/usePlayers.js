import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useAvailablePlayers(gameweekId, search = '') {
  return useQuery({
    queryKey: ['players', 'available', gameweekId, search],
    enabled: !!gameweekId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      let q = supabase
        .from('available_players_by_gameweek')
        .select('*')
        .eq('gameweek_id', gameweekId)
        .order('display_name')
        .limit(150)

      if (search.trim().length >= 2) {
        q = q.ilike('display_name', `%${search.trim()}%`)
      }

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })
}