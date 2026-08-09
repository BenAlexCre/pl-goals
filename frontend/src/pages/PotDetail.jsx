import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Search,
  Users,
  Shield,
  Target,
  Trophy,
  ChevronRight,
  Clock3,
  Flame,
  ListChecks,
  CheckCircle2,
  Filter,
  Eye,
  EyeOff,
} from 'lucide-react'
import { supabase, extractFunctionError } from '../lib/supabase'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import Toast from '../components/ui/Toast'
import EmptyState from '../components/ui/EmptyState'
import Modal from '../components/ui/Modal'
import LmsPotDetail from '../components/pot/LmsPotDetail'
import PredictorPotDetail from '../components/pot/PredictorPotDetail'
import InviteCard from '../components/pot/InviteCard'
import { useAuthStore } from '../store/authStore'
import { useRemoveMember } from '../hooks/useMembership'

const PAGE_SIZE = 1000
const MAX_PICKS = 5
const MAX_SAME_PLAYER = 5

function formatDeadline(deadline) {
  if (!deadline) return 'No deadline set'
  return new Date(deadline).toLocaleString()
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

  const [players, setPlayers] = useState([])
  const [allFilterRows, setAllFilterRows] = useState([])
  const [savedEntry, setSavedEntry] = useState(null)
  const [savedPicks, setSavedPicks] = useState([])
  const [memberEntries, setMemberEntries] = useState([])

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [positionFilter, setPositionFilter] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [selectedPlayers, setSelectedPlayers] = useState([])

  const [activeTab, setActiveTab] = useState('entry')
  const [showPicker, setShowPicker] = useState(false)
  const [loading, setLoading] = useState(true)
  const [playersLoading, setPlayersLoading] = useState(false)
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
        created_by,
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

    setAllFilterRows(rows)
  }

  async function loadPlayers() {
    if (!selectedGameweekId) {
      setPlayers([])
      return
    }

    setPlayersLoading(true)

    try {
      const rows = await fetchAllRows(() => {
        let query = supabase
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
          .eq('gameweek_id', Number(selectedGameweekId))
          .neq('position', 'Goalkeeper')
          .order('display_name', { ascending: true })

        if (debouncedSearch.trim()) {
          const term = debouncedSearch.trim().replace(/[%_]/g, '')
          query = query.or(
            `display_name.ilike.%${term}%,team_name.ilike.%${term}%,team_short_name.ilike.%${term}%`
          )
        }

        if (positionFilter) {
          query = query.eq('position', positionFilter)
        }

        if (teamFilter) {
          query = query.eq('team_name', teamFilter)
        }

        return query
      })

      setPlayers(rows)
    } finally {
      setPlayersLoading(false)
    }
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
            short_name
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
              short_name
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

  // Production readiness audit (2026-08-05): this previously re-queried
  // available_players_by_gameweek on every keystroke (search was a direct
  // effect dependency) — a real query per character typed, against a view
  // joining four tables with an ilike/or filter. Debounced so a query only
  // fires once typing pauses; `search` itself still updates the input
  // immediately for responsive UI feedback, only the query trigger is delayed.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    async function syncPlayers() {
      try {
        setErrorMessage('')
        await loadPlayers()
      } catch (err) {
        setErrorMessage(err.message || 'Failed to load players')
      }
    }

    syncPlayers()
  }, [selectedGameweekId, debouncedSearch, positionFilter, teamFilter])

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

  const selectedGameweek = useMemo(
    () => gameweeks.find((gw) => String(gw.id) === String(selectedGameweekId)) || null,
    [gameweeks, selectedGameweekId]
  )

  const deadlineClosed = useMemo(() => {
    if (!selectedGameweek?.deadline_utc) return false
    return new Date(selectedGameweek.deadline_utc).getTime() <= Date.now()
  }, [selectedGameweek])

  const isPotAdmin = useMemo(
    () => members.some((m) => m.user_id === user?.id && m.role === 'admin'),
    [members, user]
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

  const teamOptions = useMemo(() => {
    const values = new Set()

    allFilterRows.forEach((player) => {
      const teamName = player.team_name || player.team_short_name
      if (teamName) values.add(teamName)
    })

    return Array.from(values).sort((a, b) => a.localeCompare(b))
  }, [allFilterRows])

  const positionOptions = useMemo(() => {
    const values = new Set()

    allFilterRows.forEach((player) => {
      if (player.position && player.position !== 'Goalkeeper') {
        values.add(player.position)
      }
    })

    return Array.from(values).sort((a, b) => a.localeCompare(b))
  }, [allFilterRows])

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
      setShowPicker(false)
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
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl border border-white/8 bg-gradient-to-br from-surface-1 via-surface-2 to-pitch-900">
        <div className="grid gap-6 p-6 lg:grid-cols-[1.15fr_0.85fr] lg:p-7">
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                {pot.leagues?.name || 'Tournament'}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
                {pot.seasons?.name || 'Season'}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60 capitalize">
                {pot.status}
              </span>
            </div>

            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                <Trophy size={22} />
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-white">{pot.name}</h1>
                <p className="mt-1 text-sm text-white/45">
                  {pot.leagues?.country ? `${pot.leagues.country} · ` : ''}
                  Private goals pot
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-2xl border border-white/8 bg-black/10 p-4">
                <div className="mb-1 text-xs uppercase tracking-wide text-white/35">Current gameweek</div>
                <div className="font-medium text-white">
                  {selectedGameweek ? `GW${selectedGameweek.number} — ${selectedGameweek.name}` : 'Not set'}
                </div>
              </div>

              <div className="rounded-2xl border border-white/8 bg-black/10 p-4">
                <div className="mb-1 text-xs uppercase tracking-wide text-white/35">Deadline</div>
                <div className="font-medium text-white">{formatDeadline(selectedGameweek?.deadline_utc)}</div>
              </div>

              <div className="rounded-2xl border border-white/8 bg-black/10 p-4">
                <div className="mb-1 text-xs uppercase tracking-wide text-white/35">Members</div>
                <div className="font-medium text-white">{members.length}</div>
              </div>

              <div className="rounded-2xl border border-white/8 bg-black/10 p-4">
                <div className="mb-1 text-xs uppercase tracking-wide text-white/35">Available outfield players</div>
                <div className="font-medium text-white">{playersLoading ? 'Loading…' : players.length}</div>
              </div>

              <div className="rounded-2xl border border-white/8 bg-black/10 p-4">
                <div className="mb-1 text-xs uppercase tracking-wide text-white/35">Your entry status</div>
                <div className="font-medium text-white">
                  {selectedPlayers.length === MAX_PICKS ? 'Ready to submit' : 'Incomplete'}
                </div>
              </div>

              <div className="rounded-2xl border border-white/8 bg-black/10 p-4">
                <div className="mb-1 text-xs uppercase tracking-wide text-white/35">Picks selected</div>
                <div className="font-medium text-white">{selectedPlayers.length}/{MAX_PICKS}</div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/8 bg-black/15 p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="mb-1 flex items-center gap-2 text-sm font-medium text-white">
                  <Clock3 size={16} className="text-accent" />
                  Your entry
                </div>
                <p className="text-sm text-white/45">
                  Build and save your {MAX_PICKS}-player hand for this round.
                </p>
              </div>

              <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/65">
                {selectedGameweek ? `GW${selectedGameweek.number}` : 'No GW'}
              </div>
            </div>

            {selectedPlayers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                  <Target size={20} />
                </div>
                <h2 className="text-lg font-semibold text-white">No picks made yet</h2>
                <p className="mt-2 max-w-sm text-sm text-white/45">
                  Start your entry by choosing exactly {MAX_PICKS} players for the selected gameweek.
                </p>

                <div className="mt-5 flex flex-wrap gap-3">
                  <Button type="button" onClick={() => { setActiveTab('entry'); setShowPicker(true) }}>
                    <Target size={16} />
                    Start picks
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <div className="space-y-3">
                  {selectedPlayers.map((player, index) => (
                    <div
                      key={`${player.player_id}-${index}`}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-accent/15 bg-accent/[0.06] p-4"
                    >
                      <div className="min-w-0">
                        <div className="mb-1 text-xs uppercase tracking-wide text-white/35">
                          Pick {index + 1}
                        </div>
                        <div className="truncate font-semibold text-white">{player.display_name}</div>
                        <div className="truncate text-sm text-white/45">
                          {player.team_name || player.team_short_name || 'Unknown team'} · {player.position || 'Player'}
                        </div>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removePickByIndex(index)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    onClick={handleSaveEntry}
                    disabled={saving || selectedPlayers.length !== MAX_PICKS || !selectedGameweekId}
                  >
                    <CheckCircle2 size={16} />
                    {saving ? 'Saving picks...' : savedEntry ? 'Update picks' : 'Save entry'}
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setActiveTab('entry')
                      setShowPicker((current) => !current)
                    }}
                  >
                    <ListChecks size={16} />
                    {showPicker ? 'Hide picker' : 'Edit picks'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-6">
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
            onClick={() => {
              setActiveTab('members')
              setShowPicker(false)
            }}
            className={`rounded-2xl border px-4 py-2 text-sm font-medium transition ${
              activeTab === 'members'
                ? 'border-accent/30 bg-accent/10 text-accent'
                : 'border-white/10 bg-surface-1 text-white/65 hover:text-white'
            }`}
          >
            Members
          </button>

          {selectedGameweekId && (
            <Link
              to={`/pot/${potId}/gameweek/${selectedGameweekId}`}
              className="ml-auto inline-flex items-center gap-1.5 rounded-2xl border border-white/10 bg-surface-1 px-4 py-2 text-sm font-medium text-white/65 transition hover:text-white"
            >
              Live scores & standings
              <ChevronRight size={14} />
            </Link>
          )}
        </div>

        {activeTab === 'entry' ? (
          <>
            {showPicker ? (
              <Card className="w-full p-5">
                <div className="mb-5 flex flex-col gap-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <h2 className="text-xl font-semibold text-white">Player picker</h2>
                      <p className="mt-1 text-sm text-white/45">
                        Search, filter, and add players until you have exactly {MAX_PICKS} picks.
                      </p>
                    </div>

                    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/65">
                      {playersLoading ? 'Loading players...' : `${players.length} available`}
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-4">
                    <div>
                      <label className="mb-2 block text-sm text-white/70">Gameweek</label>
                      <select
                        value={selectedGameweekId}
                        onChange={(e) => setSelectedGameweekId(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none transition-colors focus:border-accent/50"
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

                    <div>
                      <label className="mb-2 block text-sm text-white/70">Search</label>
                      <div className="relative">
                        <Search
                          size={16}
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35"
                        />
                        <input
                          type="text"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Player or team"
                          className="w-full rounded-xl border border-white/10 bg-surface-2 py-3 pl-10 pr-4 text-white placeholder:text-white/25 outline-none transition-colors focus:border-accent/50"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm text-white/70">Position</label>
                      <select
                        value={positionFilter}
                        onChange={(e) => setPositionFilter(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none transition-colors focus:border-accent/50"
                      >
                        <option value="">All outfield positions</option>
                        {positionOptions.map((position) => (
                          <option key={position} value={position}>
                            {position}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm text-white/70">Team</label>
                      <select
                        value={teamFilter}
                        onChange={(e) => setTeamFilter(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none transition-colors focus:border-accent/50"
                      >
                        <option value="">All teams</option>
                        {teamOptions.map((team) => (
                          <option key={team} value={team}>
                            {team}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-white/40">
                    <Filter size={14} />
                    Goalkeepers are excluded. Filter dropdowns stay complete for the selected gameweek.
                  </div>
                </div>

                {playersLoading ? (
                  <div className="flex justify-center py-12">
                    <Spinner />
                  </div>
                ) : players.length === 0 ? (
                  <EmptyState
                    icon={Search}
                    title="No players found"
                    description="Try another search or change the filters."
                  />
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {players.map((player) => {
                      const playerCount = getPlayerPickCount(player.player_id)

                      return (
                        <button
                          key={player.player_id}
                          type="button"
                          onClick={() => addPlayer(player)}
                          disabled={
                            selectedPlayers.length >= MAX_PICKS ||
                            playerCount >= MAX_SAME_PLAYER
                          }
                          className={`rounded-2xl border p-4 text-left transition-all ${
                            playerCount > 0
                              ? 'border-accent/40 bg-accent/10'
                              : 'border-white/8 bg-surface-1 hover:border-white/15 hover:bg-surface-2'
                          } disabled:cursor-not-allowed disabled:opacity-70`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="truncate font-semibold text-white">{player.display_name}</h3>
                              <p className="mt-1 truncate text-sm text-white/45">
                                {player.team_name || player.team_short_name || 'Unknown team'}
                              </p>
                            </div>

                            <div className="flex flex-col items-end gap-2">
                              <span className="shrink-0 rounded-full bg-white/8 px-2.5 py-1 text-xs text-white/70">
                                {player.position || 'Player'}
                              </span>
                              {playerCount > 0 ? (
                                <span className="rounded-full bg-accent/15 px-2.5 py-1 text-xs text-accent">
                                  Selected {playerCount}x
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </Card>
            ) : (
              <Card className="p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-accent">
                    <Flame size={20} />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-white">Ready for the next round</h2>
                    <p className="mt-2 max-w-2xl text-sm text-white/45">
                      Your key round details are now up top. Open the picker when you want to build or update your hand.
                    </p>
                    <div className="mt-5">
                      <Button type="button" onClick={() => setShowPicker(true)}>
                        <Target size={16} />
                        Open player picker
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            )}
          </>
        ) : (
          <div className="space-y-6">
          {isPotAdmin ? (
            <InviteCard
              potId={potId}
              inviteCode={pot.invite_code}
              existingMemberIds={new Set(members.map((m) => m.user_id))}
              onChange={async () => {
                await loadPot()
                await loadMembers()
              }}
            />
          ) : null}

          <Card className="p-5">
            <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">Members</h2>
                <p className="mt-1 text-sm text-white/45">
                  See who has submitted. Picks are revealed only after the deadline closes.
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
            ) : memberEntries.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No members"
                description="No members are in this pot yet."
              />
            ) : (
              <div className="space-y-4">
                {memberEntries.map((entryRow) => {
                  const displayName =
                    entryRow.member?.profiles?.display_name ||
                    entryRow.member?.profiles?.username ||
                    'User'

                  const username = entryRow.member?.profiles?.username || 'unknown'
                  const canRevealPicks = deadlineClosed && entryRow.picks.length > 0

                  return (
                    <div
                      key={entryRow.member.id}
                      className="rounded-2xl border border-white/8 bg-surface-1 p-4"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="font-medium text-white">{displayName}</div>
                          <div className="text-sm text-white/45">@{username}</div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-white/8 px-3 py-1 text-xs text-white/70">
                            {entryRow.member.role}
                          </span>

                          <span
                            className={`rounded-full px-3 py-1 text-xs ${
                              entryRow.hasEntry
                                ? 'bg-accent/15 text-accent'
                                : 'bg-white/8 text-white/60'
                            }`}
                          >
                            {entryRow.hasEntry ? 'Selected' : 'Not selected'}
                          </span>

                          {isPotAdmin ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setPendingRemoval(entryRow.member)}
                              aria-label={`Remove ${displayName}`}
                            >
                              Remove
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      {deadlineClosed ? (
                        canRevealPicks ? (
                          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {entryRow.picks.map((pick) => (
                              <div
                                key={pick.id}
                                className="rounded-2xl border border-white/8 bg-black/10 p-3"
                              >
                                <div className="mb-1 text-xs uppercase tracking-wide text-white/35">
                                  Pick {pick.pick_position}
                                </div>
                                <div className="font-medium text-white">{pick.display_name}</div>
                                <div className="text-sm text-white/45">
                                  {pick.team_name || pick.team_short_name || 'Unknown team'} · {pick.position || 'Player'}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-4 text-sm text-white/45">
                            No picks saved for this round.
                          </div>
                        )
                      ) : (
                        <div className="mt-4 text-sm text-white/45">
                          Picks will be revealed when the deadline has passed.
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
          </div>
        )}
      </section>

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