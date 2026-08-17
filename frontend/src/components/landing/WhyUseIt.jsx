import { Layers, Lock, RefreshCw, Wallet } from 'lucide-react'
import Reveal from './Reveal'

const REASONS = [
  {
    icon: Lock,
    title: 'Private competitions',
    text: 'Invite-only pots for friends, family and work — nothing public, nothing visible to anyone outside your group.',
  },
  {
    icon: RefreshCw,
    title: 'Automated scoring',
    text: 'No spreadsheets, no manual tracking. Picks, scores and standings all update themselves as real matches happen.',
  },
  {
    icon: Layers,
    title: 'Multiple prediction formats',
    text: 'Pick 5, Last Man Standing, or Score Predictor — three genuinely different ways to play, in the same app.',
  },
  {
    icon: Wallet,
    title: 'Payment tracking',
    text: 'Organisers record payments as they come in, off-platform — built for both weekly and season-long competitions.',
  },
]

export default function WhyUseIt() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-5 py-24 md:py-32">
      <Reveal className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-wider text-accent">Why people use it</p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Everything a real competition needs
        </h2>
      </Reveal>

      <div className="mt-14 grid gap-5 sm:grid-cols-2">
        {REASONS.map(({ icon: Icon, title, text }, i) => (
          <Reveal key={title} delay={i * 90}>
            <div className="flex h-full gap-5 rounded-2xl border border-white/8 bg-surface-1 p-6 transition-colors duration-300 hover:border-white/15">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-surface-3 text-accent">
                <Icon size={19} />
              </div>
              <div>
                <h3 className="font-semibold text-white">{title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-white/50">{text}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
