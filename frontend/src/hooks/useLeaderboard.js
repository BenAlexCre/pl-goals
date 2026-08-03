import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useLeaderboard(potId, gameweekId = null) {
  return useQuery({
    queryKey: ['leaderboard', potId, gameweekId],
    enabled: !!potId,
    refetchInterval: 30_000,
    queryFn: async () => {
      let q = supabase
        .from('leaderboard_snapshots')
        .select('*, profiles(display_name, username, avatar_url)')
        .eq('pot_id', potId)
        .order('rank', { ascending: true })

      if (gameweekId) {
        q = q.eq('gameweek_id', gameweekId)
      } else {
        q = q.is('gameweek_id', null).eq('is_overall', true)
      }

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })
}