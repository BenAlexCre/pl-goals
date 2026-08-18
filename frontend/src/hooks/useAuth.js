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

    return () => {
      mounted = false
      subscription.unsubscribe()
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