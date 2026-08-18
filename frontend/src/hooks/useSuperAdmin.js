import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, extractFunctionError } from '../lib/supabase'

// Phase 8D, Part 7/12 — thin wrappers around the super-admin-actions Edge
// Function, same supabase.functions.invoke() + extractFunctionError()
// pattern useDemo.js already established (not the raw fetch() pattern
// useAdmin.js's older hooks use — invoke() attaches the apikey header
// automatically, which Kong requires locally).

async function callSuperAdminAction(body) {
  const { data, error } = await supabase.functions.invoke('super-admin-actions', { body })
  if (error) throw await extractFunctionError(error)
  if (data?.error) throw new Error(data.error)
  return data
}

export function useOverviewStats() {
  return useQuery({
    queryKey: ['super-admin', 'overview'],
    queryFn: () => callSuperAdminAction({ action: 'overview_stats' }),
  })
}

export function useUserSearch(search) {
  return useQuery({
    queryKey: ['super-admin', 'users', search],
    queryFn: () => callSuperAdminAction({ action: 'list_users', search }),
  })
}

export function useInspectUser(targetUserId) {
  return useQuery({
    queryKey: ['super-admin', 'user', targetUserId],
    enabled: !!targetUserId,
    queryFn: () => callSuperAdminAction({ action: 'inspect_user', target_user_id: targetUserId }),
  })
}

export function useAuditLog(limit = 50) {
  return useQuery({
    queryKey: ['super-admin', 'audit-log', limit],
    queryFn: () => callSuperAdminAction({ action: 'list_audit_log', limit }),
  })
}

function useSuperAdminMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: callSuperAdminAction,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['super-admin'] })
    },
  })
}

export function useBanUser() {
  const mutation = useSuperAdminMutation()
  return {
    ...mutation,
    mutate: ({ targetUserId, reason }) => mutation.mutate({ action: 'ban_user', target_user_id: targetUserId, reason }),
    mutateAsync: ({ targetUserId, reason }) => mutation.mutateAsync({ action: 'ban_user', target_user_id: targetUserId, reason }),
  }
}

export function useUnbanUser() {
  const mutation = useSuperAdminMutation()
  return {
    ...mutation,
    mutate: ({ targetUserId }) => mutation.mutate({ action: 'unban_user', target_user_id: targetUserId }),
    mutateAsync: ({ targetUserId }) => mutation.mutateAsync({ action: 'unban_user', target_user_id: targetUserId }),
  }
}

export function useSetAppAdmin() {
  const mutation = useSuperAdminMutation()
  return {
    ...mutation,
    mutate: ({ targetUserId, grant }) => mutation.mutate({ action: grant ? 'grant_app_admin' : 'revoke_app_admin', target_user_id: targetUserId }),
    mutateAsync: ({ targetUserId, grant }) => mutation.mutateAsync({ action: grant ? 'grant_app_admin' : 'revoke_app_admin', target_user_id: targetUserId }),
  }
}
