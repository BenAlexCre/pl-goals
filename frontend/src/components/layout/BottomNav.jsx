import { NavLink } from 'react-router-dom'
import { Home, User, Settings } from 'lucide-react'
import { useIsAdmin } from '../../hooks/useAdmin'

export default function BottomNav() {
  // Launch Readiness Sprint 1A — hiding the link is a small, additional
  // layer on top of AdminRoute's real protection (App.jsx), never a
  // substitute for it — the route itself blocks a non-admin regardless of
  // whether this link is visible.
  const { isAdmin } = useIsAdmin()

  const links = [
    { to: '/dashboard', label: 'Home', icon: Home },
    { to: '/profile', label: 'Profile', icon: User },
    ...(isAdmin ? [{ to: '/admin', label: 'Admin', icon: Settings }] : []),
  ]

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass border-t border-white/5 safe-area-pb">
      <div className={`grid ${links.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 py-3 text-[11px] transition-colors ${
                isActive ? 'text-accent' : 'text-white/35'
              }`
            }
          >
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
