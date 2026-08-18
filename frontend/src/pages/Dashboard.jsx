import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePots, useDashboardPotStatus } from '../hooks/usePots'
import { useCurrentGameweek, useNextGameweek } from '../hooks/useGameweek'
import { useLiveScores } from '../hooks/useLiveScores'
import { useLeaderboard } from '../hooks/useLeaderboard'
import { useOwnsAnyPot, useIsSuperAdmin } from '../hooks/useAdmin'
import { useAuthStore } from '../store/authStore'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Avatar from '../components/ui/Avatar'
import CountdownTimer from '../components/ui/CountdownTimer'
import { SkeletonCard } from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'
import FixtureCard from '../components/matchcentre/FixtureCard'
import {
  Trophy, Users, Shield, Target, CalendarOff, CheckCircle2, CreditCard,
  CalendarClock, Radio, Lock, ArrowRight, PlusCircle, LogIn, Settings, ListChecks,
} from 'lucide-react'
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
const GAMEWEEK_STATUS_META = {
  live: { badge: 'live', label: 'Live now' },
  locked: { badge: 'locked', label: 'Locked' },
  completed: { badge: 'completed', label: 'Completed' },
  upcoming: { badge: 'upcoming', label: 'Upcoming' },
}
// Phase 12, Part 6/16 — display order for the sidebar's per-mode
// leaderboard blocks, matching the order in the brief's own mockup.
// Modes the viewer isn't in simply don't produce a block (§6: "If the
// user is not in a particular mode, do not show an empty leaderboard").
const MODE_ORDER = ['score_predictor', 'last_man_standing', 'pick5']

// Phase 11, Part 2/9; Phase 12, Part 10 — one state machine for "what's
// the headline gameweek doing right now", shared by the hero, the summary
// card, the sidebar status panel, AND the fixture section header (Phase
// 12 adds the fixture-section badge on top of Phase 11's three) so the
// same gameweek is never described two different ways on one page.
// currentGw only ever comes from useCurrentGameweek() (is_current = true
// — still permanently empty locally, ISSUE-39, not fixed this phase);
// nextGw is the real fallback that actually has data today. "Locked"
// means the pick deadline has passed, independent of whether the
// football itself has kicked off — business-rules.md's own deadline
// concept, not a guess.
function resolveGameweekState(currentGw, nextGw) {
  const gw = currentGw ?? nextGw
  if (!gw) return null

  const fixtures = gw.fixtures ?? []
  const live = fixtures.filter((f) => f.status === 'live')
  const finished = fixtures.filter((f) => f.status === 'finished')
  const deadlinePassed = gw.deadline_utc ? isPastDeadline(gw.deadline_utc) : false

  if (live.length > 0) {
    return { gw, status: 'live', detail: `${live.length} match${live.length === 1 ? '' : 'es'} live now`, isNext: !currentGw }
  }
  if (fixtures.length > 0 && finished.length === fixtures.length) {
    return { gw, status: 'completed', detail: 'Gameweek complete', isNext: !currentGw }
  }
  if (currentGw && deadlinePassed) {
    return { gw, status: 'locked', detail: 'Results are being finalised', isNext: false }
  }

  const kickoffs = fixtures.map((f) => f.kickoff_utc).filter(Boolean).sort()
  const firstKickoff = kickoffs[0] ?? null
  return {
    gw,
    status: 'upcoming',
    detail: firstKickoff ? `Starts ${toLocalTimeShort(firstKickoff)}` : 'Not yet scheduled',
    countdownTarget: firstKickoff ?? gw.deadline_utc ?? null,
    isNext: !currentGw,
  }
}

