import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Users, PlusCircle, ChevronDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useCreatePot } from '../../hooks/usePots'
import { useAuthStore } from '../../store/authStore'
import { formatSeasonName } from '../../utils/format'
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

// Order matches the brief's own listed order: split, roll into next
// competition, roll into next season.
const WIPEOUT_OPTIONS = [
  { value: 'split_prize', label: 'Split the prize evenly' },
  { value: 'roll_next_competition', label: 'Roll the prize into my next competition' },
  { value: 'roll_prize', label: 'Roll the prize into next season' },
]

// season_end_tie_rule can only ever be 'split_prize' from this form today —
// 'final_prediction' has no resolution mechanism built (no pick type, no
// scoring), so it was never a real option, only a disabled one that read
// "not yet supported." Never expose it as choosable; when a second real
// option exists, add it back as a genuine <select>, not before.
const SEASON_END_SUPPORTED_LABEL = 'The prize is split evenly among everyone still alive.'

// Both LMS and Score Predictor now share the same "Full season (default) /
// Custom competition" duration model — Full season hides the gameweek
// selectors entirely and lets the engine resolve the whole span
// automatically (first available gameweek -> the season's actual final
// gameweek, exactly as both engines already did before this concept
// existed); Custom competition exposes Start/End Gameweek, capped at
// MAX_CUSTOM_COMPETITION_GAMEWEEKS.
const LMS_DURATION_OPTIONS = [
  { value: 'full_season', label: 'Full season' },
  { value: 'custom', label: 'Custom competition' },
]

const CYCLE_MODE_OPTIONS = [
  { value: 'two_halves', label: 'Two half-season competitions' },
  { value: 'single_cycle', label: 'Custom competition' },
]

const MAX_CUSTOM_COMPETITION_GAMEWEEKS = 20

const SCORER_SCOPE_OPTIONS = [
  { value: 'fixture_only', label: 'Fixture only' },
  { value: 'gameweek_wide', label: 'Gameweek-wide' },
]

// Border colour is kept separate from the rest of the field styling so an
// error state never has to fight a default border class for specificity —
// exactly one border-colour class is ever applied at a time.
const fieldBaseClass =
  'w-full rounded-xl border bg-surface-2 px-4 py-3 text-white placeholder:text-white/25 outline-none transition-colors'
const fieldBorderClass = (hasError) =>
  hasError ? 'border-red-goal/60 focus:border-red-goal/60' : 'border-white/10 focus:border-accent/50'
const inputClassFor = (hasError) => `${fieldBaseClass} ${fieldBorderClass(hasError)}`
const selectClassFor = (hasError) => `${inputClassFor(hasError)} appearance-none pr-12`
const inputClass = inputClassFor(false)
const selectClass = selectClassFor(false)
const labelClass = 'mb-2 block text-sm text-white/70'
const hintClass = 'mt-2 text-xs text-white/45'
const sectionHeadingClass = 'text-base font-semibold text-white'
const sectionCardClass = 'space-y-4 rounded-2xl border border-white/8 bg-surface-2/30 p-5'

function FieldError({ message }) {
  if (!message) return null
  return <p className="mt-1.5 text-xs font-medium text-red-goal">{message}</p>
}

function FeeFields({ idPrefix, label, type, onTypeChange, amount, onAmountChange, percentage, onPercentageChange, amountError, percentageError, amountRef, percentageRef }) {
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
        <>
          <input
            ref={amountRef}
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
            placeholder="e.g. 5.00"
            className={`${inputClassFor(!!amountError)} mt-2`}
            aria-label={`${label} amount`}
          />
          <FieldError message={amountError} />
        </>
      ) : null}

      {type === 'percentage' ? (
        <>
          <input
            ref={percentageRef}
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={percentage}
            onChange={(e) => onPercentageChange(e.target.value)}
            placeholder="e.g. 5"
            className={`${inputClassFor(!!percentageError)} mt-2`}
            aria-label={`${label} percentage`}
          />
          <FieldError message={percentageError} />
        </>
      ) : null}
    </div>
  )
}

