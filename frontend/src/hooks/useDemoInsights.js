import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

// Phase 9 — Demo Gameweek enhancement. Every number here is read straight
// off the real Game Engine's own tables (pick5_picks.result/goals_scored,
// game_entry_lms.competitive_status, game_entry_predictor.total_points,
// pot_standings_snapshots.rank) — nothing computed or guessed here that
// the engine hasn't already written itself. Batched per pot-mode (3
// queries per hook, not 3×N per-card queries), same idiom as Phase 9A's
// useDashboardPotStatus() (hooks/usePots.js).

const DEMO_POT_STALE_TIME = 10_000

// Pot summary cards — one row of facts per mode, sourced from the three
// known demo pot IDs on the session's own config.
export function useDemoPotSummaries(session) {
  const { user } = useAuthStore()
  const pick5PotId = session?.config?.pick5PotId
  const lmsPotId = session?.config?.lmsPotId
  const predictorPotId = session?.config?.predictorPotId
  const gameweekId = session?.gameweek_id

  return useQuery({
    queryKey: ['demo-pot-summaries', pick5PotId, lmsPotId, predictorPotId, gameweekId, user?.id],
    enabled: !!pick5PotId && !!lmsPotId && !!predictorPotId && !!gameweekId,
    staleTime: DEMO_POT_STALE_TIME,
    queryFn: async () => {
      const [pick5, lms, predictor] = await Promise.all([
        loadPick5Summary(pick5PotId, gameweekId),
        loadLmsSummary(lmsPotId, gameweekId),
        loadPredictorSummary(predictorPotId, gameweekId, user?.id),
      ])
      return { pick5, lms, predictor }
    },
  })
}

