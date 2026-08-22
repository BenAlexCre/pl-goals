import { Link, NavLink, useNavigate } from 'react-router-dom'
import { Home, Trophy, Users, User, Settings, LogOut, Bell, ShieldCheck } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { useUiStore } from '../../store/uiStore'
import { useNotifications } from '../../hooks/useNotifications'
import { useOwnsAnyPot, useIsSuperAdmin } from '../../hooks/useAdmin'
import Avatar from '../ui/Avatar'
import NotificationPanel from '../notifications/NotificationPanel'
import { resolveDisplayName } from '../../utils/format'

export default function TopNav() {
  const { profile, signOut } = useAuthStore()
  const navigate = useNavigate()

  // Phase 10B, Part 16 — was leaving the user on /sign-in, which
  // ProtectedRoute's own redirect only produces because the route they
  // signed out FROM happened to require auth; signing out is a
  // deliberate exit, not a login prompt, so it should land on the public
  // landing page instead.
  async function handleSignOut() {
    await signOut()
    navigate('/')
  }
  const openDrawer = useUiStore((s) => s.openDrawer)
  const { data: notifications = [] } = useNotifications()
  const unreadCount = notifications.filter((n) => !n.read_at).length
  // Phase 10B, Part 22 — was useIsAdmin() (app_admin OR any pot's admin);
  // now pot-ownership only (useOwnsAnyPot()), per the explicit "don't use
  // is_app_admin for this" instruction. AdminRoute (App.jsx) itself is
  // unchanged — still admits any app_admin regardless of pot ownership —
  // so this is visibility only, same "small additional layer, never the
  // real protection" precedent as before.
  const { data: ownsAnyPot } = useOwnsAnyPot()
  const isSuperAdmin = useIsSuperAdmin()

  const links = [
    { to: '/dashboard', label: 'Dashboard', icon: Home },
    { to: '/pots', label: 'Pots', icon: Users },
    { to: '/profile', label: 'Profile', icon: User },
    ...(ownsAnyPot ? [{ to: '/admin', label: 'Admin', icon: Settings }] : []),
    // Phase 8D, Part 13 — distinct from "Admin" above: shown only to a true
    // Super Admin, never to a plain app_admin or pot admin, regardless of
    // whether they also see the "Admin" link.
    ...(isSuperAdmin ? [{ to: '/super-admin', label: 'Super Admin', icon: ShieldCheck }] : []),
  ]

  return (
    // Mobile nav/header audit — was `bg-black/30 backdrop-blur-xl`: Tailwind's
    // backdrop-blur-* utility only emits the unprefixed `backdrop-filter`,
    // with no `-webkit-backdrop-filter` fallback. On any real mobile
    // browser/WebView where the unprefixed property isn't supported (older
    // Android WebViews, some Samsung Internet configurations/data-saver
    // modes) — exactly the devices that would need the prefix — the blur
    // silently never applies, leaving only a 30%-opaque black tint over an
    // already near-black page background: visually indistinguishable from
    // the header not rendering at all. BottomNav.jsx already solved this
    // exact problem with its own `.glass` utility (index.css) — 75% base
    // opacity plus both the prefixed and unprefixed backdrop-filter — this
    // just reuses that same, already-correct utility instead of TopNav's
    // separate, lower-opacity, unprefixed-only styling.
    <header className="glass sticky top-0 z-40 border-b border-white/8">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <Link to="/dashboard" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/10">
            <Trophy size={18} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">PL Predictor</div>
          </div>
        </Link>

        {/* Phase 10B — ISSUE-50 fix: min-w-0 lets this row actually shrink
            (a flex item defaults to min-width:auto, refusing to shrink
            below its own content) instead of forcing the page wider once
            five links (Dashboard/Pots/Profile/Admin/Super Admin) don't
            fit at once — confirmed live at 768px for a pot-owning
            super_admin. overflow-x-auto is the fallback if it still
            doesn't fit at very narrow desktop widths: the nav scrolls
            internally rather than the whole page. */}
        <nav className="hidden md:flex min-w-0 items-center gap-1 overflow-x-auto lg:gap-2">
          {links.map((link) => {
            const Icon = link.icon
            return (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  [
                    'inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm transition lg:gap-2 lg:px-4',
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
              found live at 768px: a long identity value had no width bound
              at all, so this cluster forced the whole page wider than the
              viewport instead of the header's own flex row absorbing it.
              Phase 25 — resolveDisplayName() (utils/format.js) replaces
              the naive `display_name || username` fallback here: some
              accounts have `display_name` equal to their email (the
              signup default before one is explicitly set), which this
              header would otherwise show verbatim on every route.
              Phase 25 (live review) — the second line here used to render
              `location.pathname` as a lightweight "current page" indicator
              (e.g. "/super-admin/users"). Removed: on any pot route that's
              literally `/pot/<uuid>/...` — a raw UUID surfacing in the one
              piece of UI whose whole job is showing the user's identity,
              exactly the "ID shown where a name belongs" bug this phase is
              fixing, even though it sat next to (not instead of) the real
              resolved name. Nothing else in the app depended on this route
              breadcrumb (confirmed by grep — TopNav was the only consumer
              of `location`/`location.pathname` in the whole frontend). */}
          <Link to="/profile" className="flex min-w-0 items-center gap-2 rounded-xl px-2 py-1 hover:bg-white/5">
            <Avatar user={profile} />
            <div className="hidden min-w-0 sm:block">
              <div className="max-w-[160px] truncate text-sm text-white">
                {resolveDisplayName(profile) || 'User'}
              </div>
            </div>
          </Link>

          <button
            type="button"
            onClick={handleSignOut}
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