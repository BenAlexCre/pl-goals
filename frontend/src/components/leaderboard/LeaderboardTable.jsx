import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import Card from '../ui/Card'
import Badge from '../ui/Badge'
import Avatar from '../ui/Avatar'
import { PICK5_PICK_COUNT, strikeRate } from '../../utils/scoring'

// Mode-aware per-row rendering. pot_standings_snapshots' shape is already
// generic (rank/score/meta) — only the DISPLAY of score/meta differs per
// mode (Pick5: score is picks-won-of-5; LMS: score is 1/0 alive/eliminated,
// meta.competitiveStatus/eliminatedGameweekId; Predictor: score is
// unbounded cumulative points, meta.exactScoreCount/correctScorerCount) —
// see each engine's own generateStandings() for the exact meta shape this
// mirrors. gameType defaults to 'pick5' so the one existing call site
// (GameweekPage.jsx) needs no change.
//
// Phase 10B, Part 3/4/10 — lmsPickData (optional, a Map of
// userId -> useLmsCompetitionPicks() row) turns each LMS row into an
// expandable "who picked what" view instead of a second, parallel list on
// LmsPotDetail.jsx. Purely additive: omitted (as every existing call site
// still does), rows render exactly as before — same markup, same keys, same
// Pick5/Predictor behaviour.
export default function LeaderboardTable({ rows = [], gameType = 'pick5', lmsPickData = null, gameweeks = [] }) {
  const [expandedUserId, setExpandedUserId] = useState(null)
  const showLmsPicks = gameType === 'last_man_standing' && !!lmsPickData

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-white/8">
        <h3 className="text-sm font-semibold text-white">Leaderboard</h3>
      </div>

      <div className="divide-y divide-white/6">
        {rows.map((row) => {
          const memberPicks = showLmsPicks ? lmsPickData.get(row.user_id) : null
          const isExpanded = showLmsPicks && expandedUserId === row.user_id

          return (
            <div key={`${row.user_id}-${row.gameweek_id ?? 'overall'}`}>
              <div
                role={showLmsPicks ? 'button' : undefined}
                tabIndex={showLmsPicks ? 0 : undefined}
                onClick={showLmsPicks ? () => setExpandedUserId(isExpanded ? null : row.user_id) : undefined}
                onKeyDown={showLmsPicks ? (e) => e.key === 'Enter' && setExpandedUserId(isExpanded ? null : row.user_id) : undefined}
                className={`px-4 py-3 flex items-center gap-3 ${showLmsPicks ? 'cursor-pointer hover:bg-white/[0.02]' : ''}`}
              >
                <div className="w-8 text-center text-sm tabular text-white/35">
                  #{row.rank}
                </div>
                <Avatar user={row.profiles} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {row.profiles?.display_name ?? 'Unknown'}
                  </p>
                  <RowDetailLabel gameType={gameType} row={row} memberPicks={memberPicks} />
                </div>
                <RowDetailBadge gameType={gameType} row={row} />
                {showLmsPicks ? (
                  isExpanded ? <ChevronUp size={16} className="text-white/30" /> : <ChevronDown size={16} className="text-white/30" />
                ) : null}
              </div>

              {isExpanded ? (
                <div className="bg-black/15 px-4 py-3 pl-[3.75rem]">
                  {memberPicks?.picks?.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {memberPicks.picks
                        .slice()
                        .sort((a, b) => a.gameweek_id - b.gameweek_id)
                        .map((p) => (
                          <span key={p.id} className="rounded-full border border-white/10 bg-surface-2 px-3 py-1 text-xs text-white/60">
                            GW{gameweeks.find((gw) => gw.id === p.gameweek_id)?.number ?? p.gameweek_id}: {p.teams?.short_name || p.teams?.name}
                          </span>
                        ))}
                    </div>
                  ) : (
                    <p className="text-xs text-white/35">No picks made yet.</p>
                  )}
                </div>
              ) : null}
            </div>
          )
        })}

        {rows.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-white/35">
            No leaderboard data yet.
          </div>
        )}
      </div>
    </Card>
  )
}

// Split into two so the badge (trailing, flex-shrink-0) and label (in the
// flex-1 middle column) can live in their correct JSX positions above
// without RowDetail's fragment being torn apart by layout — same visual
// result as the original single Badge-at-the-end layout, per mode.
function RowDetailLabel({ gameType, row, memberPicks }) {
  if (gameType === 'last_man_standing') {
    const status = row.meta?.competitiveStatus ?? 'alive'
    const eliminatedGw = row.meta?.eliminatedGameweekId

    if (status === 'eliminated') {
      return (
        <p className="text-xs text-white/35">
          {eliminatedGw ? `Eliminated in GW${eliminatedGw}` : 'Eliminated'}
        </p>
      )
    }

    // memberPicks is only present when the caller passed lmsPickData (LMS's
    // own main page) — GameweekPage.jsx's call site never does, so this
    // stays exactly "Still alive" there, unchanged.
    if (memberPicks) {
      const pickedTeam = memberPicks.currentPick?.teams?.short_name || memberPicks.currentPick?.teams?.name
      return (
        <p className="text-xs text-white/35">
          {pickedTeam ? `Picked: ${pickedTeam}` : 'No pick yet this gameweek'}
        </p>
      )
    }

    return <p className="text-xs text-white/35">Still alive</p>
  }

  if (gameType === 'score_predictor') {
    const exact = row.meta?.exactScoreCount ?? 0
    const scorer = row.meta?.correctScorerCount ?? 0
    return (
      <p className="text-xs text-white/35">
        {exact} exact score{exact === 1 ? '' : 's'} • {scorer} scorer bonus{scorer === 1 ? '' : 'es'}
      </p>
    )
  }

  return (
    <p className="text-xs text-white/35">
      {row.score}/{PICK5_PICK_COUNT} correct • {strikeRate(row.score, PICK5_PICK_COUNT)}% strike rate
    </p>
  )
}

function RowDetailBadge({ gameType, row }) {
  if (gameType === 'last_man_standing') {
    return <Badge status={row.meta?.competitiveStatus ?? 'alive'} />
  }

  if (gameType === 'score_predictor') {
    return (
      <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-xs font-medium text-white/70 tabular flex-shrink-0">
        {row.score} pts
      </span>
    )
  }

  return (
    <Badge status={row.score === PICK5_PICK_COUNT ? 'won' : 'pending'}>
      {row.score}/{PICK5_PICK_COUNT}
    </Badge>
  )
}
