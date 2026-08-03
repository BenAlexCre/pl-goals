import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useSyncLogs() {
  return useQuery({
    queryKey: ['sync-logs'],
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sync_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data ?? []
    },
  })
}

export function useAdminAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ action, potId, ...rest }) => {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-actions`,
        {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ action, pot_id: potId, ...rest }),
        }
      )
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? 'Admin action failed')
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pot'] })
      qc.invalidateQueries({ queryKey: ['entry'] })
      qc.invalidateQueries({ queryKey: ['leaderboard'] })
    },
  })
}

export function useTriggerSync(functionName) {
  return useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`,
        {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ triggered_by: 'manual' }),
        }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Sync failed')
      return json
    },
  })
}