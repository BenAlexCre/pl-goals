import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { supabase } from '../lib/supabase'
import { useQuery } from '@tanstack/react-query'

export function useAuth() {
  const { user, profile, setUser, setProfile } = useAuthStore()
  // Remediation (F4, red-team audit) — `loading` used to live only in the
  // shared authStore, but useAuth() is mounted independently by every route
  // guard (ProtectedRoute/AdminRoute/SuperAdminRoute/JoinPot), each with its
  // own mount/unmount lifecycle. A guard that mounts AFTER an earlier guard
  // already finished its check (e.g. sign-in redirecting into /dashboard
  // right after an unauthenticated visit had already resolved loading:false
  // elsewhere) read that stale, cross-mount `false` on its very first
  // render — before its own getSession() call had even started — and
  // briefly rendered "not authenticated" off of leftover data. Reproduced
  // live: repeated sign-in attempts right after an in-SPA redirect to
  // /sign-in visibly thrashed between /dashboard and /sign-in for ~2s before
  // settling. `initializing` is local `useState`, so it is guaranteed to
  // start `true` on every fresh mount regardless of what any other guard's
  // lifecycle already did to the shared store.
  const [initializing, setInitializing] = useState(true)

  useEffect(() => {
    let mounted = true
    setInitializing(true)

    // Phase 13 — ISSUE-55's second occurrence of the same bug class.
    // getSession() can also reject rather than resolve — its own docs
    // (auth-js GoTrueClient) note it may trigger a network refresh
    // internally, and that refresh call is exactly what a transient
    // GoTrue<->Postgres connectivity failure (confirmed live in this
    // environment's own auth logs) would break. With no `.catch()`,
    // `setInitializing(false)` was never reached on failure, leaving
    // ProtectedRoute's spinner spinning forever with no error and no way
    // out. Failing to `user: null` on a session-restore error is the
    // correct safe default — it sends the visitor to sign in again
    // rather than leaving them stuck, and never grants access on an
    // error (fails closed, not open).
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (!mounted) return
        setUser(session?.user ?? null)
        setInitializing(false)
      })
      .catch((err) => {
        console.error('Failed to restore session', err)
        if (!mounted) return
        setUser(null)
        setInitializing(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      setUser(session?.user ?? null)
      setInitializing(false)
    })

    // Remediation (D2, red-team audit) — app_metadata.role (super_admin/
    // app_admin) is embedded in the access token at mint time; a role
    // change made by an admin in a DIFFERENT browser session has no way to
    // reach this tab except the access token's own natural expiry/refresh
    // cycle (up to ~1hr). Server-side authorization is already correct and
    // unaffected either way (every Edge Function re-validates against live
    // DB state via getUser(), not a decoded claim) — this is purely a UI-
    // freshness improvement: refreshing on tab-focus means a revoked/
    // changed role is reflected in THIS tab's nav/route guards within one
    // focus event instead of silently waiting out the rest of the token's
    // lifetime, without polling or a new push channel.
    function refreshOnFocus() {
      if (document.visibilityState !== 'visible') return
      supabase.auth.refreshSession().catch((err) => {
        console.error('Session refresh on focus failed', err)
      })
    }
    document.addEventListener('visibilitychange', refreshOnFocus)
    window.addEventListener('focus', refreshOnFocus)

    return () => {
      mounted = false
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', refreshOnFocus)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [setUser])

  useQuery({
    queryKey: ['profile', user?.id],
    enabled: !!user,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()

      if (error) throw error

      setProfile(data ?? null)
      return data ?? null
    },
  })

  return { user, profile, loading: initializing }
}