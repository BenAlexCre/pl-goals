// Phase 8C — the one ordered, FK-safe delete routine used by both a full
// "Reset Demo"/"Delete Demo Data" action (demo-teardown/index.ts, driven by
// a demo_sessions row) AND demo-generate-data's own failure path (driven by
// whatever partial IDs were captured in local variables before the error —
// no demo_sessions row may exist yet if generation failed early). Every
// input is optional so a partial-failure cleanup can pass only what it
// actually created.
//
// Order verified live via information_schema introspection before writing
// this (not assumed): game_entries.pot_id and pot_prizes.pot_id are
// RESTRICT, not CASCADE, off pots — both must be cleared before pots
// itself. fixtures.home_team_id/away_team_id -> teams is NO ACTION, so
// fixtures (and their cascaded fixture_events) are deleted explicitly
// before the seasons row, rather than relying on a single cascading season
// delete to reach through both gameweeks and teams safely. demo_sessions
// itself has plain (no on-delete-cascade) FKs to league_id/season_id/
// gameweek_id — a real bug caught live, not assumed: deleting the season
// while a demo_sessions row still referenced it failed with
// "violates foreign key constraint demo_sessions_season_id_fkey". Fixed by
// deleting the demo_sessions row (which cascades demo_timeline_events)
// right after pots/game_entries, before anything touches seasons/leagues.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface TeardownInput {
  demoSessionId?: string
  leagueId?: number
  seasonId?: number
  userIds?: string[]
}

async function potIdsForLeague(sb: SupabaseClient, leagueId: number): Promise<string[]> {
  const { data, error } = await sb.from('pots').select('id').eq('league_id', leagueId)
  if (error) throw new Error(`Failed to look up demo pots: ${error.message}`)
  return (data ?? []).map((p: { id: string }) => p.id)
}

