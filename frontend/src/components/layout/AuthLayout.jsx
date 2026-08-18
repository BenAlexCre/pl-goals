import { Link } from 'react-router-dom'
import { Trophy } from 'lucide-react'
import Card from '../ui/Card'

// Phase 8D, Part 1/14 — the one shared shell for every authentication
// screen (Sign In, Sign Up, Forgot Password, Verify Email). Previously
// SignIn.jsx was a standalone prototype with its own inline styles/colors,
// visibly different from SignUp.jsx/ForgotPassword.jsx (which already used
// Card/Tailwind) — same card width/position/background/typography/spacing
// for all four now, by construction, not by keeping four files' Tailwind
// classes manually in sync.
export default function AuthLayout({ eyebrow = 'PL Predictor', title, subtitle, children }) {
  return (
    <div className="min-h-screen bg-pitch-950 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10">
            <Trophy size={20} className="text-white" />
          </div>
          <span className="text-[15px] font-bold tracking-tight text-white">{eyebrow}</span>
        </Link>

        <Card className="p-6">
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-white/40">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
        </Card>
      </div>
    </div>
  )
}
