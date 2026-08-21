import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePots, useDashboardPotStatus } from '../hooks/usePots'
import { useCurrentGameweek, useNextGameweek, useGameweek, useAllGameweeks } from '../hooks/useGameweek'
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
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import { isPastDeadline, toLocalTimeShort, toLocalDateTimeLong } from '../utils/time'
import { formatSeasonName, resolveFirstName, resolveDisplayName } from '../utils/format'

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
// Phase 18, Part 3 — locked/completed gameweeks still show real fixtures
// below (FixtureCard already renders each fixture's own status/score
// correctly, untouched); this only controls the section's own heading so
// it never says "Upcoming fixtures" over a gameweek whose deadline has
// already passed, or "This gameweek" over one the user has navigated away
// from "this" week to view.
const FIXTURE_SECTION_TITLE = {
  live: 'Live fixtures',
  locked: 'Fixtures',
  completed: 'Results',
  upcoming: 'Upcoming fixtures',
}
// Phase 12, Part 6/16 — display order for the sidebar's per-mode
// leaderboard blocks, matching the order in the brief's own mockup.
// Modes the viewer isn't in simply don't produce a block (§6: "If the
// user is not in a particular mode, do not show an empty leaderboard").
const MODE_ORDER = ['score_predictor', 'last_man_standing', 'pick5']

