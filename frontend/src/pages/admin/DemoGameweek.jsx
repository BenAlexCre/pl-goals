import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, Play, Pause, Square, SkipForward, FastForward, RotateCcw, ChevronDown, Radio,
} from 'lucide-react'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Spinner from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import Modal from '../../components/ui/Modal'
import FixtureCard from '../../components/matchcentre/FixtureCard'
import DemoPotSummaryCard from '../../components/admin/DemoPotSummaryCard'
import DemoFixtureInsight from '../../components/admin/DemoFixtureInsight'
import { useDemoSession, useDemoGameweekControl, useDemoTimeline } from '../../hooks/useDemo'
import { useDemoPotSummaries, useDemoPickInsights } from '../../hooks/useDemoInsights'
import { useGameweek } from '../../hooks/useGameweek'
import { useLiveScores } from '../../hooks/useLiveScores'
import { useUiStore } from '../../store/uiStore'

const EVENT_LABELS = {
  kickoff: 'Kickoff',
  goal: 'Goal',
  own_goal: 'Own goal',
  penalty_goal: 'Penalty scored',
  missed_penalty: 'Penalty missed',
  yellow_card: 'Yellow card',
  red_card: 'Red card',
  second_yellow: 'Second yellow',
  sub_on: 'Substitution',
  sub_off: 'Substitution',
  var_review: 'VAR review',
  injury: 'Injury',
  full_time: 'Full time',
}

const EVENT_ICONS = {
  goal: '⚽',
  own_goal: '⚽',
  penalty_goal: '⚽',
  missed_penalty: '❌',
  yellow_card: '🟨',
  red_card: '🟥',
  second_yellow: '🟨🟥',
  sub_on: '↑',
  sub_off: '↓',
  var_review: '📺',
  injury: '🩹',
  full_time: '⏱',
  kickoff: '▶',
}

// Status shown to the operator AND to anyone watching the demo — pairs a
// Badge tone with text, never colour alone (Part 25).
const STATUS_META = {
  running: { tone: 'live', label: 'LIVE' },
  paused: { tone: 'locked', label: 'PAUSED' },
  completed: { tone: 'completed', label: 'COMPLETED' },
  stopped: { tone: 'void', label: 'STOPPED' },
  not_started: { tone: 'upcoming', label: 'NOT STARTED' },
}

