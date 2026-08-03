import { supabase } from './supabase'

export async function getCurrentOrUpcomingGameweeks() {
  const { data, error } = await supabase
    .from('gameweeks')
    .select('id, number, name, status, deadline_utc, is_current')
    .in('status', ['upcoming', 'live'])
    .order('number', { ascending: true })

  if (error) throw error
  return data ?? []
}

export async function getAvailablePlayersByGameweek(gameweekId) {
  const { data, error } = await supabase
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
    .eq('gameweek_id', gameweekId)
    .order('team_name', { ascending: true })
    .order('display_name', { ascending: true })

  if (error) throw error
  return data ?? []
}

export async function getOrCreateEntry(potId, gameweekId) {
  const { data, error } = await supabase.rpc('get_or_create_entry', {
    p_pot_id: potId,
    p_gameweek_id: gameweekId,
  })

  if (error) throw error
  return data
}

export async function getEntryWithPicks(entryId) {
  const { data, error } = await supabase
    .from('user_entries')
    .select(`
      id,
      pot_id,
      gameweek_id,
      status,
      picks_won,
      picks_total,
      is_void,
      submitted_at,
      locked_at,
      settled_at,
      user_entry_picks (
        id,
        pick_position,
        player_id,
        goal_threshold,
        goals_scored,
        result
      )
    `)
    .eq('id', entryId)
    .single()

  if (error) throw error
  return data
}

export async function saveEntryPicks(entryId, playerIds) {
  const { error } = await supabase.rpc('save_entry_picks', {
    p_entry_id: entryId,
    p_player_ids: playerIds,
  })

  if (error) throw error
}

export async function submitEntry(entryId) {
  const now = new Date().toISOString()

  const { data: entry, error: loadError } = await supabase
    .from('user_entries')
    .select('id, status')
    .eq('id', entryId)
    .single()

  if (loadError) throw loadError
  if (entry.status !== 'pending') throw new Error('Entry is not editable')

  const { error } = await supabase
    .from('user_entries')
    .update({ submitted_at: now })
    .eq('id', entryId)

  if (error) throw error
}