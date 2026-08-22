import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { useIsAdmin, useIsSuperAdmin } from './hooks/useAdmin'
import AppShell from './components/layout/AppShell'
import Landing from './pages/Landing'
import SignIn from './pages/auth/SignIn'
import SignUp from './pages/auth/SignUp'
import ForgotPassword from './pages/auth/ForgotPassword'
import ResetPassword from './pages/auth/ResetPassword'
import VerifyEmail from './pages/auth/VerifyEmail'
import Dashboard from './pages/Dashboard'
import PotDetail from './pages/PotDetail'
import GameweekPage from './pages/GameweekPage'
import PicksPage from './pages/PicksPage'
import AdminDashboard from './pages/AdminDashboard'
import AdminPayments from './pages/AdminPayments'
import AdminRollovers from './pages/AdminRollovers'
import DemoCentre from './pages/admin/DemoCentre'
import DemoGameweek from './pages/admin/DemoGameweek'
import SuperAdminLayout from './pages/super-admin/SuperAdminLayout'
import SuperAdminOverview from './pages/super-admin/Overview'
import SuperAdminUsers from './pages/super-admin/Users'
import SuperAdminUserDetail from './pages/super-admin/UserDetail'
import SuperAdminRoles from './pages/super-admin/Roles'
import SuperAdminAuditLog from './pages/super-admin/AuditLog'
import Standings from './pages/Standings'
import Profile from './pages/Profile'
import NotFound from './pages/NotFound'
import NotAuthorized from './pages/NotAuthorized'
import ToastContainer from './components/ui/ToastContainer'
import Spinner from './components/ui/Spinner'
import PotManager from './components/pot/PotManager'
import PotDetailPage from './pages/PotDetail'
import PotManage from './pages/pot/PotManage'
import JoinPot from './pages/JoinPot'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-pitch-950">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!user) return <Navigate to="/sign-in" replace />

  return children
}

// Launch Readiness Sprint 1A — Security & Authorisation (2026-08-10,
// resolves ISSUE-9). Every /admin/* route previously sat behind
// ProtectedRoute alone (signed-in required) with no admin check at all —
// any authenticated player could navigate straight to /admin/payments or
// /admin/rollovers. This is frontend defense-in-depth only, never the
// actual authorization boundary — every admin Edge Function and RLS
// policy underneath still enforces its own check regardless of whether
// this guard exists ("the backend remains the source of truth").
// Re-checks !user even though this is always nested inside
// ProtectedRoute today — cheap insurance against this guard someday being
// used somewhere ProtectedRoute doesn't already wrap.
function AdminRoute() {
  const { user, loading: authLoading } = useAuth()
  const { isAdmin, isLoading: adminLoading } = useIsAdmin()

  if (authLoading || (!!user && adminLoading)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-pitch-950">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!user) return <Navigate to="/sign-in" replace />
  if (!isAdmin) return <NotAuthorized />

  return <Outlet />
}

// Phase 8D, Part 11 — tightened from app_admin to super_admin only, a
// deliberate decision confirmed with the user this session (previously
// AppAdminRoute/useIsAppAdmin(); Demo Centre generates/destroys real-shaped
// data at will, which belongs with platform ownership, not general
// operational admin duties). Also used for the new /super-admin/* area
// itself, below.
function SuperAdminRoute() {
  const { user, loading: authLoading } = useAuth()
  const isSuperAdmin = useIsSuperAdmin()

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-pitch-950">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!user) return <Navigate to="/sign-in" replace />
  if (!isSuperAdmin) return <NotAuthorized />

  return <Outlet />
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/sign-up" element={<SignUp />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        {/* Live-review fix (item 14) — recovery-link landing page.
            resetPasswordForEmail()'s redirectTo now points here (was
            /sign-in, where a recovering user had a live session but no
            way to actually set a new password). */}
        <Route path="/reset-password" element={<ResetPassword />} />
        {/* Public — enable_confirmations = true (config.toml) means signUp()
            never returns a session, so a freshly-registered visitor lands
            here signed out. Also reachable while signed in (the
            UnverifiedBanner's "Verify now" link) — VerifyEmail.jsx itself
            handles both via useAuth(). */}
        <Route path="/verify-email" element={<VerifyEmail />} />
        {/* Public: a real invite link must work for a signed-out visitor,
            not just an existing member — see JoinPot.jsx's own note. */}
        <Route path="/join" element={<JoinPot />} />
        <Route path="/join/:inviteCode" element={<JoinPot />} />

        <Route
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/pots" element={<PotManager />} />
          <Route path="/pot/:potId" element={<PotDetail />} />
          <Route path="/pot/:potId/manage" element={<PotManage />} />
          <Route path="/pot/:potId/gameweek/:gameweekId" element={<GameweekPage />} />
          <Route path="/pot/:potId/picks" element={<PicksPage />} />
          <Route path="/standings" element={<Standings />} />
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/payments" element={<AdminPayments />} />
            <Route path="/admin/rollovers" element={<AdminRollovers />} />
          </Route>
          <Route element={<SuperAdminRoute />}>
            <Route path="/admin/demo" element={<DemoCentre />} />
            <Route path="/admin/demo/gameweek" element={<DemoGameweek />} />
            <Route path="/super-admin" element={<SuperAdminLayout />}>
              <Route index element={<SuperAdminOverview />} />
              <Route path="users" element={<SuperAdminUsers />} />
              <Route path="users/:userId" element={<SuperAdminUserDetail />} />
              <Route path="roles" element={<SuperAdminRoles />} />
              <Route path="audit" element={<SuperAdminAuditLog />} />
            </Route>
          </Route>
          <Route path="/profile" element={<Profile />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
      <ToastContainer />
    </>
  )
}