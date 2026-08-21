import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Users,
  Trophy,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  Radio,
  Settings,
} from 'lucide-react'
import { supabase, extractFunctionError } from '../lib/supabase'
import Card from '../components/ui/Card'
import Spinner from '../components/ui/Spinner'
import Toast from '../components/ui/Toast'
import EmptyState from '../components/ui/EmptyState'
import Modal from '../components/ui/Modal'
import Button from '../components/ui/Button'
import LmsPotDetail from '../components/pot/LmsPotDetail'
import PredictorPotDetail from '../components/pot/PredictorPotDetail'
import JackpotCard from '../components/pot/pick5/JackpotCard'
import EntryStatusBar from '../components/pot/pick5/EntryStatusBar'
import MemberCard from '../components/pot/pick5/MemberCard'
import Pick5FixturePicker from '../components/pot/pick5/Pick5FixturePicker'
import PicksSummaryPanel from '../components/pot/pick5/PicksSummaryPanel'
import { useAuthStore } from '../store/authStore'
import { useRemoveMember } from '../hooks/useMembership'
import { useFixturesForGameweek } from '../hooks/usePredictorEntry'
import { formatSeasonName } from '../utils/format'

const PAGE_SIZE = 1000
const MAX_PICKS = 5
const MAX_SAME_PLAYER = 5

