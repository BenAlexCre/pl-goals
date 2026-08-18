import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, Users, Shield, ScrollText, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'

// Phase 8D, Part 12 — dedicated Super Admin area, not stuffed into the
// ordinary pot-admin pages (AdminDashboard/AdminPayments/AdminRollovers,
// which stay exactly as they were). Demo Centre isn't duplicated here —
// this links out to the existing /admin/demo, now gated to super_admin
// (SuperAdminRoute in App.jsx), per this session's explicit decision.
const TABS = [
  { to: '/super-admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/super-admin/users', label: 'Users', icon: Users },
  { to: '/super-admin/roles', label: 'Roles', icon: Shield },
  { to: '/super-admin/audit', label: 'Audit log', icon: ScrollText },
]

export default function SuperAdminLayout() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Super Admin</h1>
          <p className="text-sm text-white/40">Platform-wide administration — not visible to app_admin or pot admins.</p>
        </div>
        <Link to="/admin/demo" className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-surface-3 px-3 py-2 text-sm text-white hover:bg-surface-4">
          <Sparkles size={15} />
          Demo Centre
        </Link>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b border-white/8 pb-px">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              [
                'inline-flex items-center gap-2 whitespace-nowrap rounded-t-lg px-4 py-2.5 text-sm transition',
                isActive ? 'border-b-2 border-accent text-white' : 'text-white/50 hover:text-white',
              ].join(' ')
            }
          >
            <tab.icon size={15} />
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  )
}
