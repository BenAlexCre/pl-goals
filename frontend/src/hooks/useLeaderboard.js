import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Milestone 4 frontend cutover: reads pot_standings_snapshots (written by
// Pick5Engine.generateStandings()) instead of the retired
// leaderboard_snapshots. Shape differs — score, not picks_won/picks_total;
// no is_overall flag (gameweek_id IS NULL already means overall, per
// GE-4.6); no is_void (a voided entry is never written to this table at
// all — excluded entirely, not flagged, per business-rules.md § Payment
// rules), so callers no longer need to branch on it.
export function useLeaderboard(potId, gameweekId = null) {
  return useQuery({
    queryKey: ['leaderboard', potId, gameweekId],
    enabled: !!potId,
    refetchInterval: 30_000,
    queryFn: async () => {
      let q = supabase
        .from('pot_standings_snapshots')
        .select('*, profiles(display_name, username, avatar_url)')
        .eq('pot_id', potId)
        .order('rank', { ascending: true })

      if (gameweekId) {
        q = q.eq('gameweek_id', gameweekId)
      } else {
        q = q.is('gameweek_id', null)
      }

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })
}