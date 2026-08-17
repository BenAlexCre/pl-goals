import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, PlusCircle, ChevronDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useCreatePot } from '../../hooks/usePots'
import { useAuthStore } from '../../store/authStore'
import Card from '../ui/Card'
import Button from '../ui/Button'
import Badge from '../ui/Badge'
import EmptyState from '../ui/EmptyState'
import Spinner from '../ui/Spinner'
import Toast from '../ui/Toast'

const GAME_TYPES = [
  { value: 'pick5', label: 'Pick 5', description: '5 player picks each gameweek — most correct picks wins' },
  { value: 'last_man_standing', label: 'Last Man Standing', description: 'Pick one team to win each gameweek; a loss or draw eliminates you' },
  { value: 'score_predictor', label: 'Score Predictor', description: 'Predict scorelines every gameweek; most points across the season wins' },
]

const FEE_TYPES = [
  { value: 'none', label: 'None' },
  { value: 'fixed', label: 'Fixed amount' },
  { value: 'percentage', label: 'Percentage' },
]

const WIPEOUT_OPTIONS = [
  { value: 'split_prize', label: 'Split the prize evenly' },
  { value: 'roll_prize', label: 'Roll the entire prize into next season' },
]

const SEASON_END_TIE_OPTIONS = [
  { value: 'split_prize', label: 'Split the prize evenly' },
  { value: 'final_prediction', label: 'Final-prediction tiebreak (not yet supported)', disabled: true },
]

const CYCLE_MODE_OPTIONS = [
  { value: 'two_halves', label: 'Two halves' },
  { value: 'single_cycle', label: 'Single cycle (whole season)' },
]

const SCORER_SCOPE_OPTIONS = [
  { value: 'fixture_only', label: 'Fixture only' },
  { value: 'gameweek_wide', label: 'Gameweek-wide' },
]

const inputClass =
  'w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white placeholder:text-white/25 outline-none transition-colors focus:border-accent/50'
const selectClass = `${inputClass} appearance-none pr-12`
const labelClass = 'mb-2 block text-sm text-white/70'
const hintClass = 'mt-2 text-xs text-white/45'

