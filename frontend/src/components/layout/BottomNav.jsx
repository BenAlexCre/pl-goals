import { NavLink } from 'react-router-dom'
import { Home, User, Settings, ShieldCheck } from 'lucide-react'
import { useOwnsAnyPot, useIsSuperAdmin } from '../../hooks/useAdmin'

export default function BottomNav() {
  // Phase 10B, Part 22 — was useIsAdmin() (app_admin OR any pot's admin);
  // now pot-ownership only, matching TopNav.jsx's identical change. See
  // that file's comment — AdminRoute itself is unchanged, this is
  // visibility only.
  const { data: ownsAnyPot } = useOwnsAnyPot()
  // Phase 9E — the same Super Admin link TopNav.jsx already has (Phase 8D,
  // Part 13), just missing here on mobile until now.
  const isSuperAdmin = useIsSuperAdmin()

  const links = [
    { to: '/dashboard', label: 'Home', icon: Home },
    { to: '/profile', label: 'Profile', icon: User },
    ...(ownsAnyPot ? [{ to: '/admin', label: 'Admin', icon: Settings }] : []),
    ...(isSuperAdmin ? [{ to: '/super-admin', label: 'Super Admin', icon: ShieldCheck }] : []),
  ]

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass border-t border-white/5 safe-area-pb">
      <div className={`grid ${links.length === 4 ? 'grid-cols-4' : links.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
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