// Phase 11, Part 2/9; Phase 12, Part 10; Phase 18 — one state machine for
// "what's this gameweek doing right now", shared by the hero, the summary
// card, the sidebar status panel, AND the fixture section header, so the
// same gameweek is never described two different ways on one page (Part
// 9's explicit requirement). Takes a single, already-selected gameweek —
// Phase 18 replaced the old currentGw-vs-nextGw pair with real Prev/
// Current/Next navigation (see Dashboard() below), and "which gameweek"
// is now decided once, before this function ever runs, not inside it.
//
// Real bug fixed in the same change: the old signature's locked branch
// was gated on `currentGw &&`, but `useCurrentGameweek()` (is_current =
// true) has never once returned a row on this project's own data
// (ISSUE-39) — so that gate was permanently false, meaning a gameweek
// whose deadline had genuinely passed could never show as "Locked"; it
// fell through to "Upcoming" with a countdown target already in the
// past. Locked status now derives purely from the gameweek's own
// deadline_utc, matching business-rules.md's own deadline concept and
// Part 3's explicit "a locked gameweek must still show as locked"
// requirement — independent of any is_current flag.
function resolveGameweekState(gw) {
  if (!gw) return null

  const fixtures = gw.fixtures ?? []
  const live = fixtures.filter((f) => f.status === 'live')
  const finished = fixtures.filter((f) => f.status === 'finished')
  const deadlinePassed = gw.deadline_utc ? isPastDeadline(gw.deadline_utc) : false
  // Phase 18 — mid-session addition: users need the actual picks-lock
  // moment, not just kickoff. `deadline_utc` is the exact same field
  // every pot page's own `isPastDeadline(gw.deadline_utc)`/canPick check
  // already gates submission on (PredictorPotDetail.jsx,
  // LmsPotDetail.jsx, PotDetail.jsx) — reused as-is, never inferred from
  // kickoff. Computed once here, for every status branch, so the header
  // can show "Gameweek starts" and "Picks lock"/"Picks locked" side by
  // side regardless of which state the gameweek is in.
  //
  // Phase 19 — this used to recompute "earliest kickoff" itself from
  // `fixtures`, a second, independent implementation of exactly what
  // `refresh_gameweek_deadlines()` (migration 029/030) already computes
  // and stores as `gw.earliest_kickoff_utc` — trusting that field
  // directly instead is both simpler and, since that same migration now
  // excludes unconfirmed (`'tbd'`) fixtures from the calculation, is the
  // only way this correctly comes back `null` (never a fabricated
  // `00:00` placeholder) when a gameweek's fixtures don't have confirmed
  // kickoff times yet.
  const startsAt = gw.earliest_kickoff_utc ?? null

  if (live.length > 0) {
    return { gw, status: 'live', detail: `${live.length} match${live.length === 1 ? '' : 'es'} live now`, startsAt, deadlinePassed }
  }
  if (fixtures.length > 0 && finished.length === fixtures.length) {
    return { gw, status: 'completed', detail: 'Gameweek complete', startsAt, deadlinePassed }
  }
  if (deadlinePassed) {
    return { gw, status: 'locked', detail: 'Results are being finalised', startsAt, deadlinePassed }
  }

  return {
    gw,
    status: 'upcoming',
    detail: startsAt ? `Starts ${toLocalTimeShort(startsAt)}` : 'Time TBC',
    startsAt,
    deadlinePassed,
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
      <span className="min-w-0 flex-1 truncate text-xs text-white/70">{resolveDisplayName(row.profiles) ?? 'Unknown'}</span>
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
// entrant ties for first, so a numeric rank is the wrong headline.
//
// Phase 25 — replaced the "top 3 still-alive names" list (an arbitrary,
// not-very-useful slice for a competition with no numeric rank) with real
// competition-state stats: remaining/eliminated/total entrants and the
// current round. Survival counts now come from `potStatus.lmsSurvival`
// (useDashboardPotStatus, usePots.js) rather than re-deriving them from
// `rows` (pot_standings_snapshots) a second way — that source excludes
// voided entries, so it was never a trustworthy "total entrants" anyway,
// and this way there's exactly one place LMS survival counts are computed
// for the whole Dashboard (the pot cards above already trust the same
// field). `rows`/`userId` still used for the viewer's own alive/eliminated
// badge, the one thing this component's own leaderboard query answers that
// lmsSurvival doesn't (identifies the fact for *this specific user*).
function LmsLeaderboardBody({ rows, userId, survival, currentRound }) {
  const myRow = rows.find((r) => r.user_id === userId)
  const myStatus = myRow?.meta?.competitiveStatus ?? 'alive'

  if (!survival) return <p className="text-xs text-white/35">No standings yet.</p>

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-medium text-accent">{survival.alive} remaining</span>
        {survival.eliminated > 0 && <span className="text-white/40">{survival.eliminated} eliminated</span>}
        <span className="text-white/35">{survival.total} entrant{survival.total === 1 ? '' : 's'}</span>
        {currentRound != null && <span className="text-white/35">Round {currentRound}</span>}
      </div>
      {myRow && (
        <div className="flex items-center gap-2 rounded-lg bg-white/5 px-1.5 py-1">
          <Badge status={myStatus} />
          <span className="text-xs text-white/60">{myStatus === 'eliminated' ? 'You were eliminated' : "You're still in it"}</span>
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
function ModeLeaderboardBlock({ gameType, pots, userId, potStatus }) {
  const [index, setIndex] = useState(0)
  const safeIndex = Math.min(index, pots.length - 1)
  const pot = pots[safeIndex]
  const { data: rows = [], isLoading } = useLeaderboard(pot.id, null)
  const Icon = GAME_TYPE_ICONS[gameType] || Trophy
  const label = GAME_TYPE_LABELS[gameType] || gameType
  const status = potStatus?.get(pot.id)

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
        <LmsLeaderboardBody rows={rows} userId={userId} survival={status?.lmsSurvival} currentRound={status?.nextGameweek?.number} />
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

  // Phase 18 — Dashboard gameweek navigation. `defaultGw` is exactly the
  // old currentGw-or-nextGw smart default (unchanged logic), used only to
  // seed the INITIAL selection and to resolve which league/season's full
  // gameweek list to fetch — never re-applied over a selection the user
  // has already made (the effect below only fires once, when nothing is
  // selected yet).
  const defaultGw = currentGw ?? nextGw
  const [selectedGameweekId, setSelectedGameweekId] = useState(null)
  useEffect(() => {
    if (selectedGameweekId === null && defaultGw?.id) setSelectedGameweekId(defaultGw.id)
  }, [selectedGameweekId, defaultGw?.id])

  // Lightweight (no fixtures) full-season list, scoped to the same
  // league/season the smart default already resolved — drives Prev/Next
  // bounds. Real, previously-unused/unscoped hook fixed for this purpose,
  // see useGameweek.js's own comment.
  const { data: allGameweeks = [] } = useAllGameweeks(defaultGw?.league_id, defaultGw?.season_id)
  const gwIndex = allGameweeks.findIndex((g) => g.id === selectedGameweekId)
  const canGoPrev = gwIndex > 0
  const canGoNext = gwIndex >= 0 && gwIndex < allGameweeks.length - 1
  const goPrevGameweek = () => canGoPrev && setSelectedGameweekId(allGameweeks[gwIndex - 1].id)
  const goNextGameweek = () => canGoNext && setSelectedGameweekId(allGameweeks[gwIndex + 1].id)

  // The one full-fixture fetch for whichever gameweek is actually
  // displayed — same useGameweek(id) hook GameweekPage already uses,
  // reused rather than duplicated. Always sourced this way (even when
  // selectedGameweekId === defaultGw.id) because useLiveScores below
  // invalidates the ['gameweek', id] query key specifically; reusing
  // currentGw/nextGw's own data for the default case would silently never
  // pick up a live update.
  const { data: selectedGwFull, isLoading: selectedGwLoading } = useGameweek(selectedGameweekId)
  const gwState = resolveGameweekState(selectedGwFull)
  const displayGw = gwState?.gw ?? null

  // Same realtime channel GameweekPage.jsx already relies on — no second
  // subscription. Targets whichever gameweek is currently selected (Part
  // 8: "Live now" reflects the selected gameweek, not a hardcoded one).
  useLiveScores(selectedGameweekId, null)

  const fixtures = displayGw?.fixtures ?? []
  const sortedFixtures = fixtures.slice().sort((a, b) => {
    const rank = (f) => (f.status === 'live' ? 0 : f.status === 'scheduled' || f.status === 'tbd' ? 1 : 2)
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    return new Date(a.kickoff_utc) - new Date(b.kickoff_utc)
  })
  const liveFixtures = gwState?.status === 'live' ? sortedFixtures.filter((f) => f.status === 'live') : []

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
  // Phase 25 — this used to be ~20 lines of inline email-detection logic;
  // extracted into utils/format.js's resolveFirstName() (same behaviour,
  // unchanged) so every place showing user identity (TopNav, Avatar, here)
  // shares one implementation instead of Dashboard alone knowing to guard
  // against display_name being an email.
  const firstName = resolveFirstName(profile) || 'there'
  // Before any gameweek is selected yet, "loading" means resolving the
  // smart default (old behaviour, unchanged); once a selection exists,
  // it means fetching THAT gameweek's own full fixture data. Drives the
  // "Live now" tile and the browsable fixture section below — both of
  // those are genuinely about whichever gameweek the user is currently
  // looking at.
  const loadingBrowsedGw = selectedGameweekId === null
    ? (gwLoading || (nextGwLoading && !currentGw))
    : selectedGwLoading
  const statusMeta = gwState ? GAMEWEEK_STATUS_META[gwState.status] : null

  // Part 17 — the "Next gameweek" summary tile is a global dashboard fact
  // ("what's coming up next"), not a view onto whatever the user happens
  // to be browsing in the Prev/Next navigation below (section C). It used
  // to read `gwState` (derived from `selectedGwFull`, the BROWSED
  // gameweek) — found live: paging Prev/Next there changed this tile too,
  // since both shared the same derived state. Recomputed here from
  // `defaultGw` (`currentGw ?? nextGw`) directly, completely independent
  // of `selectedGameweekId` — this is exactly what the tile already
  // showed before the user ever touched the browser below, now held
  // fixed regardless of what they do down there.
  const nextGwState = resolveGameweekState(defaultGw)
  const loadingNextGwTile = gwLoading || (nextGwLoading && !currentGw)

  // Phase 14, Part 12 — this root used to also carry `max-w-[1400px]
  // mx-auto`, which was dead code: AppShell's own shared container (then
  // max-w-6xl, 1152px) was always narrower, so the constraint never
  // actually bound and `mx-auto` had zero extra space to center into.
  // Removed now that AppShell itself provides the one real shared width
  // (matched to TopNav's, see AppShell.jsx's own comment) — Dashboard
  // just fills it like every other page, rather than layering a second,
  // silently inert container on top.
  return (
    <div className="space-y-8">
      {/* A. Welcome header — deliberately OUTSIDE the two-column grid below
          (a full-width sibling above it, not the grid's left-column child
          it used to be). With `items-start`, a CSS grid aligns its columns'
          top edges to the grid's own top row — as long as the header lived
          inside only the left column, the sidebar (the right column, with
          nothing above it) started a header's-height higher than the
          summary-tile row. Moving the header above the grid entirely means
          both columns now genuinely start at the same row with no fixed
          height/spacer needed — the fix holds regardless of how tall the
          header wraps to at any width. */}
      <section>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Welcome back, {firstName}</h1>
        <p className="mt-1 text-sm text-white/45">Here&apos;s what&apos;s happening in your competitions.</p>
      </section>

      <div className="space-y-8 lg:grid lg:grid-cols-[1fr_380px] lg:items-start lg:gap-8 lg:space-y-0">
      <div className="space-y-8 min-w-0">
        {/* B. Summary cards */}
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryCard icon={CalendarClock} label="Next gameweek">
            {loadingNextGwTile ? (
              <div className="h-10 animate-pulse rounded-lg bg-white/5" />
            ) : nextGwState ? (
              <>
                <p className="font-semibold text-white">Gameweek {nextGwState.gw.number}</p>
                <p className="mt-0.5 text-xs text-white/45">{nextGwState.detail}</p>
                {/* Counts down to the picks-lock deadline (deadline_utc, the
                    same single-source-of-truth field every pot page's own
                    canPick check already gates on), never gameweek/kickoff
                    start — a countdown to "starts" would still read a
                    positive number after picks had already locked. */}
                {nextGwState.status === 'upcoming' && nextGwState.gw.deadline_utc && !nextGwState.deadlinePassed && (
                  <CountdownTimer deadlineUtc={nextGwState.gw.deadline_utc} showSeconds={false} className="mt-1 text-xs" />
                )}
              </>
            ) : (
              <p className="text-xs text-white/35">No gameweek scheduled</p>
            )}
          </SummaryCard>

          <SummaryCard icon={Radio} label="Live now">
            {loadingBrowsedGw ? (
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

        {/* C. Gameweek navigation + fixtures — Phase 18. Real Prev/
            Current/Next navigation through the same league/season's
            gameweeks (Part 1/2), while always showing the FULL fixture
            list for whichever gameweek is selected — live, locked,
            completed, or upcoming (Part 3: a locked/completed gameweek
            must never fall back to an empty state). The nav header and
            the fixture-list heading both read the one shared gwState
            (Part 9) so they can never disagree with each other or with
            the sidebar's own status card below. */}
        <section>
          <div className="mb-5 rounded-2xl border border-white/8 bg-surface-1 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2 sm:gap-4">
              <button
                type="button"
                onClick={goPrevGameweek}
                disabled={!canGoPrev}
                aria-label="Previous gameweek"
                title="Previous gameweek"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-surface-2 text-white/60 transition-colors hover:border-accent/30 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft size={16} />
              </button>

              <div className="min-w-0 flex-1 text-center">
                <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-white/35">
                  {displayGw?.leagues?.name ?? 'Premier League'}
                </p>
                <div className="mt-0.5 flex items-center justify-center gap-2">
                  <h2 className="truncate text-xl font-bold text-white">
                    {gwState ? `Gameweek ${gwState.gw.number}` : 'No gameweek'}
                  </h2>
                  {statusMeta && <Badge status={statusMeta.badge}>{statusMeta.label}</Badge>}
                </div>
                {!gwState && <p className="mt-1 truncate text-sm text-white/45">No gameweek scheduled yet</p>}
                {(gwState?.status === 'live' || gwState?.status === 'completed') && (
                  <p className="mt-1 truncate text-sm text-white/45">{gwState.detail}</p>
                )}
              </div>

              <button
                type="button"
                onClick={goNextGameweek}
                disabled={!canGoNext}
                aria-label="Next gameweek"
                title="Next gameweek"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-surface-2 text-white/60 transition-colors hover:border-accent/30 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Phase 18 (mid-session addition) — the actual picks-lock
                moment, not just kickoff. `deadline_utc` is the exact same
                field every pot page's own submission gate already checks
                (isPastDeadline(gw.deadline_utc), unchanged there) — shown
                here as-is, never inferred from the kickoff time next to
                it. Reuses CountdownTimer, the same component every pot
                page's own deadline countdown already uses, instead of a
                second countdown implementation. No countdown once the
                deadline has passed — a ticking timer past zero would be
                actively misleading. */}
            {gwState && (
              <div className="mt-4 grid grid-cols-1 gap-3 border-t border-white/8 pt-4 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-white/35">Gameweek starts</p>
                  <p className="mt-1 text-sm font-medium text-white">
                    {gwState.startsAt ? toLocalDateTimeLong(gwState.startsAt) : 'Time TBC'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-white/35">
                    {gwState.deadlinePassed ? 'Picks locked' : 'Picks lock'}
                  </p>
                  {displayGw?.deadline_utc ? (
                    <>
                      <p className="mt-1 text-sm font-medium text-white">
                        {gwState.deadlinePassed
                          ? (gwState.status === 'locked'
                              ? `Locked at ${toLocalDateTimeLong(displayGw.deadline_utc)}`
                              : toLocalDateTimeLong(displayGw.deadline_utc))
                          : toLocalDateTimeLong(displayGw.deadline_utc)}
                      </p>
                      {!gwState.deadlinePassed && (
                        <CountdownTimer deadlineUtc={displayGw.deadline_utc} showSeconds={false} className="mt-1 text-xs text-accent" />
                      )}
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-white/40">Time TBC</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-white">
                {gwState ? FIXTURE_SECTION_TITLE[gwState.status] : 'Fixtures'}
              </h3>
              {gwState && (
                <p className="mt-0.5 text-sm text-white/40">
                  {displayGw?.leagues?.name} · Gameweek {gwState.gw.number}
                </p>
              )}
            </div>
            {displayGw && (
              <Link
                to="/standings"
                state={{
                  leagueId: displayGw.league_id,
                  seasonId: displayGw.season_id,
                  leagueName: displayGw.leagues?.name,
                }}
                className="shrink-0 text-sm font-medium text-accent hover:underline"
              >
                View standings
              </Link>
            )}
          </div>
          {loadingBrowsedGw ? (
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
          the only place a piece of information lives.
          The former "Gameweek status" card was removed here (Phase 25) —
          every fact it showed (gameweek number/status badge, live/completed
          detail, picks-lock countdown) was already shown, with equal or
          greater detail, in the main gameweek header above (section
          C/D) — a pure duplicate, not a second source of truth. Leaderboards
          now gets the reclaimed space at the top of the sidebar instead of
          second. */}
      <div className="hidden lg:block lg:space-y-5">
        {pots.length > 0 && (
          <div className="rounded-2xl border border-white/8 bg-surface-1 p-5">
            <h3 className="mb-3 text-sm font-semibold text-white">Leaderboards</h3>
            <div className="space-y-5">
              {MODE_ORDER.filter((mode) => potsByMode.has(mode)).map((mode) => (
                <ModeLeaderboardBlock key={mode} gameType={mode} pots={potsByMode.get(mode)} userId={user?.id} potStatus={potStatus} />
              ))}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-white/8 bg-surface-1 p-5">
          <h3 className="mb-3 text-sm font-semibold text-white">Quick actions</h3>
          <div className="space-y-1.5">
            <Link to="/pots?create=true" className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white">
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
    </div>
  )
}