// Phase 9 — Demo Gameweek/Match Centre enhancement. Was: admin controls
// front-and-center, bare fixtures, a raw event-log table — "here is an
// event generator." Now: a live-football-first layout (three real pot
// summary cards, fixtures with goalscorers + real pick-insight numbers, a
// compact event feed) with the same, fully-functional admin controls
// demoted to their own clearly-labelled "Demo controls" section at the
// bottom — "here is a live gameweek, with admin controls available."
// Every write this page triggers still goes through the exact same
// demo-gameweek-control Edge Function / real Game Engine calls as before
// — nothing here is a new scoring or generation mechanism.
export default function DemoGameweek() {
  const addToast = useUiStore((s) => s.addToast)
  const { data: session, isLoading: sessionLoading } = useDemoSession()
  const control = useDemoGameweekControl()
  const { data: timeline = [] } = useDemoTimeline(session?.id)
  // Was useDemoGameweekFixtures() — a second, demo-only 5s-polling query
  // that didn't even fetch fixture_events. useGameweek() + useLiveScores()
  // are the exact hooks GameweekPage.jsx already uses for a real gameweek:
  // one query (fixtures WITH events, for goalscorers/timeline), one real
  // realtime subscription (no separate polling architecture, Part 16).
  const { data: gameweek, isLoading: gameweekLoading } = useGameweek(session?.gameweek_id)
  useLiveScores(session?.gameweek_id, null)
  const { data: potSummaries } = useDemoPotSummaries(session)
  const { data: pickInsights } = useDemoPickInsights(session)

  const autoAdvanceRef = useRef(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [eventFeedExpanded, setEventFeedExpanded] = useState(false)

  const running = session?.gameweek_status === 'running'

  useEffect(() => {
    if (!running || !session) {
      if (autoAdvanceRef.current) {
        clearInterval(autoAdvanceRef.current)
        autoAdvanceRef.current = null
      }
      return
    }
    autoAdvanceRef.current = setInterval(() => {
      control.mutate({ action: 'trigger_next_event', demoSessionId: session.id })
    }, 4000)
    return () => {
      if (autoAdvanceRef.current) clearInterval(autoAdvanceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, session?.id])

  async function run(action, extra) {
    if (!session) return
    try {
      const result = await control.mutateAsync({ action, demoSessionId: session.id, ...extra })
      if (result?.result === null || (Array.isArray(result?.applied) && result.applied.length === 0)) {
        addToast({ type: 'info', message: 'No events left to trigger — the gameweek is fully played out.' })
      }
    } catch (err) {
      addToast({ type: 'error', message: err.message })
    }
  }

  async function handleConfirmReset() {
    setConfirmReset(false)
    await run('reset_gameweek')
  }

  if (sessionLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="space-y-6">
        <Link to="/admin/demo" className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white">
          <ArrowLeft size={14} />
          Back to Demo Centre
        </Link>
        <EmptyState
          icon={Play}
          title="No demo session"
          description="Generate demo data from the Demo Centre first."
        />
      </div>
    )
  }

  const firedCount = timeline.filter((e) => e.fired_at).length
  const nextEvent = timeline.find((e) => !e.fired_at)
  const statusMeta = STATUS_META[session.gameweek_status] ?? STATUS_META.not_started

  const fixtures = gameweek?.fixtures ?? []
  const sortedFixtures = fixtures.slice().sort((a, b) => {
    const rank = (f) => (f.status === 'live' ? 0 : f.status === 'scheduled' || f.status === 'tbd' ? 1 : 2)
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    return new Date(a.kickoff_utc) - new Date(b.kickoff_utc)
  })

  const potStatusTone = running ? 'live' : session.gameweek_status === 'completed' ? 'completed' : 'upcoming'
  const potStatusLabel = running ? 'In progress' : session.gameweek_status === 'completed' ? 'Completed' : 'Not started'

  const firedEvents = timeline.filter((e) => e.fired_at).sort((a, b) => new Date(a.fired_at) - new Date(b.fired_at))
  const visibleEvents = eventFeedExpanded ? firedEvents : firedEvents.slice(-8)

  return (
    <div className="space-y-6">
      <Link to="/admin/demo" className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white">
        <ArrowLeft size={14} />
        Back to Demo Centre
      </Link>

      {/* Header — Part 5 */}
      <section className="overflow-hidden rounded-3xl border border-white/8 bg-gradient-to-br from-surface-1 via-surface-2 to-pitch-900 p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <Badge status={statusMeta.tone}>{statusMeta.label}</Badge>
          <span className="text-xs text-white/35">Demo Premier League</span>
        </div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Demo Gameweek{gameweek?.number ? ` · Gameweek ${gameweek.number}` : ''}
        </h1>
        <p className="mt-2 text-sm text-white/50">
          {firedCount} / {timeline.length} events played
          {nextEvent ? ` — next up: ${EVENT_LABELS[nextEvent.event_type] ?? nextEvent.event_type} at minute ${nextEvent.minute}` : ' — fully played out'}
        </p>
      </section>

      {/* Three real demo pots — Part 6 */}
      {potSummaries && (
        <section className="grid gap-4 sm:grid-cols-3">
          <DemoPotSummaryCard mode="pick5" potId={potSummaries.pick5.potId} statusTone={potStatusTone} statusLabel={potStatusLabel} stats={potSummaries.pick5} />
          <DemoPotSummaryCard mode="lms" potId={potSummaries.lms.potId} statusTone={potStatusTone} statusLabel={potStatusLabel} stats={potSummaries.lms} />
          <DemoPotSummaryCard mode="predictor" potId={potSummaries.predictor.potId} statusTone={potStatusTone} statusLabel={potStatusLabel} stats={potSummaries.predictor} />
        </section>
      )}

      {/* Fixtures & Results — Parts 7/8/9/10 */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Fixtures &amp; Results</h2>
        {gameweekLoading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : sortedFixtures.length === 0 ? (
          <EmptyState icon={Radio} title="No fixtures" description="This demo gameweek has no fixtures." />
        ) : (
          <div className="space-y-3">
            {sortedFixtures.map((fixture) => (
              <div key={fixture.id}>
                <FixtureCard
                  fixture={fixture}
                  leagueId={session.league_id}
                  seasonId={session.season_id}
                  competitionName="Demo Premier League"
                  showGoalscorers
                />
                <DemoFixtureInsight fixture={fixture} insights={pickInsights} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Compact event feed — Part 15 */}
      <Card className="p-5">
        <h2 className="mb-3 text-lg font-semibold text-white">Event timeline</h2>
        {firedEvents.length === 0 ? (
          <p className="text-sm text-white/40">No events played yet.</p>
        ) : (
          <>
            <div className="space-y-1.5">
              {visibleEvents.map((e) => (
                <div key={e.id} className="flex items-center gap-2.5 text-sm text-white/70">
                  <span className="w-10 shrink-0 text-right text-white/30 tabular">{e.minute}&apos;</span>
                  <span className="shrink-0">{EVENT_ICONS[e.event_type] ?? '•'}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {EVENT_LABELS[e.event_type] ?? e.event_type}
                    {e.players?.display_name ? ` — ${e.players.display_name}` : ''}
                    <span className="text-white/35"> ({e.fixtures?.teams_home?.short_name} vs {e.fixtures?.teams_away?.short_name})</span>
                  </span>
                </div>
              ))}
            </div>
            {firedEvents.length > 8 && (
              <button
                type="button"
                onClick={() => setEventFeedExpanded((v) => !v)}
                className="mt-3 flex items-center gap-1 text-xs font-medium text-accent hover:underline"
              >
                {eventFeedExpanded ? 'Show recent only' : `View full event timeline (${firedEvents.length})`}
                <ChevronDown size={12} className={`transition-transform ${eventFeedExpanded ? 'rotate-180' : ''}`} />
              </button>
            )}
          </>
        )}
      </Card>

      {/* Demo controls — Parts 4/22/23. Visually secondary and clearly
          labelled, on purpose: the football content above is the demo,
          this is the operator's own tool underneath it. */}
      <Card className="border-dashed border-white/15 bg-black/10 p-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-white/35">Demo controls</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={control.isPending || session.gameweek_status === 'completed'}
            onClick={() => run(session.gameweek_status === 'not_started' ? 'start' : 'resume')}
          >
            <Play size={14} />
            {session.gameweek_status === 'not_started' ? 'Start' : 'Resume'}
          </Button>
          <Button size="sm" variant="ghost" disabled={!running || control.isPending} onClick={() => run('pause')}>
            <Pause size={14} />
            Pause
          </Button>
          <Button size="sm" variant="ghost" disabled={control.isPending || session.gameweek_status === 'not_started'} onClick={() => run('stop')}>
            <Square size={14} />
            Stop
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={control.isPending}
            disabled={session.gameweek_status === 'completed'}
            onClick={() => run('trigger_next_event')}
          >
            <SkipForward size={14} />
            Trigger next event
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={control.isPending}
            disabled={session.gameweek_status === 'completed'}
            onClick={() => run('advance_timeline', { batchSize: 5 })}
          >
            <FastForward size={14} />
            Advance timeline (+5)
          </Button>
          <Button size="sm" variant="ghost" loading={control.isPending} onClick={() => setConfirmReset(true)}>
            <RotateCcw size={14} />
            Reset gameweek
          </Button>
        </div>
      </Card>

      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset demo gameweek" size="sm">
        <p className="text-sm text-white/60">
          This clears every fixture score/event for the live demo gameweek and replays it from kickoff. The three
          demo pots, their members, and their history gameweeks are not affected.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setConfirmReset(false)}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={handleConfirmReset} loading={control.isPending}>
            Reset gameweek
          </Button>
        </div>
      </Modal>
    </div>
  )
}
