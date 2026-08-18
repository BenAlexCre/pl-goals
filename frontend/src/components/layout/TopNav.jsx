import { Link, NavLink, useLocation } from 'react-router-dom'
import { Home, Trophy, Users, User, Settings, LogOut, Bell, ShieldCheck } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { useUiStore } from '../../store/uiStore'
import { useNotifications } from '../../hooks/useNotifications'
import { useIsAdmin, useIsSuperAdmin } from '../../hooks/useAdmin'
import Avatar from '../ui/Avatar'
import NotificationPanel from '../notifications/NotificationPanel'

export default function TopNav() {
  const { profile, signOut } = useAuthStore()
  const location = useLocation()
  const openDrawer = useUiStore((s) => s.openDrawer)
  const { data: notifications = [] } = useNotifications()
  const unreadCount = notifications.filter((n) => !n.read_at).length
  // Launch Readiness Sprint 1A — hiding the link is a small, additional
  // layer on top of AdminRoute's real protection (App.jsx), never a
  // substitute for it — the route itself blocks a non-admin regardless of
  // whether this link is visible.
  const { isAdmin } = useIsAdmin()
  const isSuperAdmin = useIsSuperAdmin()

  const links = [
    { to: '/dashboard', label: 'Dashboard', icon: Home },
    { to: '/pots', label: 'Pots', icon: Users },
    { to: '/profile', label: 'Profile', icon: User },
    ...(isAdmin ? [{ to: '/admin', label: 'Admin', icon: Settings }] : []),
    // Phase 8D, Part 13 — distinct from "Admin" above: shown only to a true
    // Super Admin, never to a plain app_admin or pot admin, regardless of
    // whether they also see the "Admin" link.
    ...(isSuperAdmin ? [{ to: '/super-admin', label: 'Super Admin', icon: ShieldCheck }] : []),
  ]

  return (
    <header className="sticky top-0 z-40 border-b border-white/8 bg-black/30 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <Link to="/dashboard" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/10">
            <Trophy size={18} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">PL Predictor</div>
          </div>
        </Link>

        <nav className="hidden md:flex items-center gap-2">
          {links.map((link) => {
            const Icon = link.icon
            return (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  [
                    'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition',
                    isActive
                      ? 'bg-white/10 text-white'
                      : 'text-white/60 hover:bg-white/5 hover:text-white',
                  ].join(' ')
                }
              >
                <Icon size={16} />
                {link.label}
              </NavLink>
            )
          })}
        </nav>

        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => openDrawer(<NotificationPanel />)}
            aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
            className="relative rounded-xl p-2 text-white/65 hover:bg-white/5 hover:text-white"
          >
            <Bell size={18} />
            {unreadCount > 0 ? (
              <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-pitch-950">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            ) : null}
          </button>

          {/* Phase 8D, Part 16 — min-w-0 + truncate fixes a real overflow
              found live at 768px: an email-as-display-name (the default
              for an account created before display_name was required) plus
              a long pathname like /super-admin/users had no width bound at
              all, so this cluster forced the whole page wider than the
              viewport instead of the header's own flex row absorbing it.
              Confirmed via getBoundingClientRect() before this fix, not
              assumed — the wide Super Admin Users table itself was not the
              cause (its own overflow-x-auto card correctly contained it). */}
          <Link to="/profile" className="flex min-w-0 items-center gap-2 rounded-xl px-2 py-1 hover:bg-white/5">
            <Avatar name={profile?.display_name || profile?.username || 'User'} />
            <div className="hidden min-w-0 sm:block">
              <div className="max-w-[160px] truncate text-sm text-white">
                {profile?.display_name || profile?.username || 'User'}
              </div>
              <div className="max-w-[160px] truncate text-xs text-white/35">
                {location.pathname}
              </div>
            </div>
          </Link>

          <button
            type="button"
            onClick={signOut}
            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/65 hover:bg-white/5 hover:text-white"
          >
            <LogOut size={16} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </header>
  )
}