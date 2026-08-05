import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
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
import Profile from './pages/Profile'
import NotFound from './pages/NotFound'
import ToastContainer from './components/ui/ToastContainer'
import Spinner from './components/ui/Spinner'
import PotManager from './components/pot/PotManager'
import PotDetailPage from './pages/PotDetail'

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

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/sign-up" element={<SignUp />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />

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
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/payments" element={<AdminPayments />} />
          <Route path="/profile" element={<Profile />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
      <ToastContainer />
    </>
  )
}