export async function teardownDemoData(sb: SupabaseClient, input: TeardownInput): Promise<void> {
  const { leagueId, userIds } = input

  if (leagueId) {
    const potIds = await potIdsForLeague(sb, leagueId)

    if (potIds.length > 0) {
      const { error: entriesError } = await sb.from('game_entries').delete().in('pot_id', potIds)
      if (entriesError) throw new Error(`Teardown: failed to delete demo game_entries: ${entriesError.message}`)

      const { error: prizesError } = await sb.from('pot_prizes').delete().in('pot_id', potIds)
      if (prizesError) throw new Error(`Teardown: failed to delete demo pot_prizes: ${prizesError.message}`)

      const { error: potsError } = await sb.from('pots').delete().in('id', potIds)
      if (potsError) throw new Error(`Teardown: failed to delete demo pots: ${potsError.message}`)
    }

    // Must precede the season/league delete below — demo_sessions has
    // plain FKs to league_id/season_id/gameweek_id, not on-delete-cascade.
    if (input.demoSessionId) {
      const { error: sessionError } = await sb.from('demo_sessions').delete().eq('id', input.demoSessionId)
      if (sessionError) throw new Error(`Teardown: failed to delete demo session row: ${sessionError.message}`)
    } else {
      const { error: sessionsByLeagueError } = await sb.from('demo_sessions').delete().eq('league_id', leagueId)
      if (sessionsByLeagueError) throw new Error(`Teardown: failed to delete demo session rows for league: ${sessionsByLeagueError.message}`)
    }

    const { data: gws, error: gwLookupError } = await sb.from('gameweeks').select('id').eq('league_id', leagueId)
    if (gwLookupError) throw new Error(`Teardown: failed to look up demo gameweeks: ${gwLookupError.message}`)
    const gwIds = (gws ?? []).map((g: { id: number }) => g.id)

    if (gwIds.length > 0) {
      const { data: fixtures, error: fxLookupError } = await sb.from('fixtures').select('id').in('gameweek_id', gwIds)
      if (fxLookupError) throw new Error(`Teardown: failed to look up demo fixtures: ${fxLookupError.message}`)
      const fixtureIds = (fixtures ?? []).map((f: { id: number }) => f.id)

      if (fixtureIds.length > 0) {
        const { error: eventsError } = await sb.from('fixture_events').delete().in('fixture_id', fixtureIds)
        if (eventsError) throw new Error(`Teardown: failed to delete demo fixture_events: ${eventsError.message}`)

        const { error: fixturesError } = await sb.from('fixtures').delete().in('id', fixtureIds)
        if (fixturesError) throw new Error(`Teardown: failed to delete demo fixtures: ${fixturesError.message}`)
      }
    }

    // Gameweeks deleted individually and tolerantly, not via a single
    // cascading season delete — a real anomaly hit live in testing: this
    // dev database has a pre-existing, unrelated real game_entry_lms row
    // (hours old, a real user, a real pot) whose eliminated_gameweek_id is
    // a dangling reference to a long-gone gameweek id that Postgres's
    // bigserial sequence later reallocated to one of THIS run's own demo
    // gameweeks. That is pre-existing data corruption this teardown must
    // never touch or paper over (flipping a real user's competitive_status
    // is not this function's call to make) — so instead of one cascading
    // delete that would hard-fail on the collision, each gameweek is
    // deleted on its own and a failure here is swallowed (warned, not
    // thrown): the rest of teardown still completes, and the one
    // colliding gameweek is left behind — harmless, inert residue, not a
    // blocker for a future demo generation run.
    const gameweekWarnings: string[] = []
    for (const gwId of gwIds) {
      const { error: gwDeleteError } = await sb.from('gameweeks').delete().eq('id', gwId)
      if (gwDeleteError) {
        gameweekWarnings.push(`gameweek ${gwId}: ${gwDeleteError.message}`)
      }
    }
    // Teams cascade from season/league (confirmed on delete cascade,
    // 001_initial_schema.sql) but are deleted explicitly here too, not via
    // a season-delete cascade, for the same reason as gameweeks above —
    // keeping this whole block a set of small, independently-failable
    // deletes rather than one all-or-nothing cascade.
    const { error: teamsError } = await sb.from('teams').delete().eq('league_id', leagueId)
    if (teamsError) throw new Error(`Teardown: failed to delete demo teams: ${teamsError.message}`)

    if (gameweekWarnings.length > 0) {
      // Deleting the season/league would cascade-retry the exact gameweek(s)
      // just left behind and fail identically — leave season+league+that
      // gameweek together as one small, clearly-logged residue trio rather
      // than throwing and aborting the rest of this teardown (users/notifications
      // below still need to run regardless).
      console.warn(`Teardown: left demo season ${input.seasonId ?? '?'}/league ${leagueId} in place alongside the gameweek(s) above: ${gameweekWarnings.join('; ')}`)
    } else if (input.seasonId) {
      const { error: seasonError } = await sb.from('seasons').delete().eq('id', input.seasonId)
      if (seasonError) throw new Error(`Teardown: failed to delete demo season: ${seasonError.message}`)
    } else {
      // Fallback if only leagueId was captured (shouldn't normally happen —
      // generateDemoLeague always creates both together).
      const { error: leagueError } = await sb.from('leagues').delete().eq('id', leagueId)
      if (leagueError) throw new Error(`Teardown: failed to delete demo league: ${leagueError.message}`)
    }

    // Demo players are never league/season-scoped directly (players has no
    // such column) — identified by provider_name='demo' + no remaining
    // player_team_history row for this teardown's season (already gone,
    // cascaded above), so the only safe general handle is provider_name.
    // Scoped further to players with zero remaining player_team_history
    // rows at all, so a demo player who (hypothetically) got linked to a
    // second, still-live demo season is never deleted out from under it.
    const { data: orphanCandidates, error: orphanLookupError } = await sb
      .from('players')
      .select('id, player_team_history(id)')
      .eq('provider_name', 'demo')
    if (orphanLookupError) throw new Error(`Teardown: failed to look up demo players: ${orphanLookupError.message}`)
    const orphanIds = (orphanCandidates ?? [])
      .filter((p: { id: number; player_team_history: unknown[] }) => (p.player_team_history?.length ?? 0) === 0)
      .map((p: { id: number }) => p.id)
    if (orphanIds.length > 0) {
      const { error: playersError } = await sb.from('players').delete().in('id', orphanIds)
      if (playersError) throw new Error(`Teardown: failed to delete demo players: ${playersError.message}`)
    }
  }

  if (userIds && userIds.length > 0) {
    const { error: notifError } = await sb.from('notifications').delete().in('user_id', userIds)
    if (notifError) throw new Error(`Teardown: failed to delete demo notifications: ${notifError.message}`)

    for (const userId of userIds) {
      const { error } = await sb.auth.admin.deleteUser(userId)
      if (error && !error.message?.toLowerCase().includes('not found')) {
        throw new Error(`Teardown: failed to delete demo user ${userId}: ${error.message}`)
      }
    }
  }

  // Covers the partial-failure case (demo-generate-data's own error path):
  // no leagueId yet, but a demoSessionId might still exist if the crash
  // happened between creating the session row and finishing league setup.
  if (input.demoSessionId && !leagueId) {
    const { error } = await sb.from('demo_sessions').delete().eq('id', input.demoSessionId)
    if (error) throw new Error(`Teardown: failed to delete demo session row: ${error.message}`)
  }
}
