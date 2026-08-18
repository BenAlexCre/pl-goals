// Landing page only. Realistic, in-brand UI mockups built from plain
// Tailwind markup — no screenshots, no image assets, no new dependencies.
// Deliberately not the real PotDetail/GameweekPage/AdminPayments components:
// those are data-driven and would need live pots/fixtures to render
// anything meaningful. These are static, purpose-built stand-ins that reuse
// the same visual language (surface colors, accent green, badge shapes) so
// they read as "the real product," not a generic template mockup.

import { Bell, CheckCircle2, Radio, Trophy } from 'lucide-react'

export function BrowserFrame({ children, className = '' }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-surface-1 shadow-card overflow-hidden ${className}`}>
      <div className="flex items-center gap-1.5 border-b border-white/6 bg-surface-2/60 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
      </div>
      {children}
    </div>
  )
}

export function PhoneFrame({ children, className = '' }) {
  return (
    <div className={`w-[220px] rounded-[2rem] border-[6px] border-surface-3 bg-pitch-950 shadow-card overflow-hidden ${className}`}>
      <div className="mx-auto mt-1.5 h-1 w-10 rounded-full bg-white/15" />
      <div className="px-3 pb-4 pt-2">{children}</div>
    </div>
  )
}

const FIXTURES = [
  { home: 'Arsenal', away: 'Chelsea', score: '2 – 1', minute: "67'", live: true },
  { home: 'Man City', away: 'Liverpool', score: '0 – 0', minute: "34'", live: true },
  { home: 'Newcastle', away: 'Spurs', score: 'KO 17:30', minute: null, live: false },
]

export function FixtureListMock({ className = '' }) {
  return (
    <div className={`space-y-2 p-4 ${className}`}>
      {FIXTURES.map((f) => (
        <div key={f.home} className="flex items-center justify-between rounded-xl border border-white/6 bg-surface-2/70 px-3.5 py-2.5">
          <div className="flex items-center gap-2 text-sm text-white/80">
            <span className="font-medium">{f.home}</span>
            <span className="text-white/30">vs</span>
            <span className="font-medium">{f.away}</span>
          </div>
          <div className="flex items-center gap-2">
            {f.live && (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-goal/30 bg-red-goal/15 px-2 py-0.5 text-[10px] font-semibold text-red-goal">
                <Radio size={9} className="animate-pulse" /> {f.minute}
              </span>
            )}
            <span className="tabular text-sm font-semibold text-white">{f.score}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

const LEADERBOARD = [
  { rank: 1, name: 'Sam O.', points: 41, delta: '+5' },
  { rank: 2, name: 'You', points: 38, delta: '+2', you: true },
  { rank: 3, name: 'Priya K.', points: 36, delta: '+1' },
  { rank: 4, name: 'Josh M.', points: 29, delta: null },
]

export function LeaderboardMock({ className = '' }) {
  return (
    <div className={`space-y-1.5 p-4 ${className}`}>
      {LEADERBOARD.map((row) => (
        <div
          key={row.rank}
          className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 ${
            row.you ? 'border border-accent/30 bg-accent/10' : 'border border-white/6 bg-surface-2/70'
          }`}
        >
          <span className={`w-5 text-center text-xs font-bold tabular ${row.rank === 1 ? 'text-amber' : 'text-white/40'}`}>
            {row.rank}
          </span>
          <span className={`h-7 w-7 shrink-0 rounded-full ${row.you ? 'bg-accent/25' : 'bg-surface-3'}`} />
          <span className={`flex-1 truncate text-sm ${row.you ? 'font-semibold text-white' : 'text-white/75'}`}>{row.name}</span>
          {row.delta && <span className="text-[11px] font-medium text-accent">{row.delta}</span>}
          <span className="tabular text-sm font-bold text-white">{row.points}</span>
        </div>
      ))}
    </div>
  )
}

export function PredictionCardMock({ className = '' }) {
  return (
    <div className={`p-4 ${className}`}>
      <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-white/35">Your prediction</p>
      <div className="rounded-xl border border-white/6 bg-surface-2/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-white/85">Liverpool</span>
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-sm font-bold tabular text-accent">2</span>
        </div>
        <div className="my-2.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-white/25">
          <span className="h-px flex-1 bg-white/8" /> vs <span className="h-px flex-1 bg-white/8" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-white/85">Man City</span>
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-sm font-bold tabular text-accent">1</span>
        </div>
      </div>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="mt-3 w-full cursor-default rounded-xl bg-accent px-4 py-2.5 text-center text-sm font-semibold text-pitch-950"
      >
        Lock in prediction
      </button>
    </div>
  )
}

export function NotificationMock({ className = '' }) {
  return (
    <div className={`flex items-start gap-3 rounded-xl border border-accent/20 bg-surface-1 p-3.5 shadow-card ${className}`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
        <Trophy size={16} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-white">You won €840.00 in Friday Night Pool</p>
        <p className="mt-0.5 text-xs text-white/40">Gameweek 12 · settled just now</p>
      </div>
      <Bell size={14} className="ml-auto mt-1 shrink-0 text-white/25" />
    </div>
  )
}

const PAYMENTS = [
  { name: 'Amara O.', status: 'paid' },
  { name: 'Dan R.', status: 'paid' },
  { name: 'Liam F.', status: 'unpaid' },
]

export function AdminPaymentsMock({ className = '' }) {
  return (
    <div className={`space-y-2 p-4 ${className}`}>
      {PAYMENTS.map((p) => (
        <div key={p.name} className="flex items-center justify-between rounded-xl border border-white/6 bg-surface-2/70 px-3.5 py-2.5">
          <span className="text-sm text-white/80">{p.name}</span>
          {p.status === 'paid' ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/15 px-2.5 py-0.5 text-[11px] font-medium text-accent">
              <CheckCircle2 size={11} /> Paid
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-red-goal/30 bg-red-goal/15 px-2.5 py-0.5 text-[11px] font-medium text-red-goal">
              Unpaid
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
