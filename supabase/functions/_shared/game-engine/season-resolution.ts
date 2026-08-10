// Shared season/league resolution for automatic rollover-pot creation.
// Extracted 2026-08-10 (docs/decisions.md § Pick 5 jackpot and season
// rollover — corrections pass) after the same "find next season's matching
// league" logic was needed by both Pick5Engine and LmsEngine, and a bug was
// found in LMS's own copy-paste-free-but-still-wrong version (it never
// actually resolved a next season at all — see resolveNextSeasonLeague()'s
// own comment below). GE-18's "duplicate small logic, never cross-import
// between mode engines" convention is deliberately NOT applied here: this
// logic has no per-mode variation whatsoever (a league/season boundary is
// the same concept for every game type), so a shared module is the correct
// choice, not an exception to the rule — GE-18 exists to stop modes from
// silently coupling to each other's *business* logic, not to force a third,
// diverging copy of a mode-agnostic lookup.

import type { GameEngineContext } from './contracts.ts'

// Finds the same league (matched by name + country — leagues has one row
// per season, no stable season-independent identifier) in the next season
// (the smallest year_start strictly after this league's own season).
// Returns null if no later season, or no matching league within it, exists
// in this database yet — the caller decides what that means (Pick 5 and LMS
// both currently treat it as "retry once next season's data has synced").
export async function resolveNextSeasonLeague(
  ctx: GameEngineContext,
  leagueId: number
): Promise<{ id: number; season_id: number } | null> {
  const { data: sourceLeague, error: sourceLeagueError } = await ctx.supabase
    .from('leagues')
    .select('name, country, season_id')
    .eq('id', leagueId)
    .maybeSingle()

  if (sourceLeagueError) {
    throw new Error(`Failed to look up league: ${sourceLeagueError.message}`)
  }
  if (!sourceLeague) {
    return null
  }
  type SourceLeague = { name: string; country: string; season_id: number }
  const league = sourceLeague as SourceLeague

  const { data: sourceSeason, error: sourceSeasonError } = await ctx.supabase
    .from('seasons')
    .select('year_start')
    .eq('id', league.season_id)
    .maybeSingle()

  if (sourceSeasonError) {
    throw new Error(`Failed to look up season: ${sourceSeasonError.message}`)
  }
  if (!sourceSeason) {
    return null
  }

  const { data: allSeasons, error: allSeasonsError } = await ctx.supabase
    .from('seasons')
    .select('id, year_start')
    .order('year_start', { ascending: true })

  if (allSeasonsError) {
    throw new Error(`Failed to look up seasons: ${allSeasonsError.message}`)
  }

  type SeasonRow = { id: number; year_start: number }
  const nextSeason = ((allSeasons ?? []) as SeasonRow[])
    .filter((s) => s.year_start > (sourceSeason as { year_start: number }).year_start)
    .sort((a, b) => a.year_start - b.year_start)[0]

  if (!nextSeason) {
    return null
  }

  const { data: nextLeague, error: nextLeagueError } = await ctx.supabase
    .from('leagues')
    .select('id, season_id')
    .eq('name', league.name)
    .eq('country', league.country)
    .eq('season_id', nextSeason.id)
    .maybeSingle()

  if (nextLeagueError) {
    throw new Error(`Failed to look up next season's league: ${nextLeagueError.message}`)
  }

  return (nextLeague as { id: number; season_id: number } | null) ?? null
}

// The first (lowest-numbered) and final (highest-numbered) gameweek of a
// given league/season — used only for Pick 5's rollover pot, which always
// spans its whole season with no organiser-configurable cutoff (rule 3),
// so "first/final gameweek" is unambiguous. LMS deliberately does NOT use
// this for its own end_gameweek_id: an LMS competition's end gameweek is an
// arbitrary organiser choice within a season (not necessarily the season's
// actual final gameweek), and there's no principled way to carry an
// arbitrary old-season cutoff into a new season automatically — see
// LmsEngine.createRolloverPot()'s own comment.
export async function resolveSeasonGameweekBounds(
  ctx: GameEngineContext,
  leagueId: number,
  seasonId: number
): Promise<{ firstGameweekId: number; finalGameweekId: number } | null> {
  const { data: gameweeks, error } = await ctx.supabase
    .from('gameweeks')
    .select('id, number')
    .eq('league_id', leagueId)
    .eq('season_id', seasonId)
    .order('number', { ascending: true })

  if (error) {
    throw new Error(`Failed to look up season gameweeks: ${error.message}`)
  }

  type GameweekRow = { id: number; number: number }
  const rows = (gameweeks ?? []) as GameweekRow[]
  if (rows.length === 0) {
    return null
  }

  return { firstGameweekId: rows[0].id, finalGameweekId: rows[rows.length - 1].id }
}