// Phase 11, Part E — one CTA per pot, driven entirely by real per-mode
// state from useDashboardPotStatus() (hasEntry/pickSubmitted/
// nextGameweek): never "Join competition" for an existing member (every
// pot in this list is one the viewer already belongs to, owner or not),
// and Pick 5/LMS/Predictor each get mode-appropriate copy instead of one
// generic label.
function getPotAction(pot, status) {
  if (!status || !status.nextGameweek) return { label: 'View pot', tone: 'neutral' }

  const editable = !isPastDeadline(status.nextGameweek.deadline_utc)

  if (pot.game_type === 'pick5') {
    if (status.pickSubmitted === true) return editable ? { label: 'Update picks', tone: 'neutral' } : { label: 'Completed', tone: 'done' }
    return { label: 'Make your pick', tone: 'action' }
  }

  if (pot.game_type === 'last_man_standing' || pot.game_type === 'score_predictor') {
    if (!status.hasEntry) return { label: 'Start playing', tone: 'action' }
    if (pot.game_type === 'last_man_standing' && status.lmsEliminated) return { label: 'Eliminated', tone: 'done' }
    const noun = pot.game_type === 'score_predictor' ? 'prediction' : 'pick'
    if (status.pickSubmitted === true) return editable ? { label: `Update ${noun}`, tone: 'neutral' } : { label: 'Completed', tone: 'done' }
    return { label: `Make your ${noun}`, tone: 'action' }
  }

  return { label: 'View pot', tone: 'neutral' }
}

// Phase 12, Part 18 — one real, mode-specific progress line per
// competition card, distinct from the CTA above (that's "what to do
// next"; this is "where things stand"). Every value here already exists
// on useDashboardPotStatus()'s own result — nothing invented, and `null`
// (rendered as nothing) whenever the underlying fact genuinely isn't
// resolvable yet, never a fabricated placeholder number.
function getPotProgress(pot, status) {
  if (pot.game_type === 'last_man_standing') {
    const s = status?.lmsSurvival
    return s ? `${s.alive} player${s.alive === 1 ? '' : 's'} remaining` : null
  }
  if (pot.game_type === 'score_predictor') {
    if (status?.pickSubmitted === true) return 'Your prediction: made'
    if (status?.pickSubmitted === false) return 'Your prediction: pending'
    return null
  }
  if (pot.game_type === 'pick5') {
    if (status?.pickSubmitted === true) return '5/5 picks selected'
    if (status?.pickSubmitted === false) return '0/5 picks selected'
    return null
  }
  return null
}

function SummaryCard({ icon: Icon, label, children }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-surface-1 p-5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/35">
        <Icon size={13} />
        {label}
      </div>
      <div className="mt-2.5">{children}</div>
    </div>
  )
}

function LeaderboardRow({ row, unit, highlight }) {
  return (
    <div className={`flex items-center gap-2.5 rounded-lg px-1.5 py-1 ${highlight ? 'bg-accent/10' : ''}`}>
      <span className="w-4 shrink-0 text-center text-xs tabular text-white/35">{row.rank}</span>
      <Avatar user={row.profiles} size="xs" />
      <span className="min-w-0 flex-1 truncate text-xs text-white/70">{row.profiles?.display_name ?? 'Unknown'}</span>
      <span className="shrink-0 text-xs font-medium text-white/50 tabular">{row.score}{unit}</span>
    </div>
  )
}

// Phase 12, Part 6/17 — Score Predictor/Pick 5 share the same "ranked by
// score" shape (pot_standings_snapshots), just a different unit. Top 3
// plus, if the viewer isn't in it, their own row below a separator — so
// they never have to hunt through a full table just to find themselves.
function RankedLeaderboardBody({ rows, userId, unit }) {
  if (rows.length === 0) return <p className="text-xs text-white/35">No standings yet.</p>

  const top = rows.slice(0, 3)
  const myRow = rows.find((r) => r.user_id === userId)
  const myRowVisible = top.some((r) => r.user_id === userId)

  return (
    <div className="space-y-1">
      {top.map((row) => (
        <LeaderboardRow key={row.user_id} row={row} unit={unit} highlight={row.user_id === userId} />
      ))}
      {myRow && !myRowVisible && (
        <>
          <p className="pl-2 text-xs leading-none text-white/25">···</p>
          <LeaderboardRow row={myRow} unit={unit} highlight />
        </>
      )}
    </div>
  )
}

