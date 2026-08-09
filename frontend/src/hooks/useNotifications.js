import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

// GE-4.8: notifications is a shared, mode-agnostic inbox — one row per
// domain event (pick5.prize_awarded, lms.prize_awarded,
// predictor.prize_awarded, ...), written server-side only by each
// engine's notifyUsers(). RLS (notifications_select_own) already scopes
// this to the caller's own rows; no pot_id filter needed here since this
// is a cross-pot inbox, not a per-pot view.
export function useNotifications() {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['notifications', user?.id],
    enabled: !!user?.id,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, pot_id, type, payload, read_at, created_at, pots(name)')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data ?? []
    },
  })
}

// RLS (notifications_update_own + the read_at-only column grant) already
// restricts this to the caller's own rows and to the read_at column alone
// — no client-side authorization logic to duplicate here.
export function useMarkNotificationRead() {
  const qc = useQueryClient()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async (notificationId) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', notificationId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', user?.id] }),
  })
}