function FeeFields({ idPrefix, label, type, onTypeChange, amount, onAmountChange, percentage, onPercentageChange }) {
  return (
    <div>
      <label className={labelClass} htmlFor={`${idPrefix}-type`}>{label}</label>
      <div className="relative">
        <select
          id={`${idPrefix}-type`}
          value={type}
          onChange={(e) => onTypeChange(e.target.value)}
          className={selectClass}
        >
          {FEE_TYPES.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <ChevronDown size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/45" />
      </div>

      {type === 'fixed' ? (
        <input
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder="e.g. 5.00"
          className={`${inputClass} mt-2`}
          aria-label={`${label} amount`}
        />
      ) : null}

      {type === 'percentage' ? (
        <input
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={percentage}
          onChange={(e) => onPercentageChange(e.target.value)}
          placeholder="e.g. 5"
          className={`${inputClass} mt-2`}
          aria-label={`${label} percentage`}
        />
      ) : null}
    </div>
  )
}

function GameweekSelect({ id, label, value, onChange, gameweeks, loading, placeholder }) {
  return (
    <div>
      <label className={labelClass} htmlFor={id}>{label}</label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={loading}
          className={selectClass}
        >
          <option value="">{loading ? 'Loading gameweeks...' : placeholder}</option>
          {gameweeks.map((gw) => (
            <option key={gw.id} value={gw.id}>
              GW{gw.number} — {gw.name}
            </option>
          ))}
        </select>
        <ChevronDown size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/45" />
      </div>
    </div>
  )
}

export default function PotManager() {
  const { user } = useAuthStore()
  const [pots, setPots] = useState([])
  const [leagues, setLeagues] = useState([])
  const [gameweeksForLeague, setGameweeksForLeague] = useState([])
  const [gameweeksLoading, setGameweeksLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  // Basics
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [leagueId, setLeagueId] = useState('')
  const [gameType, setGameType] = useState('pick5')

  // Entry & prize
  const [entryFee, setEntryFee] = useState('0')
  const [maxMembers, setMaxMembers] = useState('')
  const [adminFeeType, setAdminFeeType] = useState('none')
  const [adminFeeAmount, setAdminFeeAmount] = useState('')
  const [adminFeePercentage, setAdminFeePercentage] = useState('')
  const [charityFeeType, setCharityFeeType] = useState('none')
  const [charityFeeAmount, setCharityFeeAmount] = useState('')
  const [charityFeePercentage, setCharityFeePercentage] = useState('')

  // LMS-only
  const [startGameweekId, setStartGameweekId] = useState('')
  const [wipeoutResolution, setWipeoutResolution] = useState('split_prize')
  const [seasonEndTieRule, setSeasonEndTieRule] = useState('split_prize')

  // LMS + Predictor (shared season-conclusion marker)
  const [endGameweekId, setEndGameweekId] = useState('')

  // Predictor-only
  const [predictorCycleMode, setPredictorCycleMode] = useState('two_halves')
  const [predictorScorerScope, setPredictorScorerScope] = useState('gameweek_wide')
  const [predictorExactScorePoints, setPredictorExactScorePoints] = useState('5')
  const [predictorCorrectResultPoints, setPredictorCorrectResultPoints] = useState('3')
  const [predictorScorerBonusPoints, setPredictorScorerBonusPoints] = useState('2')

  const createPot = useCreatePot()

  async function loadPots() {
    // Sprint 2 audit: pot_members' own SELECT RLS policy is
    // is_pot_member(pot_id) — correct for the Members list elsewhere (any
    // member can see every row for a shared pot), but this query wants only
    // the caller's own membership rows. Without an explicit user_id filter,
    // a pot with 2+ members returned one row per member here, each carrying
    // the same joined pots(...) object — confirmed live via a real duplicate
    // React key warning on "Your pots" for a genuinely 2-member pot (every
    // pot with more than one member was silently affected, not just this
    // one; single-member pots never surfaced it).
    const { data, error } = await supabase
      .from('pot_members')
      .select(`
        pot_id,
        role,
        pots (
          id,
          name,
          status,
          game_type,
          season_id,
          league_id,
          created_by,
          seasons (
            id,
            name,
            year_start,
            year_end
          ),
          leagues (
            id,
            name,
            country
          )
        )
      `)
      .eq('user_id', user.id)
      .order('joined_at', { ascending: false })

    if (error) throw error
    setPots(data || [])
  }

  async function loadLeagues() {
    // Phase 7 — LMS Pot Creation UX Corrections. Root cause of the empty
    // Start/Final Gameweek dropdowns, confirmed directly against the live
    // database, not assumed: `leagues.is_active = true` alone does not mean
    // a league is usable for pot creation. This project currently has
    // three `is_active = true` rows — one "Premier League" whose season has
    // zero `gameweeks` rows synced at all (ISSUE-39), and one "FIFA World
    // Cup" left over from an earlier/parallel exploration of the codebase
    // before it was repointed at the Premier League (architecture.md's own
    // "two parallel data fetching patterns" note) — neither can support
    // Pick 5, LMS, or Score Predictor, since none of the three modes can
    // resolve a current/start/final gameweek without real gameweek rows to
    // choose from. `defaultLeagueId()`'s own "prefer the current season"
    // tie-break was silently auto-selecting the zero-gameweek league
    // whenever it existed, which is exactly why Start/Final Gameweek came
    // back empty — not a query, filtering, or mapping bug in this
    // component itself. The two non-functional leagues have also now been
    // deactivated at the data level (they were never meant to be real,
    // user-facing options — see architecture.md), but that alone doesn't
    // stop this from recurring if league data drifts again, so the
    // requirement is enforced here too: a league only counts as a valid
    // pot-creation option if it actually has at least one gameweek.
    const { data, error } = await supabase
      .from('leagues')
      .select(`
        id,
        name,
        country,
        season_id,
        is_active,
        seasons (
          id,
          name,
          year_start,
          year_end,
          is_current
        ),
        gameweeks (count)
      `)
      .eq('is_active', true)
      .order('name', { ascending: true })

    if (error) throw error

    const rows = (Array.isArray(data) ? data : []).filter(
      (league) => (league.gameweeks?.[0]?.count ?? 0) > 0
    )

    rows.sort((a, b) => {
      const aCurrent = a.seasons?.is_current ? 1 : 0
      const bCurrent = b.seasons?.is_current ? 1 : 0
      if (aCurrent !== bCurrent) return bCurrent - aCurrent
      return a.name.localeCompare(b.name)
    })

    setLeagues(rows)
  }

  const selectedLeague = useMemo(
    () => leagues.find((league) => String(league.id) === String(leagueId)) || null,
    [leagues, leagueId]
  )

  // Automatic league selection (product rule, Phase 7 Stage 2 Slice 2):
  // exactly one active league -> assign it silently, no selector ever
  // shown; several -> default to the current Premier League season but let
  // the organiser pick another; none -> defaultLeagueId returns '', which
  // both hides the selector and fails validate()/the RLS insert check.
  // "Current Premier League" is name==='Premier League' AND its season is
  // the current one — not just "any current-season league" — since a
  // future non-Premier-League current-season league shouldn't silently
  // become the default. Falls back to the existing current-first/
  // alphabetical sort's first entry if no exact match exists.
  function defaultLeagueId(leaguesList) {
    if (leaguesList.length === 0) return ''
    if (leaguesList.length === 1) return String(leaguesList[0].id)
    const preferred = leaguesList.find(
      (l) => l.name === 'Premier League' && l.seasons?.is_current
    )
    return String((preferred || leaguesList[0]).id)
  }

  useEffect(() => {
    setLeagueId(defaultLeagueId(leagues))
  }, [leagues])

  const showLeagueSelector = leagues.length > 1
  const noActiveLeagues = !loading && leagues.length === 0

  useEffect(() => {
    async function init() {
      try {
        setLoading(true)
        setErrorMessage('')
        await Promise.all([loadPots(), loadLeagues()])
      } catch (err) {
        setErrorMessage(err.message || 'Failed to load pot setup data')
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [])

  // Gameweeks are only needed for LMS's start/end selectors and Predictor's
  // end selector — fetched per selected league/season rather than eagerly,
  // since most pots (Pick 5) never need this list at all.
  useEffect(() => {
    setEndGameweekId('')
    setStartGameweekId('')

    if (!selectedLeague) {
      setGameweeksForLeague([])
      return
    }

    let cancelled = false

    async function loadGameweeks() {
      try {
        setGameweeksLoading(true)
        const { data, error } = await supabase
          .from('gameweeks')
          .select('id, number, name')
          .eq('league_id', selectedLeague.id)
          .eq('season_id', selectedLeague.season_id)
          .order('number', { ascending: true })

        if (error) throw error
        if (!cancelled) setGameweeksForLeague(data || [])
      } catch (err) {
        if (!cancelled) setErrorMessage(err.message || 'Failed to load gameweeks')
      } finally {
        if (!cancelled) setGameweeksLoading(false)
      }
    }

    loadGameweeks()

    return () => {
      cancelled = true
    }
  }, [selectedLeague])

  function resetForm() {
    setName('')
    setDescription('')
    setLeagueId(defaultLeagueId(leagues))
    setGameType('pick5')
    setEntryFee('0')
    setMaxMembers('')
    setAdminFeeType('none')
    setAdminFeeAmount('')
    setAdminFeePercentage('')
    setCharityFeeType('none')
    setCharityFeeAmount('')
    setCharityFeePercentage('')
    setStartGameweekId('')
    setEndGameweekId('')
    setWipeoutResolution('split_prize')
    setSeasonEndTieRule('split_prize')
    setPredictorCycleMode('two_halves')
    setPredictorScorerScope('gameweek_wide')
    setPredictorExactScorePoints('5')
    setPredictorCorrectResultPoints('3')
    setPredictorScorerBonusPoints('2')
  }

  function validate() {
    const trimmedName = name.trim()
    if (!trimmedName) return 'Pot name is required'
    if (leagues.length === 0) return 'No active league is available right now — pots cannot be created until one is configured'
    if (!selectedLeague) return 'Select a league/tournament'

    const fee = Number(entryFee)
    if (entryFee === '' || Number.isNaN(fee) || fee < 0) return 'Entry fee must be zero or a positive amount'

    if (maxMembers !== '' && Number(maxMembers) < 2) return 'Max members must be at least 2, or left blank for unlimited'

    if (adminFeeType === 'fixed' && (adminFeeAmount === '' || Number(adminFeeAmount) < 0)) {
      return 'Enter the admin fee amount'
    }
    if (adminFeeType === 'percentage' && (adminFeePercentage === '' || Number(adminFeePercentage) < 0 || Number(adminFeePercentage) > 100)) {
      return 'Enter an admin fee percentage between 0 and 100'
    }
    if (charityFeeType === 'fixed' && (charityFeeAmount === '' || Number(charityFeeAmount) < 0)) {
      return 'Enter the charity fee amount'
    }
    if (charityFeeType === 'percentage' && (charityFeePercentage === '' || Number(charityFeePercentage) < 0 || Number(charityFeePercentage) > 100)) {
      return 'Enter a charity fee percentage between 0 and 100'
    }

    if (gameType === 'last_man_standing') {
      if (!startGameweekId) return 'Select the gameweek Last Man Standing picks begin (this is also the entry-window cutoff)'
      if (!endGameweekId) return "Select the season's final gameweek — without it, a season-end tie can never be resolved"
    }

    if (gameType === 'score_predictor') {
      if (!endGameweekId) return "Select the season's final gameweek — Score Predictor has no other way to conclude the competition"
      for (const [label, val] of [
        ['exact score', predictorExactScorePoints],
        ['correct result', predictorCorrectResultPoints],
        ['scorer bonus', predictorScorerBonusPoints],
      ]) {
        if (val === '' || Number(val) < 0) return `Enter a valid, non-negative ${label} point value`
      }
    }

    return null
  }

  async function handleCreatePot(e) {
    e.preventDefault()

    const validationError = validate()
    if (validationError) {
      setErrorMessage(validationError)
      setMessage('')
      return
    }

    setErrorMessage('')
    setMessage('')

    try {
      await createPot.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        seasonId: selectedLeague.season_id,
        leagueId: selectedLeague.id,
        gameType,
        entryFee: Number(entryFee),
        maxMembers: maxMembers === '' ? null : Number(maxMembers),
        adminFeeType,
        adminFeeAmount: adminFeeAmount === '' ? null : Number(adminFeeAmount),
        adminFeePercentage: adminFeePercentage === '' ? null : Number(adminFeePercentage),
        charityFeeType,
        charityFeeAmount: charityFeeAmount === '' ? null : Number(charityFeeAmount),
        charityFeePercentage: charityFeePercentage === '' ? null : Number(charityFeePercentage),
        startGameweekId: startGameweekId === '' ? null : Number(startGameweekId),
        endGameweekId: endGameweekId === '' ? null : Number(endGameweekId),
        wipeoutResolution,
        seasonEndTieRule,
        predictorCycleMode,
        predictorScorerScope,
        predictorExactScorePoints: Number(predictorExactScorePoints),
        predictorCorrectResultPoints: Number(predictorCorrectResultPoints),
        predictorScorerBonusPoints: Number(predictorScorerBonusPoints),
      })

      resetForm()
      setMessage('Pot created successfully')
      await loadPots()
    } catch (err) {
      setErrorMessage(err.message || 'Failed to create pot')
    }
  }

  const saving = createPot.isPending

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/6 bg-gradient-to-br from-surface-1 to-surface-3 p-6">
        <div className="mb-3 flex items-center gap-3">
          <Users className="text-white" size={22} />
          <h1 className="text-3xl font-bold text-white">Pots</h1>
        </div>
        <p className="max-w-2xl text-white/45">
          Create a private pot, become the admin, and start inviting members.
        </p>
      </section>

      <section>
        <Card className="p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Create pot</h2>

          <form onSubmit={handleCreatePot} className="space-y-6">
            <div className="space-y-4">
              <div>
                <label className={labelClass} htmlFor="pot-name">Pot name</label>
                <input
                  id="pot-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Office pool"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass} htmlFor="pot-description">Description (optional)</label>
                <textarea
                  id="pot-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A few words for your members"
                  rows={2}
                  className={`${inputClass} resize-none`}
                />
              </div>

              {/* Automatic league selection: exactly one active league is
                  assigned silently (no selector rendered at all); several
                  show a selector defaulting to the current Premier League;
                  none blocks submission with a clear message. Backend RLS
                  (pots_insert_authenticated, 021_pots_require_active_league.sql)
                  enforces the same "must reference an active league"
                  invariant independently — this UI is convenience, not the
                  only gate. */}
              {loading ? (
                <div className={hintClass}>Loading available leagues...</div>
              ) : noActiveLeagues ? (
                <div className="rounded-xl border border-red-goal/25 bg-red-goal/10 p-4">
                  <p className="text-sm font-medium text-red-goal">No active league available</p>
                  <p className="mt-1 text-xs text-white/45">
                    Pots can't be created until at least one league/season is configured. Contact an admin.
                  </p>
                </div>
              ) : showLeagueSelector ? (
                <div>
                  <label className={labelClass} htmlFor="pot-league">League / tournament</label>
                  <div className="relative">
                    <select
                      id="pot-league"
                      value={leagueId}
                      onChange={(e) => setLeagueId(e.target.value)}
                      className={selectClass}
                    >
                      <option value="">Select a league/tournament</option>
                      {leagues.map((league) => (
                        <option key={league.id} value={league.id}>
                          {league.name}
                          {league.country ? ` (${league.country})` : ''}
                          {league.seasons?.is_current ? ' — Current' : ''}
                        </option>
                      ))}
                    </select>

                    <ChevronDown
                      size={18}
                      className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/45"
                    />
                  </div>

                  {selectedLeague ? (
                    <p className={hintClass}>Season: {selectedLeague.seasons?.name || 'Unknown'}</p>
                  ) : null}
                </div>
              ) : selectedLeague ? (
                <p className={hintClass}>
                  League: {selectedLeague.name}
                  {selectedLeague.country ? ` (${selectedLeague.country})` : ''} · Season:{' '}
                  {selectedLeague.seasons?.name || 'Unknown'}
                </p>
              ) : null}
            </div>

            <div>
              <span className={labelClass}>Game mode</span>
              <div className="grid gap-2 sm:grid-cols-3">
                {GAME_TYPES.map((gt) => (
                  <button
                    key={gt.value}
                    type="button"
                    onClick={() => setGameType(gt.value)}
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      gameType === gt.value
                        ? 'border-accent/50 bg-accent/10'
                        : 'border-white/10 bg-surface-2 hover:border-white/20'
                    }`}
                  >
                    <div className="text-sm font-semibold text-white">{gt.label}</div>
                    <div className="mt-1 text-xs text-white/45">{gt.description}</div>
                  </button>
                ))}
              </div>
              <p className={hintClass}>Game mode cannot be changed once the pot is created.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="pot-entry-fee">Entry fee</label>
                <input
                  id="pot-entry-fee"
                  type="number"
                  min="0"
                  step="0.01"
                  value={entryFee}
                  onChange={(e) => setEntryFee(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass} htmlFor="pot-max-members">Max members (optional)</label>
                <input
                  id="pot-max-members"
                  type="number"
                  min="2"
                  step="1"
                  value={maxMembers}
                  onChange={(e) => setMaxMembers(e.target.value)}
                  placeholder="Unlimited"
                  className={inputClass}
                />
              </div>

              <FeeFields
                idPrefix="admin-fee"
                label="Admin fee"
                type={adminFeeType}
                onTypeChange={setAdminFeeType}
                amount={adminFeeAmount}
                onAmountChange={setAdminFeeAmount}
                percentage={adminFeePercentage}
                onPercentageChange={setAdminFeePercentage}
              />

              <FeeFields
                idPrefix="charity-fee"
                label="Charity fee"
                type={charityFeeType}
                onTypeChange={setCharityFeeType}
                amount={charityFeeAmount}
                onAmountChange={setCharityFeeAmount}
                percentage={charityFeePercentage}
                onPercentageChange={setCharityFeePercentage}
              />
            </div>
            <p className={hintClass}>
              Entry fee and fees lock as soon as the first player joins — double-check these before creating the pot.
            </p>

            {gameType === 'last_man_standing' ? (
              <div className="space-y-4 rounded-xl border border-white/10 bg-surface-2/50 p-4">
                <h3 className="text-sm font-semibold text-white">Last Man Standing settings</h3>

                <div className="grid gap-4 sm:grid-cols-2">
                  <GameweekSelect
                    id="pot-start-gameweek"
                    label="Start gameweek (entry-window cutoff)"
                    value={startGameweekId}
                    onChange={setStartGameweekId}
                    gameweeks={gameweeksForLeague}
                    loading={gameweeksLoading}
                    placeholder="Select a gameweek"
                  />
                  <GameweekSelect
                    id="pot-end-gameweek-lms"
                    label="Final gameweek (season conclusion)"
                    value={endGameweekId}
                    onChange={setEndGameweekId}
                    gameweeks={gameweeksForLeague}
                    loading={gameweeksLoading}
                    placeholder="Select a gameweek"
                  />
                </div>

                <div>
                  <label className={labelClass} htmlFor="pot-wipeout">If everyone is eliminated in the same gameweek</label>
                  <div className="relative">
                    <select
                      id="pot-wipeout"
                      value={wipeoutResolution}
                      onChange={(e) => setWipeoutResolution(e.target.value)}
                      className={selectClass}
                    >
                      {WIPEOUT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <ChevronDown size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/45" />
                  </div>
                </div>

                <div>
                  <label className={labelClass} htmlFor="pot-season-end-tie">If multiple players are still alive at the final gameweek</label>
                  <div className="relative">
                    <select
                      id="pot-season-end-tie"
                      value={seasonEndTieRule}
                      onChange={(e) => setSeasonEndTieRule(e.target.value)}
                      className={selectClass}
                    >
                      {SEASON_END_TIE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value} disabled={opt.disabled}>{opt.label}</option>
                      ))}
                    </select>
                    <ChevronDown size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/45" />
                  </div>
                </div>
              </div>
            ) : null}

            {gameType === 'score_predictor' ? (
              <div className="space-y-4 rounded-xl border border-white/10 bg-surface-2/50 p-4">
                <h3 className="text-sm font-semibold text-white">Score Predictor settings</h3>

                <GameweekSelect
                  id="pot-end-gameweek-predictor"
                  label="Final gameweek (season conclusion)"
                  value={endGameweekId}
                  onChange={setEndGameweekId}
                  gameweeks={gameweeksForLeague}
                  loading={gameweeksLoading}
                  placeholder="Select a gameweek"
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass} htmlFor="pot-cycle-mode">Cycle mode</label>
                    <div className="relative">
                      <select
                        id="pot-cycle-mode"
                        value={predictorCycleMode}
                        onChange={(e) => setPredictorCycleMode(e.target.value)}
                        className={selectClass}
                      >
                        {CYCLE_MODE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      <ChevronDown size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/45" />
                    </div>
                  </div>

                  <div>
                    <label className={labelClass} htmlFor="pot-scorer-scope">Goalscorer bonus scope</label>
                    <div className="relative">
                      <select
                        id="pot-scorer-scope"
                        value={predictorScorerScope}
                        onChange={(e) => setPredictorScorerScope(e.target.value)}
                        className={selectClass}
                      >
                        {SCORER_SCOPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      <ChevronDown size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/45" />
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className={labelClass} htmlFor="pot-exact-score-points">Exact score points</label>
                    <input
                      id="pot-exact-score-points"
                      type="number"
                      min="0"
                      step="1"
                      value={predictorExactScorePoints}
                      onChange={(e) => setPredictorExactScorePoints(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="pot-correct-result-points">Correct result points</label>
                    <input
                      id="pot-correct-result-points"
                      type="number"
                      min="0"
                      step="1"
                      value={predictorCorrectResultPoints}
                      onChange={(e) => setPredictorCorrectResultPoints(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="pot-scorer-bonus-points">Goalscorer bonus points</label>
                    <input
                      id="pot-scorer-bonus-points"
                      type="number"
                      min="0"
                      step="1"
                      value={predictorScorerBonusPoints}
                      onChange={(e) => setPredictorScorerBonusPoints(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            <Button type="submit" disabled={saving || noActiveLeagues} loading={saving} className="inline-flex items-center gap-2">
              <PlusCircle size={16} />
              {saving ? 'Creating...' : 'Create pot'}
            </Button>
          </form>
        </Card>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Your pots</h2>
          <span className="text-sm text-white/45">{pots.length} total</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : pots.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No pots yet"
            description="Create your first pot to get started."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {pots.map((row) => (
              <Link key={row.pot_id} to={`/pot/${row.pot_id}`}>
                <Card hover className="h-full p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-white">
                        {row.pots?.name || 'Unnamed pot'}
                      </h3>
                      <p className="mt-1 text-sm text-white/35">Role: {row.role}</p>
                    </div>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
                      {row.pots?.status || 'unknown'}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-white/40">
                    <Badge status={undefined}>
                      {GAME_TYPES.find((gt) => gt.value === row.pots?.game_type)?.label || row.pots?.game_type || 'Pick 5'}
                    </Badge>
                  </div>

                  <div className="mt-3 space-y-1 text-sm text-white/40">
                    <div>League / tournament: {row.pots?.leagues?.name || '-'}</div>
                    <div>Season: {row.pots?.seasons?.name || '-'}</div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {message ? <Toast message={message} type="success" /> : null}
      {errorMessage ? <Toast message={errorMessage} type="error" /> : null}
    </div>
  )
}
