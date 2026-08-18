import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, Play, Pause, Square, SkipForward, FastForward, RotateCcw,
} from 'lucide-react'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Spinner from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import FixtureCard from '../../components/matchcentre/FixtureCard'
import {
  useDemoSession, useDemoGameweekControl, useDemoTimeline, useDemoGameweekFixtures,
} from '../../hooks/useDemo'
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

// Phase 8C, Slice 1 — the Demo Gameweek control panel: the operator's own
// view (not the audience's — that's just the normal Match Centre/gameweek
// pages, which pick up every write here for free via the existing
// fixtures/fixture_events realtime channel). "Start" auto-advance is a
// client-side interval calling trigger_next_event every few seconds while
// gameweek_status === 'running' — no server cron, matching the plan's own
// "no new cron job" decision.
export default function DemoGameweek() {
  const addToast = useUiStore((s) => s.addToast)
  const { data: session, isLoading: sessionLoading } = useDemoSession()
  const control = useDemoGameweekControl()
  const { data: timeline = [] } = useDemoTimeline(session?.id)
  const { data: fixtures = [] } = useDemoGameweekFixtures(session?.gameweek_id)
  const autoAdvanceRef = useRef(null)

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/admin/demo" className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white">
          <ArrowLeft size={14} />
          Back to Demo Centre
        </Link>
        <Badge status={running ? 'member' : 'draft'}>{session.gameweek_status}</Badge>
      </div>

      <Card className="p-5 space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Demo Gameweek</h1>
          <p className="mt-1 text-sm text-white/40">
            {firedCount} / {timeline.length} events played
            {nextEvent ? ` — next up: ${EVENT_LABELS[nextEvent.event_type] ?? nextEvent.event_type} at minute ${nextEvent.minute}` : ' — fully played out'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={control.isPending || session.gameweek_status === 'completed'}
            onClick={() => run(session.gameweek_status === 'not_started' ? 'start' : 'resume')}
          >
            <Play size={16} />
            {session.gameweek_status === 'not_started' ? 'Start' : 'Resume'}
          </Button>
          <Button variant="secondary" disabled={!running || control.isPending} onClick={() => run('pause')}>
            <Pause size={16} />
            Pause
          </Button>
          <Button variant="secondary" disabled={control.isPending || session.gameweek_status === 'not_started'} onClick={() => run('stop')}>
            <Square size={16} />
            Stop
          </Button>
          <Button
            variant="secondary"
            loading={control.isPending}
            disabled={session.gameweek_status === 'completed'}
            onClick={() => run('trigger_next_event')}
          >
            <SkipForward size={16} />
            Trigger next event
          </Button>
          <Button
            variant="secondary"
            loading={control.isPending}
            disabled={session.gameweek_status === 'completed'}
            onClick={() => run('advance_timeline', { batchSize: 5 })}
          >
            <FastForward size={16} />
            Advance timeline (+5)
          </Button>
          <Button variant="ghost" loading={control.isPending} onClick={() => run('reset_gameweek')}>
            <RotateCcw size={16} />
            Reset gameweek
          </Button>
        </div>
      </Card>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-white">Fixtures</h2>
        <div className="space-y-3">
          {fixtures.map((fixture) => (
            <FixtureCard
              key={fixture.id}
              fixture={fixture}
              leagueId={session.league_id}
              seasonId={session.season_id}
              competitionName="Demo Premier League"
            />
          ))}
        </div>
      </div>

      <Card className="p-5">
        <h2 className="mb-3 text-lg font-semibold text-white">Event log</h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-white/40">No timeline generated.</p>
        ) : (
          <div className="max-h-[420px] space-y-1.5 overflow-y-auto">
            {timeline.map((e) => (
              <div
                key={e.id}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                  e.fired_at ? 'bg-surface-2 text-white/70' : 'bg-transparent text-white/30'
                }`}
              >
                <span>
                  {e.fixtures?.teams_home?.short_name} vs {e.fixtures?.teams_away?.short_name} — {EVENT_LABELS[e.event_type] ?? e.event_type}
                  {e.players?.display_name ? ` (${e.players.display_name})` : ''}
                </span>
                <span className="tabular text-xs">{e.minute}&apos;</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
