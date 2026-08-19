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
        .select('id, name, game_type, season_id, league_id, entry_fee, pot_members!inner(role)')
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

// Phase 7 Stage 2 Slice 4 — a pot's member list with no gameweek
// dependency, so "Record payment received" (which allocates across
// multiple future gameweeks, not one) doesn't force the organiser to
// select an arbitrary gameweek first just to see who to record a payment
// for. usePaymentStatus below stays gameweek-scoped for its own
// per-gameweek table.
export function usePotMembers(potId) {
  return useQuery({
    queryKey: ['pot-members', potId],
    enabled: !!potId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pot_members')
        .select('user_id, role, profiles(id, display_name, username)')
        .eq('pot_id', potId)
      if (error) throw error
      return (data ?? []).map((m) => ({
        user_id: m.user_id,
        display_name: m.profiles?.display_name || m.profiles?.username || 'User',
        username: m.profiles?.username || 'unknown',
      }))
    },
  })
}

// Every pot member's payment status — the "entries awaiting verification"
// view. Based on pot_members, not game_entries: an admin can verify
// payment before a member has even submitted picks (matches mark_paid's
// existing behavior, which has never required an entry to exist first).
//
// gameType, added Phase 7 Stage 2 Slice 4: also resolves each member's
// game_entries.status/reinstated_at, so the table can offer "Reinstate
// entry" (ISSUE-36 — ties admin-actions' existing reinstate_entry to a UI
// for the first time) exactly where it's decidable: a void entry whose
// payment is now marked paid. Pick 5's entry is gameweek-scoped; LMS's/
// Predictor's is season-scoped (gameweek_id null) — same GE-4.5 split
// reinstate.ts's own lookup already makes.
//
// Launch Readiness Sprint 1B (resolves ISSUE-35): gameweekId is now only
// required for Pick 5 — LMS/Score Predictor have exactly one payment for
// the whole season (scope='season', gameweek_id null), so there's no
// per-gameweek table to select first for them at all.
export function usePaymentStatus(potId, gameweekId, gameType) {
  const isPick5 = gameType === 'pick5'
  return useQuery({
    queryKey: ['payment-status', potId, gameweekId, gameType],
    enabled: !!potId && !!gameType && (!isPick5 || !!gameweekId),
    queryFn: async () => {
      const { data: members, error: membersError } = await supabase
        .from('pot_members')
        .select('user_id, role, profiles(id, display_name, username)')
        .eq('pot_id', potId)
      if (membersError) throw membersError

      let paymentsQuery = supabase
        .from('entry_payments')
        .select('user_id, is_paid, marked_at, notes')
        .eq('pot_id', potId)
        .eq('scope', isPick5 ? 'gameweek' : 'season')
      paymentsQuery = isPick5 ? paymentsQuery.eq('gameweek_id', gameweekId) : paymentsQuery.is('gameweek_id', null)
      const { data: payments, error: paymentsError } = await paymentsQuery
      if (paymentsError) throw paymentsError

      let entriesQuery = supabase.from('game_entries').select('user_id, status, reinstated_at').eq('pot_id', potId)
      entriesQuery = isPick5 ? entriesQuery.eq('gameweek_id', gameweekId) : entriesQuery.is('gameweek_id', null)
      const { data: entries, error: entriesError } = await entriesQuery
      if (entriesError) throw entriesError

      const paymentByUser = new Map((payments ?? []).map((p) => [p.user_id, p]))
      const entryByUser = new Map((entries ?? []).map((e) => [e.user_id, e]))

      return (members ?? []).map((m) => {
        const payment = paymentByUser.get(m.user_id)
        const entry = entryByUser.get(m.user_id)
        return {
          user_id: m.user_id,
          display_name: m.profiles?.display_name,
          username: m.profiles?.username,
          is_paid: payment?.is_paid ?? false,
          has_record: !!payment,
          marked_at: payment?.marked_at ?? null,
          entry_status: entry?.status ?? null,
          reinstated_at: entry?.reinstated_at ?? null,
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

// Product rule revision, 2026-08-09, corrected 2026-08-10 (docs/decisions.md
// § Pick 5 jackpot and season rollover, rules 6-7: Payments / Admin payment
// workflow) — "Record payment received": the organiser enters an amount
// already received off-platform, and the app allocates it automatically to
// that many future unpaid Pick 5 gameweeks. dryRun: true (the default)
// previews the allocation (how many weeks, which ones) without writing
// anything, so the UI can show "£25 received. This will mark 5 future
// weeks as paid." before the organiser confirms — same dry-run/confirm
// shape as useBulkVerifyPayments below. No new payment status query is
// needed here: the invalidation below refreshes payment-status for
// whichever gameweek is currently selected, same as useMarkPayment.
export function useRecordPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ potId, userId, amount, dryRun = true }) => {
      const { data, error } = await supabase.functions.invoke('admin-actions', {
        body: { action: 'record_payment', pot_id: potId, user_id: userId, amount, dry_run: dryRun },
      })
      if (error) throw await extractFunctionError(error)
      if (data?.error) throw new Error(data.error)
      return data
    },
    onSuccess: (_data, vars) => {
      if (!vars.dryRun) {
        qc.invalidateQueries({ queryKey: ['payment-status', vars.potId] })
      }
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

// Phase 7 Stage 2 Slice 4 — Rollover management. No admin-actions call, no
// new Edge Function: `pots` already has RLS UPDATE policies letting a pot
// admin (or app admin) update their own pot directly (`pots_update_admin`,
// `admins can update their pots`), and neither `status` nor `name` is one
// of the three columns `prevent_pot_contract_change()` locks after
// creation (`rollover_source_pot_id`/`carry_over_amount`/
// `rollover_generation` only) — activating or renaming a draft rollover
// pot is a plain client update against the existing backend, not a new
// capability. "Do not redesign the backend" holds: nothing here is a
// GameEngine method or a new Edge Function action.
// rollover_source_pot_id's own name is resolved separately below, not
// embedded here — PostgREST cannot resolve a self-referencing embed
// (`pots!pots_rollover_source_pot_id_fkey` against the `pots` table
// itself) via its schema-cache relationship hint; confirmed live (a real
// 400 from the REST endpoint, "Could not find a relationship between
// 'pots' and 'pots'"), not a hypothetical concern.
const ROLLOVER_POT_SELECT = `
  id, name, status, game_type, created_by, entry_fee,
  admin_fee_type, admin_fee_amount, admin_fee_percentage,
  charity_fee_type, charity_fee_amount, charity_fee_percentage,
  carry_over_amount, rollover_generation, rollover_source_pot_id,
  wipeout_resolution, season_end_tie_rule,
  start_gameweek_id, end_gameweek_id,
  league:leagues!pots_league_id_fkey(id, name, country),
  season:seasons!pots_season_id_fkey(id, name, year_start, year_end),
  start_gameweek:gameweeks!pots_start_gameweek_id_fkey(id, number, name),
  end_gameweek:gameweeks!pots_end_gameweek_id_fkey(id, number, name)
`

// Draft rollover pots the current user can manage — a pot the Game Engine
// created automatically (rollover_source_pot_id set), still in draft. Two
// queries, merged and deduped by id, not one `.or()` filter: an app admin
// or pot-member-admin is found via `pot_members`, but a fresh Pick 5
// rollover pot's organiser is only ever guaranteed a `created_by` match
// (see decisions.md's note on Pick5Engine.createPick5RolloverPot() also
// now adding a pot_members row — this OR keeps working for any rollover
// pot created before that fix, or by a future engine change that again
// forgets to).
export function useDraftRolloverPots() {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['draft-rollover-pots', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const [byCreator, byMembership] = await Promise.all([
        supabase
          .from('pots')
          .select(ROLLOVER_POT_SELECT)
          .eq('status', 'draft')
          .not('rollover_source_pot_id', 'is', null)
          .eq('created_by', user.id),
        supabase
          .from('pots')
          .select(`${ROLLOVER_POT_SELECT}, pot_members!inner(role)`)
          .eq('status', 'draft')
          .not('rollover_source_pot_id', 'is', null)
          .eq('pot_members.user_id', user.id)
          .eq('pot_members.role', 'admin'),
      ])
      if (byCreator.error) throw byCreator.error
      if (byMembership.error) throw byMembership.error

      const byId = new Map()
      for (const pot of [...(byCreator.data ?? []), ...(byMembership.data ?? [])]) {
        byId.set(pot.id, pot)
      }
      const pots = [...byId.values()]

      // Resolves each source pot's own name for "rolled over from X" — a
      // separate query, not embedded (see ROLLOVER_POT_SELECT's own
      // comment on why the self-referencing embed doesn't work). The
      // source pot is always readable: rollover creation preserves
      // created_by from the source, so `users can view pots they belong
      // to`'s created_by = auth.uid() branch always covers it, regardless
      // of the source pot's own current status or membership.
      const sourceIds = [...new Set(pots.map((p) => p.rollover_source_pot_id).filter(Boolean))]
      let sourceNameById = new Map()
      if (sourceIds.length > 0) {
        const { data: sources, error: sourcesError } = await supabase.from('pots').select('id, name').in('id', sourceIds)
        if (sourcesError) throw sourcesError
        sourceNameById = new Map((sources ?? []).map((s) => [s.id, s.name]))
      }

      return pots
        .map((pot) => ({ ...pot, rollover_source_name: sourceNameById.get(pot.rollover_source_pot_id) ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },
  })
}

export function useRenamePot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ potId, name }) => {
      const { error } = await supabase.from('pots').update({ name }).eq('id', potId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['draft-rollover-pots'] })
      qc.invalidateQueries({ queryKey: ['pots-for-admin'] })
    },
  })
}

// Activation itself is the one-field flip (`status: 'draft' -> 'active'`);
// startGameweekId/endGameweekId let the organiser fill in the fields
// required-but-unset gap this same review found (LMS's rollover pot leaves
// both null on purpose — see decisions.md — the organiser sets them here,
// during the same review, rather than needing a second trip through some
// other pot-settings screen that doesn't exist).
export function useActivateRolloverPot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ potId, startGameweekId, endGameweekId }) => {
      const patch = { status: 'active' }
      if (startGameweekId !== undefined) patch.start_gameweek_id = startGameweekId
      if (endGameweekId !== undefined) patch.end_gameweek_id = endGameweekId
      const { error } = await supabase.from('pots').update(patch).eq('id', potId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['draft-rollover-pots'] })
      qc.invalidateQueries({ queryKey: ['pots-for-admin'] })
      qc.invalidateQueries({ queryKey: ['pots'] })
    },
  })
}

