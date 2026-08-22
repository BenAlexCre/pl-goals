import { describe, it, expect, vi, beforeEach } from 'vitest'

// Remediation (F5, red-team audit) — regression test for the dual-active-
// team player data corruption. Root cause: the OLD deactivation logic
// (markExistingTeamHistoryInactive) only ever deactivated a player's stale
// active row when that OLD team's own sync happened to run again in the
// SAME pass (scoped by team+season, not by player) — a transfer away from a
// team that wasn't re-synced (TEAM_FILTER is an explicitly supported
// partial-sync mode) left the stale row active forever, while the player
// also gained a new active row at their new team. 16 real production
// players were found with two simultaneously is_active=true rows because of
// this. deactivateOtherActiveTeams() fixes it by deactivating ANY other
// active row for the player (not just the specific old team), regardless of
// whether that old team is re-synced in this run. This pins the exact PATCH
// request it must issue.
process.env.SUPABASE_URL = 'https://example.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
process.env.FOOTBALL_DATA_KEY = 'test-football-data-key'

const { deactivateOtherActiveTeams } = await import('./fullSyncPlayers.js')

describe('deactivateOtherActiveTeams (F5 dual-active-team fix)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))))
  })

  it('PATCHes player_team_history to deactivate any OTHER active row for these players, not scoped to a specific old team', async () => {
    await deactivateOtherActiveTeams([747, 821], /* currentTeamId */ 1, /* seasonId */ 1)

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetch.mock.calls[0]

    // Must filter by player_id IN (...) and exclude only the team the
    // player is CONFIRMED active at now — critically NOT filtered to any
    // specific "old" team_id, which was the exact scoping bug.
    expect(url).toContain('player_id=in.(747,821)')
    expect(url).toContain('team_id=neq.1')
    expect(url).toContain('season_id=eq.1')
    expect(url).toContain('is_active=eq.true')

    expect(options.method).toBe('PATCH')
    const body = JSON.parse(options.body)
    expect(body.is_active).toBe(false)
    expect(body.left_at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('does not issue a request when there are no players to deactivate', async () => {
    await deactivateOtherActiveTeams([], 1, 1)
    expect(fetch).not.toHaveBeenCalled()
  })
})
