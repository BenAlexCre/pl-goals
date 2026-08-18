import { Link } from 'react-router-dom'
import { usePots, useDashboardPotStatus } from '../hooks/usePots'
import { useCurrentGameweek, useNextGameweek } from '../hooks/useGameweek'
import { useLiveScores } from '../hooks/useLiveScores'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import CountdownTimer from '../components/ui/CountdownTimer'
import { SkeletonCard } from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'
import FixtureCard from '../components/matchcentre/FixtureCard'
import { Trophy, Users, Shield, Target, CalendarOff, CheckCircle2, CreditCard, CalendarClock } from 'lucide-react'
import { isPastDeadline, toLocalTimeShort } from '../utils/time'
import { formatSeasonName } from '../utils/format'

const GAME_TYPE_LABELS = {
  pick5: 'Pick 5',
  last_man_standing: 'Last Man Standing',
  score_predictor: 'Score Predictor',
}
const GAME_TYPE_ICONS = {
  pick5: Trophy,
  last_man_standing: Shield,
  score_predictor: Target,
}

// Phase 9A — the homepage's own "what's the current gameweek's state"
// summary, independent of any one fixture. Mirrors the vocabulary
// FixtureCard/Badge already use (live/upcoming/finished) rather than
// inventing a fourth.
function gameweekHeadline(gw) {
  if (!gw) return null
  const fixtures = gw.fixtures ?? []
  const live = fixtures.filter((f) => f.status === 'live')
  const finished = fixtures.filter((f) => f.status === 'finished')
  const upcoming = fixtures.filter((f) => f.status === 'scheduled' || f.status === 'tbd')

  if (live.length > 0) return { status: 'live', text: `${live.length} match${live.length === 1 ? '' : 'es'} live now` }
  if (upcoming.length > 0 && finished.length === 0) return { status: 'upcoming', text: 'Not yet started' }
  if (upcoming.length > 0) return { status: 'live', text: `${finished.length}/${fixtures.length} finished` }
  if (fixtures.length > 0) return { status: 'completed', text: 'Gameweek complete' }
  return null
}

