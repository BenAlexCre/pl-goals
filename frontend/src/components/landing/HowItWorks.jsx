import { Trophy, UserPlus, Zap } from 'lucide-react'
import Reveal from './Reveal'

const STEPS = [
  {
    icon: UserPlus,
    title: 'Create or join a private competition',
    text: 'Set up a pot in seconds and invite people by link or username — or join one you’ve been invited to.',
  },
  {
    icon: Zap,
    title: 'Submit your predictions before kickoff',
    text: 'Pick five goalscorers, choose a team to survive the gameweek, or predict exact scorelines — picks lock automatically at deadline.',
  },
  {
    icon: Trophy,
    title: 'Watch scores, standings and prizes update automatically',
    text: 'Live goal events, standings, and prize payouts all update themselves as real matches happen — nobody touches a spreadsheet.',
  },
]

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-6xl px-5 py-24 md:py-32">
      <Reveal className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-wider text-accent">How it works</p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          From kickoff to payout, in three steps
        </h2>
      </Reveal>

      <div className="mt-16 grid gap-10 md:grid-cols-3 md:gap-8">
        {STEPS.map(({ icon: Icon, title, text }, i) => (
          <Reveal key={title} delay={i * 120} className="relative">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10 text-accent">
              <Icon size={20} />
            </div>
            <p className="mt-5 text-xs font-bold tabular text-white/25">STEP {i + 1}</p>
            <h3 className="mt-2 text-lg font-semibold text-white">{title}</h3>
            <p className="mt-2.5 text-[15px] leading-relaxed text-white/50">{text}</p>
            {i < STEPS.length - 1 && (
              <div className="absolute right-[-1.25rem] top-6 hidden h-px w-8 bg-gradient-to-r from-white/15 to-transparent md:block" aria-hidden="true" />
            )}
          </Reveal>
        ))}
      </div>
    </section>
  )
}
