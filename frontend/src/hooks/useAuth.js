import { useEffect } from 'react'
import { useAuthStore } from '../store/authStore'
import { supabase } from '../lib/supabase'
import { useQuery } from '@tanstack/react-query'

export function useAuth() {
  const { user, profile, loading, setUser, setProfile, setLoading } = useAuthStore()

  useEffect(() => {
    let mounted = true

    // Phase 13 — ISSUE-55's second occurrence of the same bug class.
    // getSession() can also reject rather than resolve — its own docs
    // (auth-js GoTrueClient) note it may trigger a network refresh
    // internally, and that refresh call is exactly what a transient
    // GoTrue<->Postgres connectivity failure (confirmed live in this
    // environment's own auth logs) would break. With no `.catch()`,
    // `setLoading(false)` was never reached on failure, leaving
    // ProtectedRoute's spinner spinning forever with no error and no way
    // out. Failing to `user: null` on a session-restore error is the
    // correct safe default — it sends the visitor to sign in again
    // rather than leaving them stuck, and never grants access on an
    // error (fails closed, not open).
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (!mounted) return
        setUser(session?.user ?? null)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to restore session', err)
        if (!mounted) return
        setUser(null)
        setLoading(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setLoading(false)
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
  }, [setUser, setLoading])

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

  return { user, profile, loading }
}