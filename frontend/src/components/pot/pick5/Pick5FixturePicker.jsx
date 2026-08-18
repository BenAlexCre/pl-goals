import { useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import FixtureCard from '../../matchcentre/FixtureCard'
import PlayerCard from '../../matchcentre/PlayerCard'
import EmptyState from '../../ui/EmptyState'

// Phase 8B — replaces the old flat, searchable player-list picker.
// Fixtures first: "Chelsea vs Arsenal -> expand fixture -> both squads
// shown" exactly as the brief describes. FixtureCard is reused completely
// unmodified for the "click -> Match Centre" behaviour (per-fixture
// expand and per-player select are both separate, sibling controls below
// it, not layered onto FixtureCard itself, so its own click target never
// has to compete with this picker's own interactions).
export default function Pick5FixturePicker({
  fixtures,
  fixturesLoading,
  players,
  shirtNumbers,
  leagueId,
  seasonId,
  competitionName,
  getPlayerPickCount,
  selectedCount,
  maxPicks,
  onSelectPlayer,
  deadlineClosed,
}) {
  const [expanded, setExpanded] = useState(() => new Set())

  function toggle(fixtureId) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(fixtureId)) next.delete(fixtureId)
      else next.add(fixtureId)
      return next
    })
  }

  if (fixturesLoading) {
    return <div className="py-8 text-center text-sm text-white/40">Loading fixtures...</div>
  }

  if (fixtures.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="No fixtures"
        description="This gameweek has no fixtures yet."
      />
    )
  }

  return (
    <div className="space-y-3">
      {fixtures.map((fixture) => {
        const isExpanded = expanded.has(fixture.id)
        const homePlayers = players.filter((p) => p.team_id === fixture.home_team?.id)
        const awayPlayers = players.filter((p) => p.team_id === fixture.away_team?.id)

        return (
          <div key={fixture.id} className="space-y-2">
            <FixtureCard
              fixture={fixture}
              leagueId={leagueId}
              seasonId={seasonId}
              competitionName={competitionName}
            />

            <button
              type="button"
              onClick={() => toggle(fixture.id)}
              aria-expanded={isExpanded}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-surface-2 px-3 py-2 text-sm font-medium text-white/60 transition-colors hover:text-white"
            >
              {isExpanded ? 'Hide players' : 'Show players'}
              <ChevronDown size={14} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>

            {isExpanded ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { team: fixture.home_team, squad: homePlayers },
                  { team: fixture.away_team, squad: awayPlayers },
                ].map(({ team, squad }) => (
                  <div key={team?.id ?? 'squad'} className="space-y-2">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-white/40">
                      {team?.crest_url ? <img src={team.crest_url} alt="" className="h-3.5 w-3.5 object-contain" /> : null}
                      {team?.short_name || team?.name}
                    </p>
                    {squad.length === 0 ? (
                      <p className="text-xs text-white/30">No eligible players.</p>
                    ) : (
                      squad.map((player) => {
                        const count = getPlayerPickCount(player.player_id)
                        const atMaxPicks = selectedCount >= maxPicks && count === 0
                        const disabled = deadlineClosed || atMaxPicks
                        // Phase 13, Part 21 — two genuinely different
                        // reasons were collapsed into one boolean before;
                        // each gets its own real explanation now instead
                        // of an unexplained grey-out.
                        const disabledReason = deadlineClosed
                          ? 'Picks are locked for this gameweek'
                          : atMaxPicks
                            ? `${maxPicks}/${maxPicks} selected — remove a player to choose someone else`
                            : undefined
                        return (
                          <PlayerCard
                            key={`${player.player_id}-${fixture.id}`}
                            player={player}
                            seasonId={seasonId}
                            shirtNumber={shirtNumbers?.get(player.player_id) ?? null}
                            selectedCount={count}
                            disabled={disabled}
                            disabledReason={disabledReason}
                            onSelect={() => onSelectPlayer(player)}
                          />
                        )
                      })
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