function GameweekSelect({ id, label, value, onChange, gameweeks, loading, placeholder, error, fieldRef }) {
  return (
    <div>
      <label className={labelClass} htmlFor={id}>{label}</label>
      <div className="relative">
        <select
          ref={fieldRef}
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={loading}
          className={selectClassFor(!!error)}
        >
          <option value="">{loading ? 'Loading gameweeks...' : placeholder}</option>
          {gameweeks.map((gw) => (
            <option key={gw.id} value={gw.id}>
              GW{gw.number}
            </option>
          ))}
        </select>
        <ChevronDown size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/45" />
      </div>
      <FieldError message={error} />
    </div>
  )
}

// Visual top-to-bottom order of every validated field, used to find "the
// first invalid field" to scroll to and focus — a fixed list rather than
// walking the DOM, since it's simpler and exactly matches the form's own
// section order (Competition -> Financial settings -> Competition rules).
const FIELD_ORDER = [
  'name',
  'league',
  'entryFee',
  'maxMembers',
  'adminFeeAmount',
  'adminFeePercentage',
  'charityFeeAmount',
  'charityFeePercentage',
  'startGameweek',
  'endGameweek',
  'predictorExactScorePoints',
  'predictorCorrectResultPoints',
  'predictorScorerBonusPoints',
]

