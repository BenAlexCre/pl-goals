// ISSUE-83 (2026-11-02) — which gameweeks compute-scores must dispatch.
//
// compute-scores used to run every engine's calculateScore() for EVERY
// gameweek with status 'upcoming' or 'live' — ~30 gameweeks × 3 game types,
// sequentially, every 3 minutes. Almost all of those are future gameweeks for
// which every engine returns before writing anything, but each still costs
// several database round trips. In production that made the function take
// 6–8 s (p95, up to 20 s), longer than pg_net's 5 s client timeout, so every
// cron call was recorded as a timeout even though the work completed.
//
// A gameweek is skipped only when ALL THREE engines are provably no-ops for it
// (see each engine's calculateScore early returns):
//   - LmsEngine        returns while the gameweek deadline is in the future
//                      (and when deadline_utc is null — but null is NOT skipped
//                      here, to stay conservative);
//   - PredictorEngine  returns when no fixture in the gameweek is live/finished;
//   - Pick5Engine      returns when the gameweek has no 'locked' entries.
// Anything else — deadline passed or unknown, any live/finished fixture, any
// locked entry — is dispatched exactly as before.

export interface GameweekCandidate {
  id: number
  deadline_utc: string | null
}

export interface ScoringSignals {
  /** Gameweek ids with at least one fixture whose status is 'live' or 'finished'. */
  gameweeksWithActiveFixtures: Set<number>
  /** Gameweek ids with at least one game_entries row whose status is 'locked'. */
  gameweeksWithLockedEntries: Set<number>
}

export function needsScoring(gw: GameweekCandidate, signals: ScoringSignals, now: Date): boolean {
  const deadlineInFuture = gw.deadline_utc !== null && new Date(gw.deadline_utc).getTime() > now.getTime()
  if (!deadlineInFuture) return true
  if (signals.gameweeksWithActiveFixtures.has(gw.id)) return true
  if (signals.gameweeksWithLockedEntries.has(gw.id)) return true
  return false
}

export function selectGameweeksToScore(
  gameweeks: GameweekCandidate[],
  signals: ScoringSignals,
  now: Date,
): { toScore: GameweekCandidate[]; skipped: number } {
  const toScore = gameweeks.filter((gw) => needsScoring(gw, signals, now))
  return { toScore, skipped: gameweeks.length - toScore.length }
}
