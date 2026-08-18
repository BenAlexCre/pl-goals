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
          // Phase 8C — Match Centre's own derived-stat hooks (useMatchCentre.js)
          // were never invalidated by this channel before, so they'd sit stale
          // for up to their own staleTime during any live/demo gameweek. No
          // specific IDs are known here, so these invalidate by key prefix
          // (matches every instance), same pattern as ['entry'] below.
          qc.invalidateQueries({ queryKey: ['league-standings'] })
          qc.invalidateQueries({ queryKey: ['team-form'] })
          qc.invalidateQueries({ queryKey: ['team-home-away-record'] })
          qc.invalidateQueries({ queryKey: ['player-profile'] })
          qc.invalidateQueries({ queryKey: ['team-next-fixtures'] })
          qc.invalidateQueries({ queryKey: ['player-season-stats'] })
          qc.invalidateQueries({ queryKey: ['player-recent-appearances'] })
          qc.invalidateQueries({ queryKey: ['head-to-head'] })
          // Phase 9 — Demo Gameweek enhancement. Same "invalidate by key
          // prefix, no specific ID known here" pattern as the Match Centre
          // hooks above — a goal-affecting event is exactly when a demo
          // pot's pick-insight numbers (successful/failed picks) need to
          // reflect it. A no-op on every non-demo page, since these keys
          // are only ever populated while a demo session exists.
          qc.invalidateQueries({ queryKey: ['demo-pot-summaries'] })
          qc.invalidateQueries({ queryKey: ['demo-pick-insights'] })
        }
      )
      .on('postgres_changes',
        // Phase 8C — pot_standings_snapshots (what LmsEngine's/
        // PredictorEngine's generateStandings() writes) was never in the
        // realtime publication before this slice's migration added it, so
        // an LMS elimination or Predictor leaderboard change — real or
        // demo — never appeared live, only on next refetch/staleTime.
        { event: '*', schema: 'public', table: 'pot_standings_snapshots' },
        () => {
          qc.invalidateQueries({ queryKey: ['leaderboard', potId] })
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