export default function PotManager() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [pots, setPots] = useState([])
  const [leagues, setLeagues] = useState([])
  const [gameweeksForLeague, setGameweeksForLeague] = useState([])
  const [gameweeksLoading, setGameweeksLoading] = useState(false)
  const [loading, setLoading] = useState(true)
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
  const [lmsDurationMode, setLmsDurationMode] = useState('full_season')
  const [wipeoutResolution, setWipeoutResolution] = useState('split_prize')
  const [seasonEndTieRule] = useState('split_prize') // only supported value — never user-editable, see SEASON_END_SUPPORTED_LABEL

  // LMS + Predictor (shared season-conclusion marker)
  const [endGameweekId, setEndGameweekId] = useState('')

  // Predictor-only
  const [predictorCycleMode, setPredictorCycleMode] = useState('two_halves')
  const [predictorScorerScope, setPredictorScorerScope] = useState('gameweek_wide')
  const [predictorExactScorePoints, setPredictorExactScorePoints] = useState('5')
  const [predictorCorrectResultPoints, setPredictorCorrectResultPoints] = useState('3')
  const [predictorScorerBonusPoints, setPredictorScorerBonusPoints] = useState('2')

  // Inline validation UX — replaces bottom-of-page toasts for ordinary
  // client-side validation. `errors` maps field key -> message; toasts are
  // reserved for successful creation, server errors, and other failures the
  // organiser can't fix by editing a specific field (see handleCreatePot).
  const [errors, setErrors] = useState({})
  const fieldRefs = useRef({})
  const setFieldRef = (key) => (el) => {
    fieldRefs.current[key] = el
  }
  const clearError = (key) => {
    setErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

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

  // "Next available" per the product definition: the first gameweek (by
  // number) whose entry deadline hasn't passed yet — not hardcoded GW1, so
  // a pot created mid-season starts correctly. A null deadline (not yet
  // computed by compute-deadlines) is treated as not-yet-passed rather than
  // excluded. Returns '' if every gameweek's deadline has already passed
  // (nothing left to default to).
  function defaultStartGameweekId(rows) {
    const now = Date.now()
    const next = rows.find((gw) => !gw.deadline_utc || new Date(gw.deadline_utc).getTime() > now)
    return next ? String(next.id) : ''
  }

  // Final gameweek default: whichever gameweek this league/season actually
  // returns last (rows are already ordered by number ascending) — never a
  // hardcoded 38, so a shorter cup competition would default correctly too.
  function defaultEndGameweekId(rows) {
    const last = rows[rows.length - 1]
    return last ? String(last.id) : ''
  }

  // Custom competition default (LMS and Predictor both): 20 gameweeks on
  // from the start gameweek, inclusive, capped at the season's actual last
  // gameweek if fewer than 20 remain. Never a hardcoded gameweek number —
  // reads directly off whichever gameweeks this league/season returned.
  function defaultCustomEndGameweekId(rows, startId) {
    const startGw = rows.find((gw) => String(gw.id) === String(startId))
    if (!startGw) return defaultEndGameweekId(rows)

    const targetNumber = startGw.number + MAX_CUSTOM_COMPETITION_GAMEWEEKS - 1
    const eligible = rows.filter((gw) => gw.number >= startGw.number)
    const withinCap = eligible.filter((gw) => gw.number <= targetNumber)
    const chosen = withinCap.length > 0 ? withinCap[withinCap.length - 1] : eligible[eligible.length - 1]

    return chosen ? String(chosen.id) : ''
  }

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

  // Gameweeks are only needed for LMS's and Predictor's Custom-competition
  // start/end selectors — fetched per selected league/season rather than
  // eagerly, since most pots (Pick 5, and any Full-season/Two-half pot)
  // never need this list rendered at all.
  useEffect(() => {
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
          .select('id, number, name, deadline_utc')
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

  // Start/Final Gameweek defaults recompute whenever the available
  // gameweeks change (new league/season loaded) or the organiser switches
  // game mode / duration mode / Predictor cycle mode — each combination has
  // its own sensible default, and switching modes is already a natural
  // reset point for every other mode-specific field on this form.
  //
  // LMS Full season and Predictor Two-half-season both resolve
  // start/end automatically (first available -> the season's actual final
  // gameweek) with no selector shown at all — "the engine automatically
  // uses the first available and final gameweek," per the brief, is already
  // exactly what both engines do once these values are set; nothing new is
  // needed there. LMS Custom and Predictor Custom competition both show and
  // use both selectors, each defaulting to a 20-gameweek span from the
  // start gameweek.
  useEffect(() => {
    if (gameType === 'last_man_standing' && lmsDurationMode === 'custom') {
      const start = defaultStartGameweekId(gameweeksForLeague)
      setStartGameweekId(start)
      setEndGameweekId(defaultCustomEndGameweekId(gameweeksForLeague, start))
    } else if (gameType === 'last_man_standing') {
      setStartGameweekId(defaultStartGameweekId(gameweeksForLeague))
      setEndGameweekId(defaultEndGameweekId(gameweeksForLeague))
    } else if (gameType === 'score_predictor' && predictorCycleMode === 'single_cycle') {
      const start = defaultStartGameweekId(gameweeksForLeague)
      setStartGameweekId(start)
      setEndGameweekId(defaultCustomEndGameweekId(gameweeksForLeague, start))
    } else if (gameType === 'score_predictor') {
      setStartGameweekId('')
      setEndGameweekId(defaultEndGameweekId(gameweeksForLeague))
    } else {
      setStartGameweekId('')
      setEndGameweekId('')
    }
  }, [gameweeksForLeague, gameType, lmsDurationMode, predictorCycleMode])

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
    // Start/Final Gameweek reset themselves reactively via the
    // [gameweeksForLeague, gameType, lmsDurationMode, predictorCycleMode]
    // effect above, once gameType/duration mode below take effect.
    setLmsDurationMode('full_season')
    setWipeoutResolution('split_prize')
    setPredictorCycleMode('two_halves')
    setPredictorScorerScope('gameweek_wide')
    setPredictorExactScorePoints('5')
    setPredictorCorrectResultPoints('3')
    setPredictorScorerBonusPoints('2')
    setErrors({})
  }

  // Returns a field-key -> message map covering every rule that used to
  // return a single bottom-toast string. Every rule runs (no short-
  // circuiting) so every invalid field gets its own inline message at once;
  // only the FIRST (per FIELD_ORDER) is scrolled to and focused — see
  // handleCreatePot.
  function validate() {
    const nextErrors = {}

    const trimmedName = name.trim()
    if (!trimmedName) nextErrors.name = 'Pot name is required'

    if (showLeagueSelector && !selectedLeague) {
      nextErrors.league = 'Select a league/tournament'
    }

    const fee = Number(entryFee)
    if (entryFee === '' || Number.isNaN(fee) || fee < 0) {
      nextErrors.entryFee = 'Entry fee must be zero or a positive amount'
    }

    if (maxMembers !== '' && Number(maxMembers) < 2) {
      nextErrors.maxMembers = 'Max members must be at least 2, or left blank for unlimited'
    }

    if (adminFeeType === 'fixed' && (adminFeeAmount === '' || Number(adminFeeAmount) < 0)) {
      nextErrors.adminFeeAmount = 'Enter the admin fee amount'
    }
    if (adminFeeType === 'percentage' && (adminFeePercentage === '' || Number(adminFeePercentage) < 0 || Number(adminFeePercentage) > 100)) {
      nextErrors.adminFeePercentage = 'Enter an admin fee percentage between 0 and 100'
    }
    if (charityFeeType === 'fixed' && (charityFeeAmount === '' || Number(charityFeeAmount) < 0)) {
      nextErrors.charityFeeAmount = 'Enter the charity fee amount'
    }
    if (charityFeeType === 'percentage' && (charityFeePercentage === '' || Number(charityFeePercentage) < 0 || Number(charityFeePercentage) > 100)) {
      nextErrors.charityFeePercentage = 'Enter a charity fee percentage between 0 and 100'
    }

    if (gameType === 'last_man_standing') {
      if (!startGameweekId) nextErrors.startGameweek = 'Select the gameweek Last Man Standing picks begin (this is also the entry-window cutoff)'
      if (!endGameweekId) nextErrors.endGameweek = "Select the season's final gameweek — without it, a season-end tie can never be resolved"

      if (lmsDurationMode === 'custom' && !nextErrors.startGameweek && !nextErrors.endGameweek) {
        const startGw = gameweeksForLeague.find((gw) => String(gw.id) === String(startGameweekId))
        const endGw = gameweeksForLeague.find((gw) => String(gw.id) === String(endGameweekId))

        if (startGw && endGw) {
          if (endGw.number < startGw.number) {
            nextErrors.endGameweek = 'The final gameweek must be on or after the start gameweek'
          } else if (endGw.number - startGw.number + 1 > MAX_CUSTOM_COMPETITION_GAMEWEEKS) {
            nextErrors.endGameweek = `A custom competition can span at most ${MAX_CUSTOM_COMPETITION_GAMEWEEKS} gameweeks`
          }
        }
      }
    }

    if (gameType === 'score_predictor') {
      if (!endGameweekId) nextErrors.endGameweek = "Select the season's final gameweek — Score Predictor has no other way to conclude the competition"

      if (predictorCycleMode === 'single_cycle') {
        if (!startGameweekId) nextErrors.startGameweek = 'Select the start gameweek for this custom competition'

        if (!nextErrors.startGameweek && !nextErrors.endGameweek) {
          const startGw = gameweeksForLeague.find((gw) => String(gw.id) === String(startGameweekId))
          const endGw = gameweeksForLeague.find((gw) => String(gw.id) === String(endGameweekId))

          if (startGw && endGw) {
            if (endGw.number < startGw.number) {
              nextErrors.endGameweek = 'The final gameweek must be on or after the start gameweek'
            } else if (endGw.number - startGw.number + 1 > MAX_CUSTOM_COMPETITION_GAMEWEEKS) {
              nextErrors.endGameweek = `A custom competition can span at most ${MAX_CUSTOM_COMPETITION_GAMEWEEKS} gameweeks`
            }
          }
        }
      }

      if (predictorExactScorePoints === '' || Number(predictorExactScorePoints) < 0) {
        nextErrors.predictorExactScorePoints = 'Enter a valid, non-negative exact score point value'
      }
      if (predictorCorrectResultPoints === '' || Number(predictorCorrectResultPoints) < 0) {
        nextErrors.predictorCorrectResultPoints = 'Enter a valid, non-negative correct result point value'
      }
      if (predictorScorerBonusPoints === '' || Number(predictorScorerBonusPoints) < 0) {
        nextErrors.predictorScorerBonusPoints = 'Enter a valid, non-negative scorer bonus point value'
      }
    }

    return nextErrors
  }

  async function handleCreatePot(e) {
    e.preventDefault()

    // Not a field the organiser can fix by editing the form — the submit
    // button is already disabled in this state; this is defense-in-depth
    // only. An environment/data problem, not a validation failure, so it
    // stays a toast rather than trying to focus a field that doesn't exist.
    if (noActiveLeagues) {
      setErrorMessage('No active league is available right now — pots cannot be created until one is configured')
      return
    }

    const validationErrors = validate()
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      const firstInvalidKey = FIELD_ORDER.find((key) => validationErrors[key])
      const target = firstInvalidKey ? fieldRefs.current[firstInvalidKey] : null
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        target.focus({ preventScroll: true })
      }
      return
    }

    setErrors({})
    setErrorMessage('')

    try {
      const pot = await createPot.mutateAsync({
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

      // Phase 10B, Part 13 — was resetForm() + a bottom-of-page toast,
      // leaving the organiser staring at a now-blank form with their new
      // pot buried in the list below. The competition itself is the
      // success state: land directly on its Manage page (invite code/
      // add-by-username, both immediately actionable) rather than making
      // "Invite players" a second thing they have to go find.
      resetForm()
      await loadPots()
      navigate(`/pot/${pot.id}/manage`, { state: { justCreated: true } })
    } catch (err) {
      // Server/unexpected failure — exactly what toasts are reserved for.
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

          <form onSubmit={handleCreatePot} noValidate className="space-y-6">
            {/* Competition — identity and format. Nothing here ever locks. */}
            <div className={sectionCardClass}>
              <h3 className={sectionHeadingClass}>Competition</h3>

              <div>
                <label className={labelClass} htmlFor="pot-name">Pot name</label>
                <input
                  ref={setFieldRef('name')}
                  id="pot-name"
                  type="text"
                  value={name}
                  onChange={(e) => { setName(e.target.value); clearError('name') }}
                  placeholder="Office pool"
                  className={inputClassFor(!!errors.name)}
                />
                <FieldError message={errors.name} />
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
                      ref={setFieldRef('league')}
                      id="pot-league"
                      value={leagueId}
                      onChange={(e) => { setLeagueId(e.target.value); clearError('league') }}
                      className={selectClassFor(!!errors.league)}
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
                  <FieldError message={errors.league} />

                  {selectedLeague ? (
                    <p className={hintClass}>Season: {formatSeasonName(selectedLeague.seasons)}</p>
                  ) : null}
                </div>
              ) : selectedLeague ? (
                <p className={hintClass}>
                  League: {selectedLeague.name}
                  {selectedLeague.country ? ` (${selectedLeague.country})` : ''} · Season:{' '}
                  {formatSeasonName(selectedLeague.seasons)}
                </p>
              ) : null}

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
            </div>

            {/* Financial settings — everything that locks at first join. */}
            <div className={sectionCardClass}>
              <h3 className={sectionHeadingClass}>Financial settings</h3>
              <p className={hintClass}>
                Entry fee and fees lock as soon as the first player joins — double-check these before creating the pot.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="pot-entry-fee">Entry fee</label>
                  <input
                    ref={setFieldRef('entryFee')}
                    id="pot-entry-fee"
                    type="number"
                    min="0"
                    step="0.01"
                    value={entryFee}
                    onChange={(e) => { setEntryFee(e.target.value); clearError('entryFee') }}
                    className={inputClassFor(!!errors.entryFee)}
                  />
                  <FieldError message={errors.entryFee} />
                </div>

                <div>
                  <label className={labelClass} htmlFor="pot-max-members">Max members (optional)</label>
                  <input
                    ref={setFieldRef('maxMembers')}
                    id="pot-max-members"
                    type="number"
                    min="2"
                    step="1"
                    value={maxMembers}
                    onChange={(e) => { setMaxMembers(e.target.value); clearError('maxMembers') }}
                    placeholder="Unlimited"
                    className={inputClassFor(!!errors.maxMembers)}
                  />
                  <FieldError message={errors.maxMembers} />
                </div>

                <FeeFields
                  idPrefix="admin-fee"
                  label="Admin fee"
                  type={adminFeeType}
                  onTypeChange={setAdminFeeType}
                  amount={adminFeeAmount}
                  onAmountChange={(v) => { setAdminFeeAmount(v); clearError('adminFeeAmount') }}
                  percentage={adminFeePercentage}
                  onPercentageChange={(v) => { setAdminFeePercentage(v); clearError('adminFeePercentage') }}
                  amountError={errors.adminFeeAmount}
                  percentageError={errors.adminFeePercentage}
                  amountRef={setFieldRef('adminFeeAmount')}
                  percentageRef={setFieldRef('adminFeePercentage')}
                />

                <FeeFields
                  idPrefix="charity-fee"
                  label="Charity fee"
                  type={charityFeeType}
                  onTypeChange={setCharityFeeType}
                  amount={charityFeeAmount}
                  onAmountChange={(v) => { setCharityFeeAmount(v); clearError('charityFeeAmount') }}
                  percentage={charityFeePercentage}
                  onPercentageChange={(v) => { setCharityFeePercentage(v); clearError('charityFeePercentage') }}
                  amountError={errors.charityFeeAmount}
                  percentageError={errors.charityFeePercentage}
                  amountRef={setFieldRef('charityFeeAmount')}
                  percentageRef={setFieldRef('charityFeePercentage')}
                />
              </div>
            </div>

            {/* Competition rules — only what's relevant to the selected mode. */}
            {gameType === 'last_man_standing' ? (
              <div className={sectionCardClass}>
                <h3 className={sectionHeadingClass}>Competition rules</h3>

                <div>
                  <label className={labelClass} htmlFor="pot-lms-duration">Competition duration</label>
                  <div className="relative">
                    <select
                      id="pot-lms-duration"
                      value={lmsDurationMode}
                      onChange={(e) => setLmsDurationMode(e.target.value)}
                      className={selectClass}
                    >
                      {LMS_DURATION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <ChevronDown size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/45" />
                  </div>
                </div>

                {lmsDurationMode === 'custom' ? (
                  <div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <GameweekSelect
                        id="pot-start-gameweek"
                        label="Start gameweek (entry-window cutoff)"
                        value={startGameweekId}
                        onChange={(v) => { setStartGameweekId(v); clearError('startGameweek') }}
                        gameweeks={gameweeksForLeague}
                        loading={gameweeksLoading}
                        placeholder="Select a gameweek"
                        error={errors.startGameweek}
                        fieldRef={setFieldRef('startGameweek')}
                      />
                      <GameweekSelect
                        id="pot-end-gameweek-lms"
                        label="Final gameweek (season conclusion)"
                        value={endGameweekId}
                        onChange={(v) => { setEndGameweekId(v); clearError('endGameweek') }}
                        gameweeks={gameweeksForLeague}
                        loading={gameweeksLoading}
                        placeholder="Select a gameweek"
                        error={errors.endGameweek}
                        fieldRef={setFieldRef('endGameweek')}
                      />
                    </div>
                    <p className={hintClass}>
                      A custom competition can span at most {MAX_CUSTOM_COMPETITION_GAMEWEEKS} gameweeks.
                    </p>
                  </div>
                ) : (
                  <p className={hintClass}>Runs from the first available gameweek to the season's final gameweek — no gameweeks to choose.</p>
                )}

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
                  <label className={labelClass}>If multiple players are still alive at the final gameweek</label>
                  <p className="text-sm text-white/60">{SEASON_END_SUPPORTED_LABEL}</p>
                </div>
              </div>
            ) : null}

            {gameType === 'score_predictor' ? (
              <div className={sectionCardClass}>
                <h3 className={sectionHeadingClass}>Competition rules</h3>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass} htmlFor="pot-cycle-mode">Competition length</label>
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

                {predictorCycleMode === 'single_cycle' ? (
                  <div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <GameweekSelect
                        id="pot-start-gameweek-predictor"
                        label="Start gameweek"
                        value={startGameweekId}
                        onChange={(v) => { setStartGameweekId(v); clearError('startGameweek') }}
                        gameweeks={gameweeksForLeague}
                        loading={gameweeksLoading}
                        placeholder="Select a gameweek"
                        error={errors.startGameweek}
                        fieldRef={setFieldRef('startGameweek')}
                      />
                      <GameweekSelect
                        id="pot-end-gameweek-predictor"
                        label="End gameweek"
                        value={endGameweekId}
                        onChange={(v) => { setEndGameweekId(v); clearError('endGameweek') }}
                        gameweeks={gameweeksForLeague}
                        loading={gameweeksLoading}
                        placeholder="Select a gameweek"
                        error={errors.endGameweek}
                        fieldRef={setFieldRef('endGameweek')}
                      />
                    </div>
                    <p className={hintClass}>
                      A custom competition can span at most {MAX_CUSTOM_COMPETITION_GAMEWEEKS} gameweeks.
                    </p>
                  </div>
                ) : (
                  <p className={hintClass}>Runs automatically across the whole season — no gameweeks to choose.</p>
                )}

                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className={labelClass} htmlFor="pot-exact-score-points">Exact score points</label>
                    <input
                      ref={setFieldRef('predictorExactScorePoints')}
                      id="pot-exact-score-points"
                      type="number"
                      min="0"
                      step="1"
                      value={predictorExactScorePoints}
                      onChange={(e) => { setPredictorExactScorePoints(e.target.value); clearError('predictorExactScorePoints') }}
                      className={inputClassFor(!!errors.predictorExactScorePoints)}
                    />
                    <FieldError message={errors.predictorExactScorePoints} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="pot-correct-result-points">Correct result points</label>
                    <input
                      ref={setFieldRef('predictorCorrectResultPoints')}
                      id="pot-correct-result-points"
                      type="number"
                      min="0"
                      step="1"
                      value={predictorCorrectResultPoints}
                      onChange={(e) => { setPredictorCorrectResultPoints(e.target.value); clearError('predictorCorrectResultPoints') }}
                      className={inputClassFor(!!errors.predictorCorrectResultPoints)}
                    />
                    <FieldError message={errors.predictorCorrectResultPoints} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="pot-scorer-bonus-points">Goalscorer bonus points</label>
                    <input
                      ref={setFieldRef('predictorScorerBonusPoints')}
                      id="pot-scorer-bonus-points"
                      type="number"
                      min="0"
                      step="1"
                      value={predictorScorerBonusPoints}
                      onChange={(e) => { setPredictorScorerBonusPoints(e.target.value); clearError('predictorScorerBonusPoints') }}
                      className={inputClassFor(!!errors.predictorScorerBonusPoints)}
                    />
                    <FieldError message={errors.predictorScorerBonusPoints} />
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
                    <div>Season: {formatSeasonName(row.pots?.seasons)}</div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {errorMessage ? <Toast message={errorMessage} type="error" /> : null}
    </div>
  )
}