function formatDeadline(deadline) {
  if (!deadline) return 'No deadline set'
  return new Date(deadline).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatCurrency(amount) {
  return `€${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function PotDetailPage() {
  const { potId } = useParams()
  const { user } = useAuthStore()
  const removeMember = useRemoveMember()
  const [pendingRemoval, setPendingRemoval] = useState(null)

  const [pot, setPot] = useState(null)
  const [members, setMembers] = useState([])
  const [gameweeks, setGameweeks] = useState([])
  const [selectedGameweekId, setSelectedGameweekId] = useState('')

  const [allFilterRows, setAllFilterRows] = useState([])
  const [shirtNumbers, setShirtNumbers] = useState(new Map())
  const [savedEntry, setSavedEntry] = useState(null)
  const [savedPicks, setSavedPicks] = useState([])
  const [memberEntries, setMemberEntries] = useState([])

  // Payment/jackpot state — Pick 5 Dashboard Redesign. Both read data that
  // already existed and was already readable under this pot's own RLS
  // (entry_payments_select_member, pot_prizes_select_member) — nothing new
  // was added on the backend, this page just never surfaced it before
  // (ISSUE-44).
  const [payments, setPayments] = useState([])
  const [paymentsLoading, setPaymentsLoading] = useState(true)
  const [jackpotHistory, setJackpotHistory] = useState({
    rolledOverAmount: 0,
    weeksSinceLastWinner: 0,
    hasSettledHistory: false,
  })
  const [jackpotLoading, setJackpotLoading] = useState(true)

  const [selectedPlayers, setSelectedPlayers] = useState([])

  const [activeTab, setActiveTab] = useState('entry')
  const [mobilePicksOpen, setMobilePicksOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [membersLoading, setMembersLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  async function fetchAllRows(queryBuilderFactory) {
    let allRows = []
    let from = 0
    let keepGoing = true

    while (keepGoing) {
      const { data, error } = await queryBuilderFactory().range(from, from + PAGE_SIZE - 1)

      if (error) throw error

      const rows = data || []
      allRows = allRows.concat(rows)

      if (rows.length < PAGE_SIZE) {
        keepGoing = false
      } else {
        from += PAGE_SIZE
      }
    }

    return allRows
  }

  // Sprint 2 audit: available_players_by_gameweek can legitimately return more
  // than one row per player_id (player_team_history has no "one active team
  // per player" constraint — confirmed live, several players carry stale
  // is_active=true rows on a prior club after a transfer, ISSUE-40). Left as
  // a data question for the repo owner rather than guessed at, but the picker
  // itself must never render two entries with the same key regardless — React
  // already warns on the duplicate key, and a player could otherwise appear
  // pickable twice under two different team badges.
  function dedupeByPlayerId(rows) {
    const seen = new Set()
    return rows.filter((row) => {
      if (seen.has(row.player_id)) return false
      seen.add(row.player_id)
      return true
    })
  }

  async function loadPot() {
    const { data, error } = await supabase
      .from('pots')
      .select(`
        id,
        name,
        status,
        game_type,
        invite_code,
        season_id,
        league_id,
        entry_fee,
        created_by,
        predictor_scorer_scope,
        seasons (
          id,
          name,
          year_start,
          year_end,
          is_current
        ),
        leagues (
          id,
          name,
          country
        )
      `)
      .eq('id', potId)
      .single()

    if (error) throw error
    setPot(data)
    return data
  }

  async function loadMembers() {
    const { data, error } = await supabase
      .from('pot_members')
      .select(`
        id,
        user_id,
        role,
        joined_at,
        profiles (
          id,
          username,
          display_name,
          avatar_url
        )
      `)
      .eq('pot_id', potId)
      .order('joined_at', { ascending: true })

    if (error) throw error
    setMembers(data || [])
  }

  async function loadGameweeks(potRow) {
    const { data, error } = await supabase
      .from('gameweeks')
      .select('id, number, name, status, is_current, deadline_utc')
      .eq('league_id', potRow.league_id)
      .eq('season_id', potRow.season_id)
      .order('number', { ascending: true })

    if (error) throw error

    const rows = data || []
    setGameweeks(rows)

    const currentGameweek =
      rows.find((gw) => gw.is_current) ||
      rows.find((gw) => gw.status === 'upcoming') ||
      rows[0]

    if (currentGameweek) {
      setSelectedGameweekId(String(currentGameweek.id))
    }
  }

  // Current jackpot = whatever unclaimed prize rolled forward from the most
  // recently settled gameweek (pot_prizes.net_amount, only when
  // rollover = true — both written by Pick5Engine.awardPrize(), never
  // recomputed here) plus this gameweek's own paid entries. "Weeks since
  // last winner" is a plain count of consecutive rollover=true rows,
  // stopping at the first real winner — reading facts the engine already
  // settled, not re-deriving them.
  async function loadJackpotHistory() {
    setJackpotLoading(true)
    try {
      const { data, error } = await supabase
        .from('pot_prizes')
        .select('gameweek_id, net_amount, rollover, gameweeks(number)')
        .eq('pot_id', potId)
        .eq('scope', 'gameweek')
        .eq('is_settled', true)

      if (error) throw error

      const rows = (data || []).slice().sort((a, b) => (b.gameweeks?.number ?? 0) - (a.gameweeks?.number ?? 0))
      const mostRecent = rows[0] || null

      let streak = 0
      for (const row of rows) {
        if (row.rollover) streak += 1
        else break
      }

      setJackpotHistory({
        rolledOverAmount: mostRecent?.rollover ? Number(mostRecent.net_amount) : 0,
        weeksSinceLastWinner: streak,
        hasSettledHistory: rows.length > 0,
      })
    } finally {
      setJackpotLoading(false)
    }
  }

  async function loadPayments(gameweekId) {
    if (!gameweekId) {
      setPayments([])
      return
    }

    setPaymentsLoading(true)
    try {
      const { data, error } = await supabase
        .from('entry_payments')
        .select('user_id, is_paid')
        .eq('pot_id', potId)
        .eq('gameweek_id', Number(gameweekId))

      if (error) throw error
      setPayments(data || [])
    } finally {
      setPaymentsLoading(false)
    }
  }

  async function loadFilterSourceRows(gameweekId) {
    if (!gameweekId) {
      setAllFilterRows([])
      return
    }

    const rows = await fetchAllRows(() =>
      supabase
        .from('available_players_by_gameweek')
        .select(`
          player_id,
          display_name,
          position,
          photo_url,
          team_id,
          team_name,
          team_short_name,
          crest_url,
          gameweek_id,
          gameweek_number
        `)
        .eq('gameweek_id', Number(gameweekId))
        .neq('position', 'Goalkeeper')
        .order('display_name', { ascending: true })
    )

    setAllFilterRows(dedupeByPlayerId(rows))
  }

  // Phase 8B — fixture-first picker: shirt numbers, in bulk (one query per
  // gameweek's whole player set, not per player) for the new PlayerCard's
  // "shirt number (if available)" field. player_team_history.shirt_number
  // is nullable — genuinely absent for some players, not a loading gap;
  // PlayerCard already renders nothing when it's missing.
  async function loadShirtNumbers(playerIds) {
    if (!playerIds.length || !pot) {
      setShirtNumbers(new Map())
      return
    }

    const { data, error } = await supabase
      .from('player_team_history')
      .select('player_id, shirt_number')
      .eq('season_id', pot.season_id)
      .eq('is_active', true)
      .in('player_id', playerIds)

    if (error) {
      setShirtNumbers(new Map())
      return
    }

    setShirtNumbers(new Map((data || []).map((row) => [row.player_id, row.shirt_number])))
  }

  async function loadSavedEntry(gameweekId) {
    if (!gameweekId) {
      setSavedEntry(null)
      setSavedPicks([])
      return
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError) throw userError
    if (!user) {
      setSavedEntry(null)
      setSavedPicks([])
      return
    }

    // Milestone 4 frontend cutover: game_entries/pick5_picks (Game Engine
    // schema), not the retired user_entries/user_entry_picks. A plain read,
    // never auto-creating — matches the pre-cutover UX exactly (no entry
    // exists until the user actually saves picks, via handleSaveEntry()'s
    // get-or-create-pick5-entry call below).
    const { data: entryRow, error: entryError } = await supabase
      .from('game_entries')
      .select(`
        id,
        status,
        created_at,
        gameweek_id
      `)
      .eq('pot_id', potId)
      .eq('user_id', user.id)
      .eq('gameweek_id', Number(gameweekId))
      .maybeSingle()

    if (entryError) throw entryError

    if (!entryRow) {
      setSavedEntry(null)
      setSavedPicks([])
      return
    }

    setSavedEntry(entryRow)

    const { data: picksRows, error: picksError } = await supabase
      .from('pick5_picks')
      .select(`
        id,
        pick_position,
        goal_threshold,
        player_id,
        players (
          id,
          display_name,
          position
        )
      `)
      .eq('game_entry_id', entryRow.id)
      .order('pick_position', { ascending: true })

    if (picksError) throw picksError

    const playerIds = (picksRows || []).map((pick) => pick.player_id)
    let teamHistoryMap = new Map()

    if (playerIds.length > 0 && pot) {
      const { data: historyRows, error: historyError } = await supabase
        .from('player_team_history')
        .select(`
          player_id,
          team_id,
          teams (
            id,
            name,
            short_name,
            crest_url
          )
        `)
        .eq('season_id', pot.season_id)
        .in('player_id', playerIds)
        .eq('is_active', true)

      if (historyError) throw historyError

      teamHistoryMap = new Map(
        (historyRows || []).map((row) => [
          row.player_id,
          {
            team_name: row.teams?.name || '',
            team_short_name: row.teams?.short_name || '',
            crest_url: row.teams?.crest_url || null,
          },
        ])
      )
    }

    const normalizedPicks = (picksRows || []).map((pick) => {
      const team = teamHistoryMap.get(pick.player_id)

      return {
        player_id: pick.player_id,
        display_name: pick.players?.display_name || 'Unknown player',
        position: pick.players?.position || 'Player',
        team_name: team?.team_name || '',
        team_short_name: team?.team_short_name || '',
        crest_url: team?.crest_url || null,
      }
    })

    setSavedPicks(normalizedPicks)
  }

  async function loadMemberEntries(gameweekId) {
    if (!gameweekId || members.length === 0) {
      setMemberEntries([])
      return
    }

    setMembersLoading(true)

    try {
      const memberUserIds = members.map((member) => member.user_id).filter(Boolean)

      if (memberUserIds.length === 0) {
        setMemberEntries([])
        return
      }

      const { data: entriesRows, error: entriesError } = await supabase
        .from('game_entries')
        .select(`
          id,
          user_id,
          status,
          created_at,
          gameweek_id
        `)
        .eq('pot_id', potId)
        .eq('gameweek_id', Number(gameweekId))
        .in('user_id', memberUserIds)

      if (entriesError) throw entriesError

      const entryIds = (entriesRows || []).map((row) => row.id)

      let picksRows = []

      if (entryIds.length > 0) {
        const { data: rawPicks, error: picksError } = await supabase
          .from('pick5_picks')
          .select(`
            id,
            game_entry_id,
            pick_position,
            player_id,
            players (
              id,
              display_name,
              position
            )
          `)
          .in('game_entry_id', entryIds)
          .order('pick_position', { ascending: true })

        if (picksError) throw picksError
        picksRows = rawPicks || []
      }

      const playerIds = picksRows.map((pick) => pick.player_id)
      let teamHistoryMap = new Map()

      if (playerIds.length > 0 && pot) {
        const { data: historyRows, error: historyError } = await supabase
          .from('player_team_history')
          .select(`
            player_id,
            teams (
              id,
              name,
              short_name,
              crest_url
            )
          `)
          .eq('season_id', pot.season_id)
          .in('player_id', playerIds)
          .eq('is_active', true)

        if (historyError) throw historyError

        teamHistoryMap = new Map(
          (historyRows || []).map((row) => [
            row.player_id,
            {
              team_name: row.teams?.name || '',
              team_short_name: row.teams?.short_name || '',
              crest_url: row.teams?.crest_url || null,
            },
          ])
        )
      }

      const picksByEntryId = new Map()

      picksRows.forEach((pick) => {
        const current = picksByEntryId.get(pick.game_entry_id) || []
        const team = teamHistoryMap.get(pick.player_id)

        current.push({
          id: pick.id,
          pick_position: pick.pick_position,
          player_id: pick.player_id,
          display_name: pick.players?.display_name || 'Unknown player',
          position: pick.players?.position || 'Player',
          team_name: team?.team_name || '',
          team_short_name: team?.team_short_name || '',
          crest_url: team?.crest_url || null,
        })

        picksByEntryId.set(pick.game_entry_id, current)
      })

      const merged = members.map((member) => {
        const entry = (entriesRows || []).find((row) => row.user_id === member.user_id)

        return {
          member,
          hasEntry: Boolean(entry),
          // game_entries has no submitted_at column — created_at is the
          // equivalent moment, since the row is created lazily at first
          // save (get-or-create-pick5-entry), not at page view.
          entryStatus: entry?.status || 'not_submitted',
          submittedAt: entry?.created_at || null,
          picks: entry ? picksByEntryId.get(entry.id) || [] : [],
        }
      })

      setMemberEntries(merged)
    } finally {
      setMembersLoading(false)
    }
  }

  useEffect(() => {
    async function init() {
      try {
        setLoading(true)
        setErrorMessage('')

        const potRow = await loadPot()
        await Promise.all([loadMembers(), loadGameweeks(potRow)])
        await loadJackpotHistory()
      } catch (err) {
        setErrorMessage(err.message || 'Failed to load pot')
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [potId])

  useEffect(() => {
    async function syncFilterData() {
      try {
        setErrorMessage('')
        await loadFilterSourceRows(selectedGameweekId)
      } catch (err) {
        setErrorMessage(err.message || 'Failed to load filter options')
      }
    }

    syncFilterData()
  }, [selectedGameweekId])

  // Phase 8B — shirt numbers loaded once per gameweek's player set
  // (allFilterRows, already fetched above), not per keystroke — there's no
  // search/filter UI left to debounce against now that the picker is
  // fixture-first.
  useEffect(() => {
    loadShirtNumbers(allFilterRows.map((p) => p.player_id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFilterRows, pot])

  useEffect(() => {
    async function syncSavedEntry() {
      try {
        setErrorMessage('')
        await loadSavedEntry(selectedGameweekId)
      } catch (err) {
        setErrorMessage(err.message || 'Failed to load saved entry')
      }
    }

    if (pot) {
      syncSavedEntry()
    }
  }, [pot, selectedGameweekId])

  useEffect(() => {
    if (savedPicks.length > 0) {
      setSelectedPlayers(savedPicks)
    } else {
      setSelectedPlayers([])
    }
  }, [savedPicks])

  useEffect(() => {
    async function syncMemberEntries() {
      try {
        setErrorMessage('')
        await loadMemberEntries(selectedGameweekId)
      } catch (err) {
        setErrorMessage(err.message || 'Failed to load member entries')
      }
    }

    if (pot && members.length > 0) {
      syncMemberEntries()
    } else {
      setMemberEntries([])
    }
  }, [pot, members, selectedGameweekId])

  useEffect(() => {
    async function syncPayments() {
      try {
        await loadPayments(selectedGameweekId)
      } catch (err) {
        setErrorMessage(err.message || 'Failed to load payment status')
      }
    }

    syncPayments()
  }, [selectedGameweekId])

  const selectedGameweek = useMemo(
    () => gameweeks.find((gw) => String(gw.id) === String(selectedGameweekId)) || null,
    [gameweeks, selectedGameweekId]
  )

  const deadlineClosed = useMemo(() => {
    if (!selectedGameweek?.deadline_utc) return false
    return new Date(selectedGameweek.deadline_utc).getTime() <= Date.now()
  }, [selectedGameweek])

  // Phase 8B — fixture-first picker. Reused as-is from Score Predictor's
  // own hook (usePredictorEntry.js) — a plain "fixtures for this
  // gameweek" query has no Pick5-specific logic to duplicate.
  const { data: fixtures = [], isLoading: fixturesLoading } = useFixturesForGameweek(
    selectedGameweekId ? Number(selectedGameweekId) : null
  )

  const isPotAdmin = useMemo(
    () => members.some((m) => m.user_id === user?.id && m.role === 'admin'),
    [members, user]
  )

  const paidCount = useMemo(() => payments.filter((p) => p.is_paid).length, [payments])
  const thisWeekContribution = useMemo(
    () => paidCount * Number(pot?.entry_fee || 0),
    [paidCount, pot]
  )
  const myPayment = useMemo(
    () => payments.find((p) => p.user_id === user?.id) || null,
    [payments, user]
  )

  const memberEntriesWithPayments = useMemo(
    () =>
      memberEntries.map((entryRow) => ({
        ...entryRow,
        isPaid: payments.find((p) => p.user_id === entryRow.member.user_id)?.is_paid ?? false,
      })),
    [memberEntries, payments]
  )

  async function handleConfirmRemoveMember() {
    if (!pendingRemoval) return
    try {
      await removeMember.mutateAsync({ potId, userId: pendingRemoval.user_id })
      setMessage(`${pendingRemoval.profiles?.display_name || 'Member'} removed from the pot`)
      setPendingRemoval(null)
      await loadMembers()
    } catch (err) {
      setErrorMessage(err.message || 'Failed to remove member')
    }
  }

  function getPlayerPickCount(playerId) {
    return selectedPlayers.filter((player) => player.player_id === playerId).length
  }

  function addPlayer(player) {
    if (selectedPlayers.length >= MAX_PICKS) {
      setErrorMessage(`You can only choose ${MAX_PICKS} total picks`)
      return
    }

    const playerCount = getPlayerPickCount(player.player_id)

    if (playerCount >= MAX_SAME_PLAYER) {
      setErrorMessage(`You can only select the same player ${MAX_SAME_PLAYER} times`)
      return
    }

    setErrorMessage('')
    setSelectedPlayers((current) => [...current, player])
  }

  function removePickByIndex(indexToRemove) {
    setSelectedPlayers((current) =>
      current.filter((_, index) => index !== indexToRemove)
    )
  }

  async function handleSaveEntry() {
    try {
      setSaving(true)
      setMessage('')
      setErrorMessage('')

      if (!selectedGameweekId) {
        throw new Error('Select a gameweek')
      }

      if (selectedPlayers.length !== MAX_PICKS) {
        throw new Error(`Select exactly ${MAX_PICKS} players`)
      }

      // Milestone 4 frontend cutover: get-or-create-pick5-entry (idempotent
      // — safe to call again on an already-existing entry, e.g. when
      // editing picks before locking) then submit-pick5-picks, which runs
      // Pick5Engine.validateEntry() server-side before writing pick5_picks.
      // Replaces the direct user_entries/user_entry_picks insert+delete+
      // insert dance above — identity is derived from the forwarded JWT
      // inside the Edge Functions, so the separate getUser() call this used
      // to need here is no longer necessary.
      const { data: entryData, error: entryError } = await supabase.functions.invoke(
        'get-or-create-pick5-entry',
        { body: { pot_id: potId, gameweek_id: Number(selectedGameweekId) } }
      )
      if (entryError) throw await extractFunctionError(entryError)
      if (entryData?.error) throw new Error(entryData.error)

      const { data: picksData, error: picksError } = await supabase.functions.invoke(
        'submit-pick5-picks',
        {
          body: {
            game_entry_id: entryData.entry.id,
            player_ids: selectedPlayers.map((player) => player.player_id),
          },
        }
      )
      if (picksError) throw await extractFunctionError(picksError)
      if (picksData?.error) throw new Error(picksData.error)

      await Promise.all([
        loadSavedEntry(selectedGameweekId),
        loadMemberEntries(selectedGameweekId),
      ])

      setMessage('Picks saved successfully')
    } catch (err) {
      setErrorMessage(err.message || 'Failed to save entry')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }

  if (!pot) {
    return (
      <EmptyState
        icon={Trophy}
        title="Pot not found"
        description="This pot could not be loaded."
      />
    )
  }

  // Mode dispatch, mirroring the backend's own per-mode separation (GE-18)
  // at the frontend layer: everything below this point is Pick 5-specific
  // (MAX_PICKS, pick5_picks, get-or-create-pick5-entry) and stays exactly
  // as it was — LMS/Predictor get their own components instead of being
  // crammed into this already-large, Pick5-only state machine.
  if (pot.game_type === 'last_man_standing') {
    return <LmsPotDetail pot={pot} potId={potId} />
  }
  if (pot.game_type === 'score_predictor') {
    return <PredictorPotDetail pot={pot} potId={potId} />
  }

  return (
    <div className="space-y-5">
      {/* Hero — pot identity, jackpot (the headline number for this mode),
          and the key at-a-glance facts. "Available outfield players" was
          dropped entirely (developer-oriented, per the brief); a plain
          member count and entry fee replace it as facts an organiser or
          player actually cares about. */}
      <section className="overflow-hidden rounded-3xl border border-white/8 bg-gradient-to-br from-surface-1 via-surface-2 to-pitch-900 p-4 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
              {pot.leagues?.name || 'Tournament'}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
              {formatSeasonName(pot.seasons)}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60 capitalize">
              {pot.status}
            </span>
          </div>

          {/* Phase 10B, Part 2 — retargeted from /admin/payments straight to
              this pot's own membership-management page (invite/remove
              members, payment verification link), same as
              LmsPotDetail.jsx/PredictorPotDetail.jsx. */}
          {isPotAdmin ? (
            <Link
              to={`/pot/${potId}/manage`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/60 transition-colors hover:text-white"
            >
              <Settings size={13} />
              Manage
            </Link>
          ) : null}
        </div>

        <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">{pot.name}</h1>

        <div className="mt-5 grid gap-4 sm:mt-6 sm:gap-5 lg:grid-cols-[1.3fr_1fr]">
          <JackpotCard
            loading={jackpotLoading || paymentsLoading}
            rolledOverAmount={jackpotHistory.rolledOverAmount}
            weeksSinceLastWinner={jackpotHistory.weeksSinceLastWinner}
            hasSettledHistory={jackpotHistory.hasSettledHistory}
            thisWeekContribution={thisWeekContribution}
          />

          <div className="grid grid-cols-2 gap-3 content-start">
            <div className="rounded-2xl border border-white/8 bg-black/10 p-4">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-white/35">Gameweek</div>
              <div className="font-semibold text-white">
                {selectedGameweek ? `GW${selectedGameweek.number}` : 'Not set'}
              </div>
            </div>

            <div className="rounded-2xl border border-white/8 bg-black/10 p-4">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-white/35">Deadline</div>
              <div className="text-sm font-medium text-white">{formatDeadline(selectedGameweek?.deadline_utc)}</div>
            </div>

            <div className="rounded-2xl border border-white/8 bg-black/10 p-4">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-white/35">Members</div>
              <div className="font-semibold text-white">{members.length}</div>
            </div>

            <div className="rounded-2xl border border-white/8 bg-black/10 p-4">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-white/35">Entry fee</div>
              <div className="font-semibold text-white">{formatCurrency(pot.entry_fee)}</div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-white/6 pt-4 sm:mt-6 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:pt-5">
          <EntryStatusBar
            loading={paymentsLoading}
            isPaid={myPayment?.is_paid ?? false}
            hasEntry={!!savedEntry}
            entryStatus={savedEntry?.status}
            deadlineUtc={selectedGameweek?.deadline_utc}
          />

          {selectedGameweekId && (
            <Link
              to={`/pot/${potId}/gameweek/${selectedGameweekId}`}
              className="group inline-flex items-center justify-center gap-2 rounded-2xl border border-accent/30 bg-accent/10 px-5 py-3 text-sm font-semibold text-accent transition-colors hover:bg-accent/15"
            >
              <Radio size={15} className="animate-pulse" />
              Live scores &amp; standings
              <ChevronRight size={15} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}
        </div>
      </section>

      <section className="space-y-5">
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setActiveTab('entry')}
            className={`rounded-2xl border px-4 py-2 text-sm font-medium transition ${
              activeTab === 'entry'
                ? 'border-accent/30 bg-accent/10 text-accent'
                : 'border-white/10 bg-surface-1 text-white/65 hover:text-white'
            }`}
          >
            Your entry
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('members')}
            className={`rounded-2xl border px-4 py-2 text-sm font-medium transition ${
              activeTab === 'members'
                ? 'border-accent/30 bg-accent/10 text-accent'
                : 'border-white/10 bg-surface-1 text-white/65 hover:text-white'
            }`}
          >
            Members
          </button>
        </div>

        {activeTab === 'entry' ? (
          <div className="md:grid md:grid-cols-[1fr_320px] md:items-start md:gap-5">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">Fixtures</h2>
                  <p className="mt-0.5 text-sm text-white/45">
                    {selectedGameweek ? `GW${selectedGameweek.number} — ${selectedGameweek.name}` : 'Select a gameweek'}
                  </p>
                </div>
                <select
                  value={selectedGameweekId}
                  onChange={(e) => setSelectedGameweekId(e.target.value)}
                  className="rounded-xl border border-white/10 bg-surface-2 px-3 py-2 text-sm text-white outline-none"
                >
                  <option value="">Select a gameweek</option>
                  {gameweeks.map((gw) => (
                    <option key={gw.id} value={gw.id}>
                      GW{gw.number} — {gw.name}
                      {gw.is_current ? ' — Current' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <Pick5FixturePicker
                fixtures={fixtures}
                fixturesLoading={fixturesLoading}
                players={allFilterRows}
                shirtNumbers={shirtNumbers}
                leagueId={pot.league_id}
                seasonId={pot.season_id}
                competitionName={pot.leagues?.name}
                getPlayerPickCount={getPlayerPickCount}
                selectedCount={selectedPlayers.length}
                maxPicks={MAX_PICKS}
                onSelectPlayer={addPlayer}
                deadlineClosed={deadlineClosed}
              />
            </div>

            {/* Persistent picks panel — desktop/tablet only (md+); mobile
                gets the sticky bottom sheet below instead. */}
            <div className="mt-5 hidden md:sticky md:top-4 md:mt-0 md:block">
              <Card className="p-4">
                <PicksSummaryPanel
                  selectedPlayers={selectedPlayers}
                  maxPicks={MAX_PICKS}
                  onRemove={removePickByIndex}
                  onSave={handleSaveEntry}
                  saving={saving}
                  savedEntry={savedEntry}
                  deadlineClosed={deadlineClosed}
                />
              </Card>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <Card className="p-5">
              <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-white">Members</h2>
                  <p className="mt-1 text-sm text-white/45">
                    See who's paid and submitted. Picks are revealed only after the deadline closes.
                  </p>
                </div>

                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/65">
                  {deadlineClosed ? (
                    <span className="inline-flex items-center gap-2">
                      <Eye size={14} />
                      Picks visible
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <EyeOff size={14} />
                      Picks hidden until deadline
                    </span>
                  )}
                </div>
              </div>

              {membersLoading ? (
                <div className="flex justify-center py-12">
                  <Spinner />
                </div>
              ) : memberEntriesWithPayments.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No members"
                  description="No members are in this pot yet."
                />
              ) : (
                <div className="space-y-3">
                  {memberEntriesWithPayments.map((entryRow) => (
                    <MemberCard
                      key={entryRow.member.id}
                      member={entryRow}
                      isAdmin={isPotAdmin}
                      deadlineClosed={deadlineClosed}
                      onRemove={() => setPendingRemoval(entryRow.member)}
                    />
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </section>

      {/* Mobile sticky bottom sheet — same PicksSummaryPanel as the
          desktop sidebar, collapsed to a tap-to-expand bar so it stays
          usable one-handed and never covers the fixture list by default.
          md:hidden matches BottomNav's own breakpoint (components/layout/
          BottomNav.jsx) so this sits directly above it, not floating with
          a gap or overlapping. */}
      {activeTab === 'entry' && (
        <div className="fixed inset-x-0 bottom-16 z-40 px-4 md:hidden">
          {mobilePicksOpen && (
            <div className="mb-2 max-h-[55vh] overflow-y-auto rounded-2xl border border-white/10 bg-pitch-950/95 p-4 shadow-card backdrop-blur-lg">
              <PicksSummaryPanel
                selectedPlayers={selectedPlayers}
                maxPicks={MAX_PICKS}
                onRemove={removePickByIndex}
                onSave={handleSaveEntry}
                saving={saving}
                savedEntry={savedEntry}
                deadlineClosed={deadlineClosed}
              />
            </div>
          )}
          <button
            type="button"
            onClick={() => setMobilePicksOpen((v) => !v)}
            aria-expanded={mobilePicksOpen}
            className="flex w-full items-center justify-between rounded-2xl border border-accent/30 bg-pitch-950/95 px-4 py-3 text-sm font-semibold text-accent shadow-card backdrop-blur-lg"
          >
            <span>{selectedPlayers.length} / {MAX_PICKS} selected</span>
            <ChevronUp size={16} className={`transition-transform ${mobilePicksOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      )}

      <Modal open={!!pendingRemoval} onClose={() => setPendingRemoval(null)} title="Remove member" size="sm">
        <p className="text-sm text-white/60">
          Remove <span className="font-medium text-white">{pendingRemoval?.profiles?.display_name}</span> from this pot?
          They will lose access to picks, standings, and payments for this competition.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setPendingRemoval(null)}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={handleConfirmRemoveMember} loading={removeMember.isPending} disabled={removeMember.isPending}>
            Remove
          </Button>
        </div>
      </Modal>

      {message ? <Toast message={message} type="success" /> : null}
      {errorMessage ? <Toast message={errorMessage} type="error" /> : null}
    </div>
  )
}
