import { NavLink } from 'react-router-dom'
import { Home, Users, User, Settings, ShieldCheck } from 'lucide-react'
import { useOwnsAnyPot, useIsSuperAdmin } from '../../hooks/useAdmin'

// Tailwind only emits classes it can see as literal strings, so the column
// count is looked up rather than interpolated.
const GRID_COLS = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5' }

export default function BottomNav() {
  // Phase 10B, Part 22 — was useIsAdmin() (app_admin OR any pot's admin);
  // now pot-ownership only, matching TopNav.jsx's identical change. See
  // that file's comment — AdminRoute itself is unchanged, this is
  // visibility only.
  const { data: ownsAnyPot } = useOwnsAnyPot()
  // Phase 9E — the same Super Admin link TopNav.jsx already has (Phase 8D,
  // Part 13), just missing here on mobile until now.
  const isSuperAdmin = useIsSuperAdmin()

  // Mobile audit (2026-11-02) — shown below lg (phones AND tablets): at
  // 768-1023px TopNav's five labelled links plus the account cluster did not
  // fit (labels clipped/wrapped). Tablets are touch devices, so they get this
  // bar and TopNav switches to its link row at lg.
  //
  // "Pots" was also missing here (TopNav's links were `hidden md:flex`), so
  // on a phone /pots (pot list, create pot, join by
  // code) was only reachable through Dashboard cards. This bar now mirrors
  // TopNav's destinations one-for-one. `label` is the short form that fits a
  // 5-column bar at 320px; `ariaLabel` keeps the full name for assistive tech.
  const links = [
    { to: '/dashboard', label: 'Home', icon: Home },
    { to: '/pots', label: 'Pots', icon: Users },
    { to: '/profile', label: 'Profile', icon: User },
    ...(ownsAnyPot ? [{ to: '/admin', label: 'Admin', icon: Settings }] : []),
    ...(isSuperAdmin ? [{ to: '/super-admin', label: 'Super', ariaLabel: 'Super Admin', icon: ShieldCheck }] : []),
  ]

  return (
    <nav aria-label="Primary" className="lg:hidden fixed bottom-0 left-0 right-0 z-50 glass border-t border-white/5 safe-area-pb">
      <div className={`grid ${GRID_COLS[links.length]}`}>
        {links.map(({ to, label, ariaLabel, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            aria-label={ariaLabel}
            className={({ isActive }) =>
              `flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-1 py-2 text-[11px] transition-colors ${
                isActive ? 'text-accent' : 'text-white/50'
              }`
            }
          >
            <Icon size={20} aria-hidden="true" />
            <span className="max-w-full truncate px-1">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
