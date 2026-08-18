// Phase 9 — Demo Gameweek enhancement (Parts 9/10). Every count here comes
// from useDemoPickInsights() (hooks/useDemoInsights.js), which reads real
// pick5_picks/lms_team_picks/predictor_fixture_picks rows scoped to this
// session's own 3 demo pots — nothing hard-coded, nothing platform-wide.
// Wording deliberately says "these pots"/"this competition", never
// "the league" or "people" (Part 9's own explicit requirement), so it
// reads as "how your competitions react to this result," not a global
// stat about the Premier League itself.
export default function DemoFixtureInsight({ fixture, insights }) {
  if (!insights) return null

  const { playerPickCounts, playerSuccessCounts, teamLmsCounts, fixturePredictorStats } = insights

  const homeTeamId = fixture.home_team?.id
  const awayTeamId = fixture.away_team?.id
  const lmsHome = teamLmsCounts.get(homeTeamId) ?? 0
  const lmsAway = teamLmsCounts.get(awayTeamId) ?? 0

  const predictorStats = fixturePredictorStats.get(fixture.id)

  const goalEvents = (fixture.fixture_events ?? [])
    .filter((e) => e.event_type === 'goal' && e.player_id)
    .sort((a, b) => a.minute - b.minute)

  const lines = []

  if (lmsHome > 0) {
    lines.push(`${lmsHome} LMS ${lmsHome === 1 ? 'player' : 'players'} selected ${fixture.home_team?.short_name || fixture.home_team?.name}`)
  }
  if (lmsAway > 0) {
    lines.push(`${lmsAway} LMS ${lmsAway === 1 ? 'player' : 'players'} selected ${fixture.away_team?.short_name || fixture.away_team?.name}`)
  }
  if (predictorStats?.total > 0) {
    const parts = []
    if (predictorStats.homeWins > 0) parts.push(`${predictorStats.homeWins} home win`)
    if (predictorStats.draws > 0) parts.push(`${predictorStats.draws} draw`)
    if (predictorStats.awayWins > 0) parts.push(`${predictorStats.awayWins} away win`)
    lines.push(`${predictorStats.total} prediction${predictorStats.total === 1 ? '' : 's'} in these pots — ${parts.join(', ')}`)
  }

  const scorerLines = goalEvents.map((event) => {
    const pickCount = playerPickCounts.get(event.player_id) ?? 0
    const successCount = playerSuccessCounts.get(event.player_id) ?? 0
    if (pickCount === 0) return null
    return {
      id: event.id,
      name: event.player?.display_name ?? 'Unknown',
      minute: event.minute,
      pickCount,
      successCount,
    }
  }).filter(Boolean)

  if (lines.length === 0 && scorerLines.length === 0) return null

  return (
    <div className="mt-2 space-y-1.5 rounded-xl border border-white/6 bg-black/10 px-3 py-2.5 text-xs">
      {lines.map((line, index) => (
        <p key={index} className="text-white/50">{line}</p>
      ))}
      {scorerLines.map((s) => (
        <p key={s.id} className="text-accent/80">
          {s.pickCount} Pick 5 {s.pickCount === 1 ? 'entry' : 'entries'} selected {s.name} ({s.minute}&apos;)
          {s.successCount > 0 ? <span className="ml-1 text-accent">&mdash; &#10003; {s.successCount} successful</span> : null}
        </p>
      ))}
    </div>
  )
}
