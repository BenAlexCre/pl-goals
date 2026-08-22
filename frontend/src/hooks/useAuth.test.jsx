import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import { useAuthStore } from '../store/authStore'
import { supabase } from '../lib/supabase'

// Remediation (F4, red-team audit) — regression test for the sign-in
// redirect race. Root cause: `loading` used to live in the shared authStore,
// which is a single global flag reused across every independent mount of
// useAuth() (ProtectedRoute/AdminRoute/SuperAdminRoute/JoinPot each mount
// their own instance as routes change). A guard mounting right after an
// earlier, unrelated guard had already resolved loading:false read that
// stale value on its own very first render — before its own getSession()
// call had even started — and briefly rendered "not authenticated" off
// leftover data. Reproduced live via Playwright: repeated sign-in attempts
// immediately after an in-SPA redirect to /sign-in visibly thrashed between
// /dashboard and /sign-in for ~2s before settling. The fix makes
// `initializing` local `useState` (see useAuth.js), guaranteed to start
// `true` on every fresh mount regardless of any other mount's history.
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      refreshSession: vi.fn(() => Promise.resolve()),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
    })),
  },
}))

function wrapper({ children }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useAuth (F4 sign-in redirect race fix)', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, profile: null })
    vi.clearAllMocks()
    supabase.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  })

  it('starts loading:true on mount and only resolves once its own getSession() call completes', async () => {
    let resolveSession
    supabase.auth.getSession.mockReturnValue(new Promise((resolve) => { resolveSession = resolve }))

    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.loading).toBe(true)

    resolveSession({ data: { session: { user: { id: 'u1' } } } })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toEqual({ id: 'u1' })
  })

  it('a freshly-mounted guard starts loading:true even though a PRIOR, independent mount already settled to no-user', async () => {
    // First guard instance mounts and completes with no session — this is
    // the exact precondition that used to poison the shared `loading` flag
    // for whatever mounts next.
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } })
    const first = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(first.result.current.loading).toBe(false))
    expect(first.result.current.user).toBeNull()
    first.unmount()

    // Second, independent guard mounts (e.g. ProtectedRoute right after a
    // successful sign-in). Its own getSession() call is still in flight.
    let resolveSecond
    supabase.auth.getSession.mockReturnValue(new Promise((resolve) => { resolveSecond = resolve }))
    const second = renderHook(() => useAuth(), { wrapper })

    // The bug: this used to read the first mount's leftover loading:false
    // and briefly report "not authenticated" before its own check ran.
    expect(second.result.current.loading).toBe(true)

    resolveSecond({ data: { session: { user: { id: 'u2' } } } })
    await waitFor(() => expect(second.result.current.loading).toBe(false))
    expect(second.result.current.user).toEqual({ id: 'u2' })
  })
})
