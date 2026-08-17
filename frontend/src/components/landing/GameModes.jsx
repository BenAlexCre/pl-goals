import { Crosshair, ShieldCheck, Target } from 'lucide-react'
import Reveal from './Reveal'

const MODES = [
  {
    icon: Target,
    name: 'Pick 5',
    tagline: 'Weekly',
    description: 'Pick five goalscorers every gameweek. Get all five right and win the jackpot. If nobody wins, the jackpot rolls over to the next gameweek.',
    points: ['Five goalscorer picks every gameweek', 'Win only with a perfect 5/5', 'Jackpot rolls over until someone wins', 'Live scoring during matches'],
    accent: 'from-accent/15',
  },
  {
    icon: ShieldCheck,
    name: 'Last Man Standing',
    tagline: 'Season-long',
    description: 'Pick one team to win each gameweek. A loss or draw eliminates you. Be the last player standing to win the prize.',
    points: ['One team pick every gameweek', 'A loss or draw knocks you out', 'Choose each team only once', 'Last player standing wins'],
    accent: 'from-amber/15',
  },
  {
    icon: Crosshair,
    name: 'Score Predictor',
    tagline: 'Season-long',
    description: 'Predict the score of one fixture every gameweek. Earn points for accurate predictions and climb the leaderboard. Optional goalscorer predictions can earn bonus points.',
    points: ['One scoreline prediction each gameweek', 'Exact score bonuses', 'Optional goalscorer bonus', 'Season-long leaderboard'],
    accent: 'from-red-goal/15',
  },
]

export default function GameModes() {
  return (
    <section id="game-modes" className="mx-auto max-w-6xl px-5 py-24 md:py-32">
      <Reveal className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-wider text-accent">Competition formats</p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Choose your competition
        </h2>
        <p className="mt-4 text-[15px] leading-relaxed text-white/50">
          Three distinct competition formats. Three different ways to win.
        </p>
      </Reveal>

      <div className="mt-14 grid gap-6 lg:grid-cols-3">
        {MODES.map(({ icon: Icon, name, tagline, description, points, accent }, i) => (
          <Reveal key={name} delay={i * 120}>
            <div className="group relative h-full overflow-hidden rounded-3xl border border-white/8 bg-surface-1 p-7 transition-all duration-300 hover:-translate-y-1 hover:border-white/15 hover:shadow-card">
              <div className={`pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-gradient-to-br ${accent} to-transparent opacity-60 blur-2xl transition-opacity duration-300 group-hover:opacity-100`} aria-hidden="true" />

              <div className="relative">
                <div className="flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-surface-3 text-accent">
                    <Icon size={19} />
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white/45">
                    {tagline}
                  </span>
                </div>

                <h3 className="mt-6 text-xl font-bold text-white">{name}</h3>
                <p className="mt-2.5 text-[15px] leading-relaxed text-white/50">{description}</p>

                <ul className="mt-6 space-y-2.5 border-t border-white/6 pt-6">
                  {points.map((point) => (
                    <li key={point} className="flex items-start gap-2.5 text-sm text-white/60">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