// Phase 9A — Homepage redesign (Part 4-9). Was a single "Your pots" list;
// now a live football hub first, competitions second. Every data source
// here already existed (useCurrentGameweek, usePots, useLiveScores,
// FixtureCard's own internal hooks) — no new query infrastructure, no new
// polling/realtime mechanism, per Part 27.
export default function Dashboard() {
  const { data: pots = [], isLoading: potsLoading } = usePots()
  const { data: currentGw, isLoading: gwLoading } = useCurrentGameweek()
  // Phase 10B, Part 17/18/19 — only fetched once we actually know there's
  // no live gameweek, so a real is_current gameweek never pays for a
  // second query it doesn't need (per Part 27's own "no unnecessary
  // queries" — see useNextGameweek()'s own comment for why this exists).
  const { data: nextGw, isLoading: nextGwLoading } = useNextGameweek(!gwLoading && !currentGw)

  const displayGw = currentGw ?? nextGw
  const isUpcomingOnly = !currentGw && !!nextGw

  const potIds = pots.map((p) => p.id)
  const { data: potStatus } = useDashboardPotStatus(potIds, currentGw?.id ?? null)

  // Reuses the exact realtime channel GameweekPage.jsx already relies on —
  // fixtures/fixture_events/pot_standings_snapshots invalidation, no
  // second subscription, no potId here since the homepage isn't scoped to
  // one pot's entries. Deliberately still keyed on currentGw, not
  // displayGw — an upcoming-only gameweek has nothing live to subscribe
  // to yet.
  useLiveScores(currentGw?.id, null)

  const headline = gameweekHeadline(currentGw)
  const fixtures = displayGw?.fixtures ?? []
  const sortedFixtures = fixtures.slice().sort((a, b) => {
    const rank = (f) => (f.status === 'live' ? 0 : f.status === 'scheduled' || f.status === 'tbd' ? 1 : 2)
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    return new Date(a.kickoff_utc) - new Date(b.kickoff_utc)
  })
  // Earliest real kickoff in the upcoming gameweek — not deadline_utc
  // (that's the pick-lock cutoff, ~30 minutes before kickoff per
  // business-rules.md, a subtly different fact from "when does football
  // actually start").
  const firstKickoff = isUpcomingOnly && sortedFixtures.length > 0
    ? sortedFixtures.reduce((min, f) => (f.kickoff_utc && new Date(f.kickoff_utc) < new Date(min) ? f.kickoff_utc : min), sortedFixtures[0].kickoff_utc)
    : null

  return (
    <div className="space-y-8">
      {/* 1. Current gameweek — the app's primary context (Part 5). Never a
          fabricated GW1: if useCurrentGameweek() returns null (a real,
          currently-true state — no gameweek is marked is_current locally,
          ISSUE-24/39), this is a deliberate empty state, not a guess. */}
      <section className="overflow-hidden rounded-3xl border border-white/8 bg-gradient-to-br from-surface-1 via-surface-2 to-pitch-900 p-5 sm:p-7">
        {gwLoading || (nextGwLoading && !currentGw) ? (
          <div className="h-24 animate-pulse rounded-2xl bg-white/5" />
        ) : currentGw ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge status={headline?.status ?? currentGw.status}>{headline?.text ?? currentGw.status}</Badge>
              <span className="text-xs text-white/35">{currentGw.leagues?.name}</span>
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Gameweek {currentGw.number}
            </h1>
            {currentGw.deadline_utc && !isPastDeadline(currentGw.deadline_utc) && (
              <div className="mt-3 flex items-center gap-2 text-sm text-white/50">
                <span>Deadline:</span>
                <CountdownTimer deadlineUtc={currentGw.deadline_utc} />
              </div>
            )}
          </>
        ) : nextGw ? (
          // Phase 10B, Part 17/18/19 — "what's happening now" has a real
          // answer even with no live gameweek: what's coming next, with
          // real fixtures and a real countdown, not a dead panel.
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge status="upcoming">Next gameweek</Badge>
              <span className="text-xs text-white/35">{nextGw.leagues?.name}</span>
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Gameweek {nextGw.number}
            </h1>
            {firstKickoff && (
              <div className="mt-3 flex items-center gap-2 text-sm text-white/50">
                <CalendarClock size={15} className="text-white/35" />
                <span>Starts {toLocalTimeShort(firstKickoff)}</span>
                <CountdownTimer deadlineUtc={firstKickoff} showSeconds={false} className="text-white/60" />
              </div>
            )}
          </>
        ) : (
          <EmptyState
            icon={CalendarOff}
            title="No active gameweek right now"
            description="The next Premier League gameweek isn't live yet. Check back closer to kickoff."
          />
        )}
      </section>

      {/* 2. Live football — the homepage's own hub, independent of any pot.
          Reuses FixtureCard completely unmodified: same crest/score/live-
          state rendering and the same click -> MatchCentreDrawer entry
          point GameweekPage.jsx already proves out (Part 7 — "do not
          duplicate the entire Match Centre inside every card"). */}
      {displayGw && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              {isUpcomingOnly ? 'Upcoming fixtures' : "This gameweek's fixtures"}
            </h2>
            {sortedFixtures.length > 0 && (
              <span className="text-xs text-white/35">{sortedFixtures.length} fixtures</span>
            )}
          </div>
          {sortedFixtures.length === 0 ? (
            <EmptyState icon={Trophy} title="No fixtures yet" description="Fixtures for this gameweek haven't been scheduled yet." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {sortedFixtures.map((fixture) => (
                <FixtureCard
                  key={fixture.id}
                  fixture={fixture}
                  leagueId={displayGw.league_id}
                  seasonId={displayGw.season_id}
                  competitionName={displayGw.leagues?.name}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* 3. Your competitions — secondary to the football context above
          (Part 8), not the page's headline anymore. */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Your competitions</h2>
          <Badge status="member">{pots.length} {pots.length === 1 ? 'pot' : 'pots'}</Badge>
        </div>

        {potsLoading ? (
          <div className="grid md:grid-cols-2 gap-4">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : pots.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No pots yet"
            description="You haven't joined any private pots yet."
          />
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {pots.map((pot) => {
              const Icon = GAME_TYPE_ICONS[pot.game_type] || Trophy
              const status = potStatus?.get(pot.id)
              return (
                <Link key={pot.id} to={`/pot/${pot.id}`}>
                  <Card hover className="p-5 h-full">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="flex items-center gap-1.5 text-white font-semibold">
                          <Icon size={15} className="text-white/40" />
                          {pot.name}
                        </h3>
                        <p className="text-sm text-white/35 mt-1">
                          {pot.description || 'No description yet'}
                        </p>
                      </div>
                      <Badge status={pot.pot_members?.[0]?.role || 'member'}>
                        {pot.pot_members?.[0]?.role || 'member'}
                      </Badge>
                    </div>

                    <div className="mt-4 flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 text-white/45">
                        <Trophy size={15} />
                        <span>{pot.leagues?.name}</span>
                      </div>
                      <span className="text-white/30">{formatSeasonName(pot.seasons)}</span>
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-xs text-white/35">{GAME_TYPE_LABELS[pot.game_type] || pot.game_type || 'Pick 5'}</span>
                      {status ? (
                        <div className="flex items-center gap-2 text-xs">
                          {status.hasEntry ? (
                            <span className="inline-flex items-center gap-1 text-accent">
                              <CheckCircle2 size={12} />
                              {status.entryScoped ? 'Picked' : 'Joined'}
                            </span>
                          ) : (
                            <span className="text-white/30">Not entered</span>
                          )}
                          {status.isPaid === true ? (
                            <span className="inline-flex items-center gap-1 text-accent">
                              <CreditCard size={12} />
                              Paid
                            </span>
                          ) : status.isPaid === false ? (
                            <span className="inline-flex items-center gap-1 text-amber">
                              <CreditCard size={12} />
                              Unpaid
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
