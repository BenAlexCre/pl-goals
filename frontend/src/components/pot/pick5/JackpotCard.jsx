import { Flame, Trophy } from 'lucide-react'

function formatCurrency(amount) {
  return `€${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Pick 5's own prize concept IS the jackpot — there's no separate "prize
// pool" number to show alongside it, so this is the pot's one prize widget,
// not one of several. Every figure here is either read directly from an
// already-settled pot_prizes row (net_amount/rollover, written by
// Pick5Engine.awardPrize()) or a plain multiplication of already-visible
// facts (paid entries this gameweek × the pot's own entry fee) — nothing
// here re-derives or guesses at engine logic. `loading` covers the initial
// fetch; once resolved, missing pieces are hidden rather than shown as 0/
// placeholder, per "hide unavailable values gracefully."
export default function JackpotCard({ loading, rolledOverAmount, weeksSinceLastWinner, thisWeekContribution, hasSettledHistory }) {
  const currentJackpot = (rolledOverAmount || 0) + (thisWeekContribution || 0)
  const hasRollover = (rolledOverAmount || 0) > 0

  return (
    <div className="relative overflow-hidden rounded-3xl border border-accent/20 bg-gradient-to-br from-accent/[0.12] via-surface-1 to-surface-1 p-5 sm:p-6">
      <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-accent/15 blur-[70px]" aria-hidden="true" />

      <div className="relative">
        <div className="flex items-center gap-2 text-accent">
          <Trophy size={18} />
          <span className="text-xs font-semibold uppercase tracking-wider">Current jackpot</span>
        </div>

        {loading ? (
          <div className="mt-3 h-12 w-40 animate-pulse rounded-lg bg-white/5" />
        ) : (
          <>
            <p className="mt-2 text-4xl font-bold tabular tracking-tight text-white sm:text-5xl lg:text-6xl">
              {formatCurrency(currentJackpot)}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-4">
              {hasRollover ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber/30 bg-amber/15 px-3 py-1 text-xs font-medium text-amber">
                  <Flame size={12} />
                  Rolled over {weeksSinceLastWinner} {weeksSinceLastWinner === 1 ? 'week' : 'weeks'}
                </span>
              ) : hasSettledHistory ? (
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/50">
                  Reset after last week's winner
                </span>
              ) : null}

              {thisWeekContribution > 0 && (
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/50">
                  +{formatCurrency(thisWeekContribution)} from this gameweek
                </span>
              )}
            </div>

            <p className="mt-3 text-xs text-white/35">
              Updates as entries are confirmed paid — final at kickoff.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
