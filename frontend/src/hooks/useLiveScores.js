import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useLiveScores(gameweekId, potId) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!gameweekId) return

    const channel = supabase
      .channel(`live-${gameweekId}-${potId ?? 'global'}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'fixtures' },
        () => {
          qc.invalidateQueries({ queryKey: ['gameweek', gameweekId] })
        }
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'fixture_events' },
        () => {
          qc.invalidateQueries({ queryKey: ['gameweek', gameweekId] })
          qc.invalidateQueries({ queryKey: ['pot-entries', potId, gameweekId] })
        }
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'fixture_player_status' },
        () => {
          qc.invalidateQueries({ queryKey: ['gameweek', gameweekId] })
          qc.invalidateQueries({ queryKey: ['pot-entries', potId, gameweekId] })
          qc.invalidateQueries({ queryKey: ['player-statuses', gameweekId] })
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pick5_picks' },
        () => {
          qc.invalidateQueries({ queryKey: ['entry'] })
          qc.invalidateQueries({ queryKey: ['pot-entries', potId, gameweekId] })
          qc.invalidateQueries({ queryKey: ['leaderboard', potId] })
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [gameweekId, potId, qc])
}