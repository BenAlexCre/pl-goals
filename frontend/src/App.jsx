import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { useIsAdmin } from './hooks/useAdmin'
import AppShell from './components/layout/AppShell'
import Landing from './pages/Landing'
import SignIn from './pages/auth/SignIn'
import SignUp from './pages/auth/SignUp'
import ForgotPassword from './pages/auth/ForgotPassword'
import Dashboard from './pages/Dashboard'
import PotDetail from './pages/PotDetail'
import GameweekPage from './pages/GameweekPage'
import PicksPage from './pages/PicksPage'
import AdminDashboard from './pages/AdminDashboard'
import AdminPayments from './pages/AdminPayments'
import AdminRollovers from './pages/AdminRollovers'
import Profile from './pages/Profile'
import NotFound from './pages/NotFound'
import NotAuthorized from './pages/NotAuthorized'
import ToastContainer from './components/ui/ToastContainer'
import Spinner from './components/ui/Spinner'
import PotManager from './components/pot/PotManager'
import PotDetailPage from './pages/PotDetail'
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

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/sign-up" element={<SignUp />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
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
          <Route path="/pot/:potId/gameweek/:gameweekId" element={<GameweekPage />} />
          <Route path="/pot/:potId/picks" element={<PicksPage />} />
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/payments" element={<AdminPayments />} />
            <Route path="/admin/rollovers" element={<AdminRollovers />} />
          </Route>
          <Route path="/profile" element={<Profile />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
      <ToastContainer />
    </>
  )
}