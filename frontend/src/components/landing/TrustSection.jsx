import { Eye, Lock, Radar, ShieldCheck, Trophy, Zap } from 'lucide-react'
import Reveal from './Reveal'

const POINTS = [
  { icon: Lock, title: 'Private competitions', text: 'Every pot is invite-only — nothing you play is ever public.' },
  { icon: ShieldCheck, title: 'Secure accounts', text: 'Standard email/password auth with row-level security on every table.' },
  { icon: Radar, title: 'Live Premier League data', text: 'Real fixtures, real results, synced automatically every gameweek.' },
  { icon: Zap, title: 'Automatic scoring', text: 'Every pick is scored the moment results come in — no manual step.' },
  { icon: Eye, title: 'Transparent standings', text: 'Every member sees the same live leaderboard, ranked the same way.' },
  { icon: Trophy, title: 'Reliable prize tracking', text: 'Payouts are calculated and recorded automatically once a pot settles.' },
]

export default function TrustSection() {
  return (
    <section className="relative overflow-hidden border-y border-white/6 bg-surface-1/40 px-5 py-24 md:py-28">
      <div className="pointer-events-none absolute left-1/2 top-0 h-full w-full max-w-6xl -translate-x-1/2 bg-[radial-gradient(circle_at_30%_20%,rgba(0,230,118,0.05),transparent_55%)]" aria-hidden="true" />

      <div className="relative mx-auto max-w-6xl">
        <Reveal className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent">Built to be trusted</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            The boring stuff, done right
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {POINTS.map(({ icon: Icon, title, text }, i) => (
            <Reveal key={title} delay={i * 70} className="flex gap-4">
              <Icon size={20} className="mt-0.5 shrink-0 text-accent" />
              <div>
                <h3 className="text-[15px] font-semibold text-white">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-white/45">{text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