// ISSUE-36 — Late Payment Override has always had a working backend
// (admin-actions' reinstate_entry, docs/decisions.md § Late Payment
// Override) but no frontend trigger anywhere. Thin wrapper, same shape as
// useMarkPayment/useRecordPayment above — no new backend behavior.
export function useReinstateEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ potId, userId, gameweekId }) => {
      const { data, error } = await supabase.functions.invoke('admin-actions', {
        body: { action: 'reinstate_entry', pot_id: potId, user_id: userId, gameweek_id: gameweekId },
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

// Launch Readiness Sprint 1A — Security & Authorisation (2026-08-10,
// resolves ISSUE-9). Route-level admin gating needs a real "is this user
// an admin at all" signal — previously nothing in the frontend computed
// one, not even to hide the "Admin" nav link. Two ways to qualify, matching
// what the admin pages themselves actually require server-side:
//   - app_admin (`user.app_metadata.role`, already decoded client-side from
//     the session JWT — the same claim admin-actions/index.ts and the new
//     cron Edge Function auth check both read) — needed for AdminDashboard's
//     platform-wide "Manual jobs" (sync/compute/settle triggers, which the
//     backend now also gates on this exact claim).
//   - pot admin of at least one pot (`pot_members.role = 'admin'`) — needed
//     for AdminPayments/AdminRollovers, which are genuinely meant for any
//     pot organiser, not just platform admins; each page already scopes
//     its own content to pots the caller administers via existing RLS, so
//     this only blocks someone who administers nothing at all from
//     entering the admin section in the first place.
// This is intentionally the SAME "is this user any kind of admin" concept
// for the whole /admin/* subtree, applied by one route guard — the pages
// underneath still each enforce their own finer-grained authorization
// (per-pot for payments/rollovers, app_admin-only for Manual Jobs) exactly
// as before; this hook only answers "does this user have any legitimate
// reason to be here."
export function useIsAdmin() {
  const { user } = useAuthStore()
  // Phase 15, Part 14 — real gap found live during beta-hardening: this
  // check never accepted `super_admin` directly (unlike `is_app_admin()`,
  // the actual backend/RLS boundary two hooks below, and `useIsAppAdmin()`
  // right below that, both of which already treat super_admin as a
  // superset of app_admin). It only ever worked for a super_admin account
  // because they also happened to administer a pot, satisfying the
  // fallback query below. Removing the Super Admin's demo-linked pots
  // during this phase's cleanup surfaced the gap: with zero pots owned,
  // benalexcre@gmail.com was locked out of /admin (including Manual Jobs)
  // entirely. Widened to match the same pattern useIsAppAdmin() already
  // uses, not a new role concept.
  const isAppAdmin = user?.app_metadata?.role === 'app_admin' || user?.app_metadata?.role === 'super_admin'

  const potAdminQuery = useQuery({
    queryKey: ['has-pot-admin-membership', user?.id],
    enabled: !!user?.id && !isAppAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pot_members')
        .select('pot_id')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .limit(1)
      if (error) throw error
      return (data?.length ?? 0) > 0
    },
  })

  if (!user) return { isAdmin: false, isLoading: false }
  if (isAppAdmin) return { isAdmin: true, isLoading: false }
  return { isAdmin: potAdminQuery.data ?? false, isLoading: potAdminQuery.isLoading }
}

// Phase 10B, Part 22 — nav-link visibility only, deliberately distinct from
// useIsAdmin() above. useIsAdmin() (app_admin OR administers any pot) stays
// exactly as-is: it's the real AdminRoute authorization boundary, and a
// plain app_admin genuinely keeps their cross-pot /admin/payments CSV-verify
// capability regardless of whether they personally own a pot — that's not
// this hook's call to take away. This one answers a narrower, purely
// presentational question: "does the TopNav/BottomNav 'Admin' link make
// sense for this specific person" — which the user's own explicit
// instruction says should be pot ownership alone, not the app_admin claim.
// Hiding the link for an app_admin who owns nothing doesn't block them from
// typing the URL — AdminRoute (unchanged) still admits them, correctly.
export function useOwnsAnyPot() {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['owns-any-pot', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pot_members')
        .select('pot_id')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .limit(1)
      if (error) throw error
      return (data?.length ?? 0) > 0
    },
  })
}

// Phase 8C — extracted from useIsAdmin()'s conflated "app admin OR any pot's
// admin" check. Some surfaces (Demo Centre) are meant for true platform
// administrators only — a pot organiser who is nobody's app_admin must not
// see them, unlike the rest of /admin, which deliberately welcomes either.
// Reads the same app_metadata.role JWT claim useIsAdmin() already does; no
// new query, no new backend call.
export function useIsAppAdmin() {
  const { user } = useAuthStore()
  // Phase 8D — widened at the SQL level (is_app_admin(), migration 027) to
  // also accept super_admin, since Super Admin inherits every app_admin
  // capability. Mirrored here so this hook and the RLS/Edge Function checks
  // it gates the same surfaces for stay in agreement.
  return user?.app_metadata?.role === 'app_admin' || user?.app_metadata?.role === 'super_admin'
}

// Phase 8D — strict super_admin-only check, distinct from the widened
// useIsAppAdmin() above. Used for the Super Admin area and (per this
// session's explicit decision) Demo Centre, which must not admit a plain
// app_admin.
export function useIsSuperAdmin() {
  const { user } = useAuthStore()
  return user?.app_metadata?.role === 'super_admin'
}