// Phase 12, Part 6 — LMS is deliberately NOT the same "ranked by score"
// shape: business-rules.md's own Standings section says every alive
// entrant ties for first, so a numeric rank is the wrong headline. Leads
// with survival counts and the viewer's own status instead, then a short
// list of who else is still alive.
function LmsLeaderboardBody({ rows, userId }) {
  if (rows.length === 0) return <p className="text-xs text-white/35">No standings yet.</p>

  const alive = rows.filter((r) => (r.meta?.competitiveStatus ?? 'alive') !== 'eliminated')
  const eliminatedCount = rows.length - alive.length
  const myRow = rows.find((r) => r.user_id === userId)
  const myStatus = myRow?.meta?.competitiveStatus ?? 'alive'

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs">
        <span className="font-medium text-accent">{alive.length} remaining</span>
        {eliminatedCount > 0 && <span className="text-white/40">{eliminatedCount} eliminated</span>}
      </div>
      {myRow && (
        <div className="flex items-center gap-2 rounded-lg bg-white/5 px-1.5 py-1">
          <Badge status={myStatus} />
          <span className="text-xs text-white/60">{myStatus === 'eliminated' ? 'You were eliminated' : "You're still in it"}</span>
        </div>
      )}
      {alive.length > 0 && (
        <div className="space-y-1">
          {alive.slice(0, 3).map((row) => (
            <div key={row.user_id} className="flex items-center gap-2.5">
              <Avatar user={row.profiles} size="xs" />
              <span className="min-w-0 flex-1 truncate text-xs text-white/70">{row.profiles?.display_name ?? 'Unknown'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Phase 12, Part 6/7/16 — replaces Phase 11's single, mode-blind
// LeaderboardHighlight (which only ever showed pots[0]). One block per
// game mode the viewer actually plays, each understanding its own mode's
// data shape (RankedLeaderboardBody vs LmsLeaderboardBody) instead of one
// generic table forced onto all three. Multiple pots of the same mode
// share ONE block with a pot switcher (a plain, keyboard-accessible
// native <select>) instead of one permanent block per pot — switching
// only changes this block's own local state, so nothing else on the page
// moves. Still just useLeaderboard() under the hood — no new leaderboard
// concept, no cross-pot aggregation.
function ModeLeaderboardBlock({ gameType, pots, userId }) {
  const [index, setIndex] = useState(0)
  const safeIndex = Math.min(index, pots.length - 1)
  const pot = pots[safeIndex]
  const { data: rows = [], isLoading } = useLeaderboard(pot.id, null)
  const Icon = GAME_TYPE_ICONS[gameType] || Trophy
  const label = GAME_TYPE_LABELS[gameType] || gameType

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-white">
        <Icon size={14} className="text-white/40" />
        {label}
      </div>

      {pots.length > 1 ? (
        <select
          value={safeIndex}
          onChange={(e) => setIndex(Number(e.target.value))}
          aria-label={`Switch which ${label} pot is shown`}
          className="mb-2 w-full rounded-lg border border-white/10 bg-surface-2 px-2 py-1.5 text-xs text-white/70 outline-none focus:border-accent/50"
        >
          {pots.map((p, i) => (
            <option key={p.id} value={i}>{p.name}</option>
          ))}
        </select>
      ) : (
        <Link to={`/pot/${pot.id}`} className="mb-2 block text-xs text-white/35 hover:text-accent hover:underline">
          {pot.name}
        </Link>
      )}

      {isLoading ? (
        <div className="space-y-1.5">
          <div className="h-6 animate-pulse rounded-lg bg-white/5" />
          <div className="h-6 animate-pulse rounded-lg bg-white/5" />
        </div>
      ) : gameType === 'last_man_standing' ? (
        <LmsLeaderboardBody rows={rows} userId={userId} />
      ) : (
        <RankedLeaderboardBody rows={rows} userId={userId} unit={gameType === 'score_predictor' ? ' pts' : '/5'} />
      )}
    </div>
  )
}

// Phase 9A — Homepage redesign; Phase 11 — full rebuild into a "football
// home screen"; Phase 12 — a second product pass: a wider, less-cramped
// layout (full team names, a real two-column fixture grid instead of
// three squeezed columns), mode-aware per-game-mode leaderboards instead
// of one generic table, and real per-pot progress lines. Every data
// source here already existed (useCurrentGameweek/useNextGameweek,
// usePots, useDashboardPotStatus, useLiveScores, useLeaderboard,
// FixtureCard's own internal hooks) or is a small, justified extension of
// one of them — no new polling/realtime mechanism, no invented
// leaderboard, no hard-coded league/season text.
export default function Dashboard() {
  const { user, profile } = useAuthStore()
  const { data: pots = [], isLoading: potsLoading } = usePots()
  const { data: currentGw, isLoading: gwLoading } = useCurrentGameweek()
  const { data: nextGw, isLoading: nextGwLoading } = useNextGameweek(!gwLoading && !currentGw)
  const { data: potStatus } = useDashboardPotStatus(pots)
  const { data: ownsAnyPot } = useOwnsAnyPot()
  const isSuperAdmin = useIsSuperAdmin()

  const gwState = resolveGameweekState(currentGw, nextGw)
  const displayGw = gwState?.gw ?? null

  // Same realtime channel GameweekPage.jsx already relies on — no second
  // subscription. Keyed on currentGw specifically (not displayGw): an
  // upcoming-only gameweek has nothing live to subscribe to yet.
  useLiveScores(currentGw?.id, null)

  const fixtures = displayGw?.fixtures ?? []
  const sortedFixtures = fixtures.slice().sort((a, b) => {
    const rank = (f) => (f.status === 'live' ? 0 : f.status === 'scheduled' || f.status === 'tbd' ? 1 : 2)
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    return new Date(a.kickoff_utc) - new Date(b.kickoff_utc)
  })
  const liveFixtures = gwState?.status === 'live' ? sortedFixtures.filter((f) => f.status === 'live') : []

  // A real destination for "View all fixtures" — one of the viewer's own
  // pots that's actually on this gameweek's league/season, if any (never
  // a fabricated route). GameweekPage already renders this gameweek's
  // full fixture list plus standings for that pot.
  const matchingPot = displayGw ? pots.find((p) => p.season_id === displayGw.season_id && p.league_id === displayGw.league_id) : null

  const enteredCount = pots.filter((p) => potStatus?.get(p.id)?.hasEntry).length
  // Bug found live: an eliminated LMS entrant has `pickSubmitted: false`
  // (they never will submit again) and was being surfaced as "needs a
  // pick" here — excluded the same way getPotAction() now excludes them
  // from the CTA itself.
  const nextPickPot = pots.find((p) => potStatus?.get(p.id)?.pickSubmitted === false && !potStatus?.get(p.id)?.lmsEliminated)
    ?? pots.find((p) => potStatus?.get(p.id)?.hasEntry === false && potStatus?.get(p.id)?.nextGameweek)
  const nextPickAction = nextPickPot ? getPotAction(nextPickPot, potStatus?.get(nextPickPot.id)) : null

  const potsByMode = useMemo(() => {
    const map = new Map()
    for (const pot of pots) {
      if (!map.has(pot.game_type)) map.set(pot.game_type, [])
      map.get(pot.game_type).push(pot)
    }
    return map
  }, [pots])

  const showAdminAction = ownsAnyPot || isSuperAdmin
  // Bug found live verifying this page (real, existing data — 5 of 57
  // profiles, including this account): the signup flow's own default
  // leaves `display_name` equal to the account's email until someone
  // explicitly changes it, so "Welcome back, {display_name}" rendered a
  // raw email address. `username` (always a short handle, never an email)
  // is the better greeting name whenever `display_name` looks like a bare
  // email — never a hard-coded name, still driven entirely by this
  // account's own real profile row.
  const rawDisplayName = profile?.display_name?.trim()
  const looksLikeEmail = !!rawDisplayName && rawDisplayName.includes('@') && !rawDisplayName.includes(' ')
  const rawUsername = profile?.username?.trim()
  // handle_new_user() (001_initial_schema.sql) falls back to exactly this
  // shape — `'user_' || substr(id, 1, 8)` — when no real username was
  // ever set either. Neither auto-generated value reads as a name a
  // human would recognise, so a genuinely nameless account (confirmed
  // live: some real test accounts have both) gets a plain, honest
  // greeting instead of one of them — never a fabricated name.
  const usernameLooksAutoGenerated = !!rawUsername && /^user_[0-9a-f]{8}$/i.test(rawUsername)
  const greetingSource = looksLikeEmail
    ? (usernameLooksAutoGenerated ? null : rawUsername)
    : (rawDisplayName || (usernameLooksAutoGenerated ? null : rawUsername))
  const firstName = greetingSource?.trim().split(/\s+/)[0] || 'there'
  const loadingHero = gwLoading || (nextGwLoading && !currentGw)
  const statusMeta = gwState ? GAMEWEEK_STATUS_META[gwState.status] : null

  // Phase 14, Part 12 — this root used to also carry `max-w-[1400px]
  // mx-auto`, which was dead code: AppShell's own shared container (then
  // max-w-6xl, 1152px) was always narrower, so the constraint never
  // actually bound and `mx-auto` had zero extra space to center into.
  // Removed now that AppShell itself provides the one real shared width
  // (matched to TopNav's, see AppShell.jsx's own comment) — Dashboard
  // just fills it like every other page, rather than layering a second,
  // silently inert container on top.
  return (
    <div className="space-y-8 lg:grid lg:grid-cols-[1fr_380px] lg:items-start lg:gap-8 lg:space-y-0">
      <div className="space-y-8 min-w-0">
        {/* A. Welcome header */}
        <section>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Welcome back, {firstName}</h1>
          <p className="mt-1 text-sm text-white/45">Here&apos;s what&apos;s happening in your competitions.</p>
        </section>

        {/* B. Summary cards */}
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryCard icon={CalendarClock} label="Next gameweek">
            {loadingHero ? (
              <div className="h-10 animate-pulse rounded-lg bg-white/5" />
            ) : gwState ? (
              <>
                <p className="font-semibold text-white">Gameweek {gwState.gw.number}</p>
                <p className="mt-0.5 text-xs text-white/45">{gwState.detail}</p>
                {gwState.status === 'upcoming' && gwState.countdownTarget && (
                  <CountdownTimer deadlineUtc={gwState.countdownTarget} showSeconds={false} className="mt-1 text-xs" />
                )}
              </>
            ) : (
              <p className="text-xs text-white/35">No gameweek scheduled</p>
            )}
          </SummaryCard>

          <SummaryCard icon={Radio} label="Live now">
            {loadingHero ? (
              <div className="h-10 animate-pulse rounded-lg bg-white/5" />
            ) : liveFixtures.length > 0 ? (
              <>
                <p className="font-semibold text-white">{liveFixtures.length} match{liveFixtures.length === 1 ? '' : 'es'}</p>
                <p className="mt-0.5 text-xs text-white/45">{displayGw?.leagues?.name}</p>
              </>
            ) : (
              <p className="text-xs text-white/35">No matches live right now</p>
            )}
          </SummaryCard>

          <SummaryCard icon={Users} label="Your competitions">
            {potsLoading ? (
              <div className="h-10 animate-pulse rounded-lg bg-white/5" />
            ) : pots.length === 0 ? (
              <p className="text-xs text-white/35">No pots yet</p>
            ) : (
              <>
                <p className="font-semibold text-white">{pots.length} pot{pots.length === 1 ? '' : 's'}</p>
                <p className="mt-0.5 text-xs text-white/45">{enteredCount} entered · {pots.length - enteredCount} not entered</p>
              </>
            )}
          </SummaryCard>

          <SummaryCard icon={ListChecks} label="Your next pick">
            {potsLoading ? (
              <div className="h-10 animate-pulse rounded-lg bg-white/5" />
            ) : !nextPickPot ? (
              <p className="text-xs text-white/35">{pots.length === 0 ? 'No competitions yet' : 'All caught up ✓'}</p>
            ) : (
              <Link to={`/pot/${nextPickPot.id}`} className="block">
                <p className="truncate font-semibold text-white">{nextPickPot.name}</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-accent">
                  {nextPickAction?.label} <ArrowRight size={11} />
                </p>
              </Link>
            )}
          </SummaryCard>
        </section>

        {/* D. Live now — dedicated section, only rendered when there's
            actually something live (never a giant empty panel). */}
        {liveFixtures.length > 0 && (
          <section>
            <div className="mb-3 flex items-center gap-2">
              <Radio size={15} className="animate-pulse text-red-goal" />
              <h2 className="text-lg font-semibold text-white">Live now</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {liveFixtures.map((fixture) => (
                <FixtureCard
                  key={fixture.id}
                  fixture={fixture}
                  leagueId={displayGw.league_id}
                  seasonId={displayGw.season_id}
                  competitionName={displayGw.leagues?.name}
                />
              ))}
            </div>
          </section>
        )}

        {/* C. Upcoming/current fixtures — always the full list for
            whichever gameweek resolveGameweekState() found (live, locked,
            or upcoming), never empty just because nothing is live right
            now. Two columns, not three (Part 2/3/15) — real width for
            full team names instead of "Hull... vs Man...". Header always
            states the same league/gameweek/status resolveGameweekState()
            already resolved for the hero and sidebar (Part 10) — never a
            second, independently-derived status. */}
        <section>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-white">
                  {gwState?.status === 'upcoming' ? 'Upcoming fixtures' : 'This gameweek'}
                </h2>
                {statusMeta && <Badge status={statusMeta.badge}>{statusMeta.label}</Badge>}
              </div>
              {gwState && (
                <p className="mt-1 text-sm text-white/40">
                  {displayGw?.leagues?.name} · Gameweek {gwState.gw.number}
                  {gwState.status === 'locked' && ' · picks are locked, results are being finalised'}
                </p>
              )}
            </div>
            {matchingPot && sortedFixtures.length > 0 && (
              <Link
                to={`/pot/${matchingPot.id}/gameweek/${displayGw.id}`}
                className="shrink-0 text-sm font-medium text-accent hover:underline"
              >
                View all fixtures
              </Link>
            )}
          </div>
          {gwLoading || nextGwLoading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
          ) : !gwState ? (
            <EmptyState
              icon={CalendarOff}
              title="No fixtures available yet"
              description="Once fixtures are scheduled for your league, they'll show up here."
            />
          ) : sortedFixtures.length === 0 ? (
            <EmptyState icon={Trophy} title="No fixtures yet" description="Fixtures for this gameweek haven't been scheduled yet." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
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

        {/* E. Your competitions — real per-mode CTA (getPotAction) plus a
            real per-mode progress line (getPotProgress, Part 18). */}
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
              action={<Link to="/pots" className="text-sm font-medium text-accent hover:underline">Create or join a pot</Link>}
            />
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {pots.map((pot) => {
                const Icon = GAME_TYPE_ICONS[pot.game_type] || Trophy
                const status = potStatus?.get(pot.id)
                const isPotAdmin = pot.pot_members?.[0]?.role === 'admin'
                const action = getPotAction(pot, status)
                const progress = getPotProgress(pot, status)
                return (
                  <Link key={pot.id} to={`/pot/${pot.id}`}>
                    <Card hover className="p-5 h-full">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="flex items-center gap-1.5 text-white font-semibold">
                            <Icon size={15} className="text-white/40 shrink-0" />
                            <span className="truncate">{pot.name}</span>
                          </h3>
                          <p className="mt-1 text-xs text-white/40">
                            {GAME_TYPE_LABELS[pot.game_type] || pot.game_type} · {pot.leagues?.name} · {formatSeasonName(pot.seasons)}
                          </p>
                        </div>
                        {/* Part 8/21 — this badge means admin OF THIS POT
                            (pot_members.role, scoped to the viewer's own
                            membership row by usePots()'s own query), never
                            a global app_admin/super_admin flag. */}
                        {isPotAdmin && <Badge status="admin" />}
                      </div>

                      <div className="mt-4 flex items-end justify-between gap-3 text-sm">
                        <div className="min-w-0 space-y-1">
                          {status?.isPaid === true ? (
                            <span className="flex items-center gap-1 text-xs text-accent">
                              <CreditCard size={12} /> Paid
                            </span>
                          ) : status?.isPaid === false ? (
                            <span className="flex items-center gap-1 text-xs text-amber">
                              <CreditCard size={12} /> Unpaid
                            </span>
                          ) : null}
                          {progress && <p className="truncate text-xs text-white/45">{progress}</p>}
                        </div>

                        <span className={`inline-flex shrink-0 items-center gap-1 text-xs font-medium ${
                          action.tone === 'action' ? 'text-accent' : action.tone === 'done' ? 'text-white/40' : 'text-white/60'
                        }`}>
                          {action.tone === 'done' ? <CheckCircle2 size={12} /> : null}
                          {action.label}
                          {action.tone !== 'done' && <ArrowRight size={11} />}
                        </span>
                      </div>
                    </Card>
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {/* F. Desktop sidebar — hidden below lg, so nothing here is ever
          the only place a piece of information lives. */}
      <div className="hidden lg:block lg:space-y-5">
        <div className="rounded-2xl border border-white/8 bg-surface-1 p-5">
          <h3 className="mb-3 text-sm font-semibold text-white">Gameweek status</h3>
          {loadingHero ? (
            <div className="h-16 animate-pulse rounded-lg bg-white/5" />
          ) : gwState ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-white">Gameweek {gwState.gw.number}</span>
                <Badge status={statusMeta?.badge ?? 'upcoming'}>{statusMeta?.label ?? gwState.status}</Badge>
              </div>
              <p className="text-xs text-white/45">{gwState.detail}</p>
              {gwState.status === 'upcoming' && gwState.countdownTarget && (
                <CountdownTimer deadlineUtc={gwState.countdownTarget} showSeconds={false} className="text-xs" />
              )}
            </div>
          ) : (
            <p className="text-xs text-white/35">No gameweek data available yet.</p>
          )}
        </div>

        {pots.length > 0 && (
          <div className="rounded-2xl border border-white/8 bg-surface-1 p-5">
            <h3 className="mb-3 text-sm font-semibold text-white">Leaderboards</h3>
            <div className="space-y-5">
              {MODE_ORDER.filter((mode) => potsByMode.has(mode)).map((mode) => (
                <ModeLeaderboardBlock key={mode} gameType={mode} pots={potsByMode.get(mode)} userId={user?.id} />
              ))}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-white/8 bg-surface-1 p-5">
          <h3 className="mb-3 text-sm font-semibold text-white">Quick actions</h3>
          <div className="space-y-1.5">
            <Link to="/pots" className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white">
              <PlusCircle size={15} className="text-white/35" /> Create a competition
            </Link>
            <Link to="/join" state={{ from: '/dashboard' }} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white">
              <LogIn size={15} className="text-white/35" /> Join a competition
            </Link>
            <Link to="/pots" className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white">
              <Trophy size={15} className="text-white/35" /> View all pots
            </Link>
            {showAdminAction && (
              <Link to="/admin" className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white">
                <Settings size={15} className="text-white/35" /> Manage my competitions
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
