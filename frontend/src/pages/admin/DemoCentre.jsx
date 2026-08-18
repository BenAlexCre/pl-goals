import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, Trash2, RotateCcw, PlayCircle } from 'lucide-react'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Spinner from '../../components/ui/Spinner'
import { useDemoSession, useGenerateDemoData, useTeardownDemo } from '../../hooks/useDemo'
import { useUiStore } from '../../store/uiStore'

const USER_COUNT_OPTIONS = [10, 25, 50]

const PHASE_LABEL = {
  league: 'Creating league, teams, players, and pots…',
  users: 'Creating synthetic users and picks…',
  settle: 'Settling history gameweeks…',
}

// Phase 8C, Slice 1 — the Demo Centre: generate/reset/delete a fully
// isolated demo environment (its own league/season/teams/players/pots/
// synthetic users), then hand off to Demo Gameweek for the interactive
// live-event walkthrough. One demo session at a time (v1) — the simplest
// UX, and matches demo-generate-data's own "already exists" guard.
//
// Generation is several sequential requests, not one (see
// useGenerateDemoData's own comment — the local Edge Runtime's per-
// invocation CPU budget can't fit a 10-50 user generation in a single
// call), so this shows real progress rather than one opaque spinner.
export default function DemoCentre() {
  const addToast = useUiStore((s) => s.addToast)
  const { data: session, isLoading } = useDemoSession()
  const generate = useGenerateDemoData()
  const teardown = useTeardownDemo()
  const [progress, setProgress] = useState(null)

  async function handleGenerate(userCount) {
    setProgress({ phase: 'league' })
    try {
      await generate.mutateAsync({ userCount, onProgress: setProgress })
      addToast({ type: 'success', message: `Demo data generated (${userCount} users)` })
    } catch (err) {
      addToast({ type: 'error', message: err.message })
    } finally {
      setProgress(null)
    }
  }

  async function handleReset() {
    if (!session) return
    try {
      await teardown.mutateAsync({ demoSessionId: session.id })
      addToast({ type: 'success', message: 'Demo data deleted — generate again to start a fresh run' })
    } catch (err) {
      addToast({ type: 'error', message: err.message })
    }
  }

  async function handleDelete() {
    if (!session) return
    try {
      await teardown.mutateAsync({ demoSessionId: session.id })
      addToast({ type: 'success', message: 'Demo data deleted' })
    } catch (err) {
      addToast({ type: 'error', message: err.message })
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
              <Sparkles size={22} />
              Demo Centre
            </h1>
            <p className="mt-1 text-sm text-white/40">
              Generate a fully isolated demo environment — its own league, teams, players, pots, and synthetic
              users — to showcase the app without touching real data.
            </p>
          </div>
          <Badge status="admin">super_admin</Badge>
        </div>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : session ? (
        <Card className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Active demo session</h2>
              <p className="mt-0.5 text-sm text-white/45">
                {session.config?.userCount ?? '?'} synthetic users · gameweek status:{' '}
                <span className="font-medium text-white/70">{session.gameweek_status}</span>
              </p>
            </div>
            <Badge status={session.status === 'active' ? 'member' : 'draft'}>{session.status}</Badge>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link to="/admin/demo/gameweek">
              <Button variant="primary">
                <PlayCircle size={16} />
                Open Demo Gameweek
              </Button>
            </Link>
            <Button variant="secondary" loading={teardown.isPending} onClick={handleReset}>
              <RotateCcw size={16} />
              Reset demo
            </Button>
            <Button variant="danger" loading={teardown.isPending} onClick={handleDelete}>
              <Trash2 size={16} />
              Delete demo data
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-5 space-y-4">
          <h2 className="text-lg font-semibold text-white">Generate demo data</h2>
          <p className="text-sm text-white/45">
            Creates a demo league with 8 teams, ~112 players, 4 gameweeks (2 already settled with real standings
            and prize history, 1 ready for the live Demo Gameweek walkthrough, 1 upcoming), 3 pots — one per game
            mode — and the chosen number of synthetic members with realistic picks, payments, and standings.
          </p>
          <div className="flex flex-wrap gap-3">
            {USER_COUNT_OPTIONS.map((count) => (
              <Button
                key={count}
                variant="secondary"
                loading={generate.isPending}
                disabled={generate.isPending}
                onClick={() => handleGenerate(count)}
              >
                Generate with {count} users
              </Button>
            ))}
          </div>
          {progress && (
            <div className="flex items-center gap-2 text-sm text-white/50">
              <Spinner size="sm" />
              {PHASE_LABEL[progress.phase]}
              {progress.phase === 'users' && progress.total ? ` (${progress.createdCount ?? 0} / ${progress.total})` : ''}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
