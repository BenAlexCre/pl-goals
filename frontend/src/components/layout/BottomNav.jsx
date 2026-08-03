import { NavLink } from 'react-router-dom'
import { Home, User, Settings } from 'lucide-react'

const links = [
  { to: '/dashboard', label: 'Home', icon: Home },
  { to: '/profile', label: 'Profile', icon: User },
  { to: '/admin', label: 'Admin', icon: Settings },
]

export default function BottomNav() {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass border-t border-white/5 safe-area-pb">
      <div className="grid grid-cols-3">
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