// role='member' only — every demo pot's own creator/super-admin is also a
// pot_members row (role='admin', added by generateDemoPots() so they can
// administer it), but they're the operator, not a synthetic participant.
// Counting them would silently inflate "10 players" into "11" for every
// mode (confirmed live — a real off-by-one, not intentional).
async function memberCount(potId) {
  const { count, error } = await supabase
    .from('pot_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('pot_id', potId)
    .eq('role', 'member')
  if (error) throw error
  return count ?? 0
}

// Mirrors PotDetail.jsx's own loadJackpotHistory()/thisWeekContribution
// computation exactly — the same real read, not a second formula for
// "what the jackpot is."
async function loadPick5Summary(potId, gameweekId) {
  const [{ data: entries, error: entriesError }, { data: pot, error: potError }, { data: payments, error: paymentsError }, { data: prizeHistory, error: prizeError }] = await Promise.all([
    supabase.from('game_entries').select('id').eq('pot_id', potId).eq('gameweek_id', gameweekId),
    supabase.from('pots').select('entry_fee').eq('id', potId).single(),
    supabase.from('entry_payments').select('is_paid').eq('pot_id', potId).eq('gameweek_id', gameweekId),
    supabase.from('pot_prizes').select('gameweek_id, net_amount, rollover, gameweeks(number)').eq('pot_id', potId).eq('scope', 'gameweek').eq('is_settled', true),
  ])
  if (entriesError) throw entriesError
  if (potError) throw potError
  if (paymentsError) throw paymentsError
  if (prizeError) throw prizeError

  const entryIds = (entries ?? []).map((e) => e.id)
  let jackpotEligibleCount = 0
  if (entryIds.length > 0) {
    const { data: pick5Entries, error: pick5Error } = await supabase
      .from('game_entry_pick5')
      .select('picks_won, picks_total')
      .in('game_entry_id', entryIds)
    if (pick5Error) throw pick5Error
    jackpotEligibleCount = (pick5Entries ?? []).filter((e) => e.picks_won === e.picks_total).length
  }

  const paidCount = (payments ?? []).filter((p) => p.is_paid).length
  const rows = (prizeHistory ?? []).slice().sort((a, b) => (b.gameweeks?.number ?? 0) - (a.gameweeks?.number ?? 0))
  const mostRecent = rows[0] ?? null
  const rolledOverAmount = mostRecent?.rollover ? Number(mostRecent.net_amount) : 0
  const thisWeekContribution = paidCount * Number(pot?.entry_fee || 0)

  return {
    potId,
    entryCount: entryIds.length,
    memberCount: await memberCount(potId),
    jackpot: rolledOverAmount + thisWeekContribution,
    jackpotEligibleCount,
  }
}

async function loadLmsSummary(potId, gameweekId) {
  const [{ data: gw, error: gwError }, { data: pot, error: potError }] = await Promise.all([
    supabase.from('gameweeks').select('number').eq('id', gameweekId).single(),
    supabase.from('pots').select('start_gameweek_id').eq('id', potId).single(),
  ])
  if (gwError) throw gwError
  if (potError) throw potError

  let round = gw?.number ?? null
  if (pot?.start_gameweek_id) {
    const { data: startGw, error: startGwError } = await supabase
      .from('gameweeks')
      .select('number')
      .eq('id', pot.start_gameweek_id)
      .single()
    if (startGwError) throw startGwError
    if (startGw?.number != null && gw?.number != null) round = gw.number - startGw.number + 1
  }

  const { data: entries, error: entriesError } = await supabase
    .from('game_entries')
    .select('id, game_entry_lms(competitive_status)')
    .eq('pot_id', potId)
    .is('gameweek_id', null)
  if (entriesError) throw entriesError

  const rows = entries ?? []
  const aliveCount = rows.filter((e) => e.game_entry_lms?.competitive_status === 'alive').length

  return {
    potId,
    memberCount: await memberCount(potId),
    entryCount: rows.length,
    aliveCount,
    round,
  }
}

async function loadPredictorSummary(potId, gameweekId, viewerUserId) {
  const { data: entries, error: entriesError } = await supabase
    .from('game_entries')
    .select('id')
    .eq('pot_id', potId)
    .is('gameweek_id', null)
  if (entriesError) throw entriesError

  // "Your position" only appears if the viewing super-admin has actually
  // submitted a prediction themselves (they're a pot member — every demo
  // pot's creator is added as one — but generateDemoPots()/writeUserBatch()
  // never enters a pick on their behalf). Never a fabricated rank.
  let yourRank = null
  if (viewerUserId) {
    const { data: standing, error: standingError } = await supabase
      .from('pot_standings_snapshots')
      .select('rank')
      .eq('pot_id', potId)
      .is('gameweek_id', null)
      .eq('user_id', viewerUserId)
      .maybeSingle()
    if (standingError) throw standingError
    yourRank = standing?.rank ?? null
  }

  return {
    potId,
    memberCount: await memberCount(potId),
    entryCount: (entries ?? []).length,
    yourRank,
  }
}

// Fixture-level pick insight strip — "N users in these pots picked X",
// per-goalscorer "N Pick 5 entries selected him" / "✓ N picks successful".
// Three scoped queries (one per mode), each already narrowed to this
// session's own 3 pot IDs + live gameweek — never a platform-wide count.
export function useDemoPickInsights(session) {
  const pick5PotId = session?.config?.pick5PotId
  const lmsPotId = session?.config?.lmsPotId
  const predictorPotId = session?.config?.predictorPotId
  const gameweekId = session?.gameweek_id

  return useQuery({
    queryKey: ['demo-pick-insights', pick5PotId, lmsPotId, predictorPotId, gameweekId],
    enabled: !!pick5PotId && !!lmsPotId && !!predictorPotId && !!gameweekId,
    staleTime: DEMO_POT_STALE_TIME,
    queryFn: async () => {
      const [pick5Picks, lmsPicks, predictorPicks] = await Promise.all([
        loadPick5PicksForGameweek(pick5PotId, gameweekId),
        loadLmsPicksForGameweek(lmsPotId, gameweekId),
        loadPredictorPicksForGameweek(predictorPotId, gameweekId),
      ])

      const playerPickCounts = new Map()
      const playerSuccessCounts = new Map()
      for (const p of pick5Picks) {
        playerPickCounts.set(p.player_id, (playerPickCounts.get(p.player_id) ?? 0) + 1)
        if (p.result === 'winning' || p.result === 'won') {
          playerSuccessCounts.set(p.player_id, (playerSuccessCounts.get(p.player_id) ?? 0) + 1)
        }
      }

      const teamLmsCounts = new Map()
      for (const p of lmsPicks) {
        teamLmsCounts.set(p.team_id, (teamLmsCounts.get(p.team_id) ?? 0) + 1)
      }

      const fixturePredictorStats = new Map()
      for (const p of predictorPicks) {
        const stats = fixturePredictorStats.get(p.fixture_id) ?? { total: 0, homeWins: 0, draws: 0, awayWins: 0 }
        stats.total += 1
        if (p.predicted_home_score > p.predicted_away_score) stats.homeWins += 1
        else if (p.predicted_home_score < p.predicted_away_score) stats.awayWins += 1
        else stats.draws += 1
        fixturePredictorStats.set(p.fixture_id, stats)
      }

      return { playerPickCounts, playerSuccessCounts, teamLmsCounts, fixturePredictorStats }
    },
  })
}

async function loadPick5PicksForGameweek(potId, gameweekId) {
  const { data: entries, error: entriesError } = await supabase
    .from('game_entries')
    .select('id')
    .eq('pot_id', potId)
    .eq('gameweek_id', gameweekId)
  if (entriesError) throw entriesError
  const entryIds = (entries ?? []).map((e) => e.id)
  if (entryIds.length === 0) return []

  const { data, error } = await supabase
    .from('pick5_picks')
    .select('player_id, result')
    .in('game_entry_id', entryIds)
  if (error) throw error
  return data ?? []
}

async function loadLmsPicksForGameweek(potId, gameweekId) {
  const { data, error } = await supabase
    .from('lms_team_picks')
    .select('team_id, game_entries!inner(pot_id)')
    .eq('gameweek_id', gameweekId)
    .eq('game_entries.pot_id', potId)
  if (error) throw error
  return data ?? []
}

async function loadPredictorPicksForGameweek(potId, gameweekId) {
  const { data, error } = await supabase
    .from('predictor_fixture_picks')
    .select('fixture_id, predicted_home_score, predicted_away_score, game_entries!inner(pot_id)')
    .eq('gameweek_id', gameweekId)
    .eq('game_entries.pot_id', potId)
  if (error) throw error
  return data ?? []
}
