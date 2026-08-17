import { ChevronDown } from 'lucide-react'
import Reveal from './Reveal'

const FAQS = [
  {
    q: 'How do I join a competition?',
    a: 'Ask the organiser for an invite link or code, or have them add you by username once you’ve created an account. Opening an invite link will prompt you to sign in or register if you haven’t already, then drop you straight into the pot.',
  },
  {
    q: 'Can I create multiple competitions?',
    a: 'Yes — you can create and belong to as many pots as you like, across any of the three game modes, all from the same account.',
  },
  {
    q: 'When do predictions lock?',
    a: 'Each gameweek has a single deadline, shortly before the earliest kickoff in that round. Once it passes, your picks for that gameweek can no longer be changed.',
  },
  {
    q: 'How are prizes calculated?',
    a: 'The prize pool is the entry fees collected for that competition, minus any admin or charity fee the organiser has configured, split according to the mode’s own rules — winner-takes-all, last player standing, or season leaderboard.',
  },
  {
    q: 'Can organisers record payments?',
    a: 'Yes. Organisers record payments as they’re received off-platform (cash, bank transfer, etc.) — the app never processes payments itself, it only tracks who’s paid for weekly or season-long pots.',
  },
]

export default function FAQSection() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-5 py-24 md:py-32">
      <Reveal className="text-center">
        <p className="text-sm font-semibold uppercase tracking-wider text-accent">FAQ</p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Questions, answered
        </h2>
      </Reveal>

      <div className="mt-12 space-y-3">
        {FAQS.map((item, i) => (
          <Reveal key={item.q} delay={i * 60}>
            <details className="group rounded-2xl border border-white/8 bg-surface-1 open:border-white/15">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 text-[15px] font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-accent">
                {item.q}
                <ChevronDown size={18} className="shrink-0 text-white/40 transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <p className="px-6 pb-5 text-[15px] leading-relaxed text-white/50">{item.a}</p>
            </details>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
