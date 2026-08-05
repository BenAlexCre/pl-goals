import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, extractFunctionError } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

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

// --- Payment Verification (ISSUE-6) -----------------------------------
//
// Uses supabase.functions.invoke() + extractFunctionError(), not
// useAdminAction()'s raw fetch() pattern above — that pattern only sends
// an Authorization header, which Kong 401s locally (missing apikey);
// invoke() attaches it automatically. Documented already on
// hooks/usePick5Entry.js; not fixed here either, since fixing
// useAdminAction()/useTriggerSync() would touch AdminDashboard.jsx's
// existing "Manual jobs" feature, out of scope for this workflow.

// Pots where the current user is a pot admin — the set this workflow lets
// them manage payments for through this page. An app admin can still
// verify payments for ANY pot by name via CSV import (admin-actions'
// bulk_verify_payments authorizes app admins for every resolved pot,
// independent of membership) — this list only drives the page's own pot
// selector, which (like every other page in this app) can only show pots
// the signed-in user is actually a member of, per RLS.
export function usePotsForAdmin() {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['pots-for-admin', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pots')
        .select('id, name, season_id, league_id, pot_members!inner(role)')
        .eq('pot_members.user_id', user.id)
        .eq('pot_members.role', 'admin')
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })
}

export function useGameweeksForPot(seasonId, leagueId) {
  return useQuery({
    queryKey: ['gameweeks-for-pot', seasonId, leagueId],
    enabled: !!seasonId && !!leagueId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gameweeks')
        .select('id, number, name, status, is_current, deadline_utc')
        .eq('season_id', seasonId)
        .eq('league_id', leagueId)
        .order('number')
      if (error) throw error
      return data ?? []
    },
  })
}

// Every pot member's payment status for one pot+gameweek — the "entries
// awaiting verification" view. Based on pot_members, not game_entries: an
// admin can verify payment before a member has even submitted picks
// (matches mark_paid's existing behavior, which has never required an
// entry to exist first).
export function usePaymentStatus(potId, gameweekId) {
  return useQuery({
    queryKey: ['payment-status', potId, gameweekId],
    enabled: !!potId && !!gameweekId,
    queryFn: async () => {
      const { data: members, error: membersError } = await supabase
        .from('pot_members')
        .select('user_id, role, profiles(id, display_name, username)')
        .eq('pot_id', potId)
      if (membersError) throw membersError

      const { data: payments, error: paymentsError } = await supabase
        .from('entry_payments')
        .select('user_id, is_paid, marked_at, notes')
        .eq('pot_id', potId)
        .eq('gameweek_id', gameweekId)
        .eq('scope', 'gameweek')
      if (paymentsError) throw paymentsError

      const paymentByUser = new Map((payments ?? []).map((p) => [p.user_id, p]))

      return (members ?? []).map((m) => {
        const payment = paymentByUser.get(m.user_id)
        return {
          user_id: m.user_id,
          display_name: m.profiles?.display_name,
          username: m.profiles?.username,
          is_paid: payment?.is_paid ?? false,
          has_record: !!payment,
          marked_at: payment?.marked_at ?? null,
          notes: payment?.notes ?? null,
        }
      })
    },
  })
}

export function useMarkPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ action, potId, userId, gameweekId }) => {
      const { data, error } = await supabase.functions.invoke('admin-actions', {
        body: { action, pot_id: potId, user_id: userId, gameweek_id: gameweekId },
      })
      if (error) throw await extractFunctionError(error)
      if (data?.error) throw new Error(data.error)
      return data
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['payment-status', vars.potId, vars.gameweekId] })
    },
  })
}

// dryRun: true previews (validates + resolves + reports what would happen,
// writes nothing); dryRun: false applies it. Same shape either way — see
// supabase/functions/admin-actions/bulkPayments.ts.
export function useBulkVerifyPayments() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ potId, gameweekId, rows, dryRun }) => {
      const { data, error } = await supabase.functions.invoke('admin-actions', {
        body: { action: 'bulk_verify_payments', gameweek_id: gameweekId, rows, dry_run: dryRun },
      })
      if (error) throw await extractFunctionError(error)
      if (data?.error) throw new Error(data.error)
      return data
    },
    onSuccess: (_data, vars) => {
      if (!vars.dryRun) {
        qc.invalidateQueries({ queryKey: ['payment-status', vars.potId, vars.gameweekId] })
      }
    },
  })
}