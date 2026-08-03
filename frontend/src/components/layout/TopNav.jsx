import { Link, NavLink, useLocation } from 'react-router-dom'
import { Home, Trophy, Users, User, Settings, LogOut } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import Avatar from '../ui/Avatar'

export default function TopNav() {
  const { profile, signOut } = useAuthStore()
  const location = useLocation()

  const links = [
    { to: '/dashboard', label: 'Dashboard', icon: Home },
    { to: '/pots', label: 'Pots', icon: Users },
    { to: '/profile', label: 'Profile', icon: User },
    { to: '/admin', label: 'Admin', icon: Settings },
  ]

  return (
    <header className="sticky top-0 z-40 border-b border-white/8 bg-black/30 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <Link to="/dashboard" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/10">
            <Trophy size={18} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">Golden-5</div>
            <div className="text-xs text-white/35">Private goals pots</div>
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

        <div className="flex items-center gap-3">
          <Link to="/profile" className="flex items-center gap-2 rounded-xl px-2 py-1 hover:bg-white/5">
            <Avatar name={profile?.full_name || profile?.username || 'User'} />
            <div className="hidden sm:block">
              <div className="text-sm text-white">
                {profile?.full_name || profile?.username || 'User'}
              </div>
              <div className="text-xs text-white/35">
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