// Phase 8C — creates synthetic auth.users + profiles for a demo session.
// Uses @example.test (RFC 2606, reserved for testing, guaranteed never to
// resolve/deliver) so these accounts can never be contacted even if a real
// email provider is configured later. email_confirm: true — these are
// synthetic demo accounts, not real people who need to prove ownership of
// an inbox, so auto-confirming is correct here and doesn't touch or bypass
// the (separately-scoped, deferred) real-user verification work.
//
// The existing handle_new_user() trigger (001_initial_schema.sql) already
// reads username/display_name out of raw_user_meta_data, so profile
// creation is free — this file only needs a follow-up update to set
// profiles.is_demo = true, which the trigger has no knowledge of.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { makeRng, randomPersonName, usernameFromName } from './names.ts'

export interface DemoUser {
  id: string
  username: string
  displayName: string
}

// Self-cleaning: if any create call in this batch fails partway through
// (a real, observed failure mode — createUser's bcrypt hashing is
// genuinely CPU-heavy, and a batch that trips the Edge Runtime's CPU-time
// limit mid-loop leaves earlier successful creates with no caller-side
// record of their ids to roll back), every user this call itself already
// created is deleted before re-throwing, so the caller always sees either
// "this whole batch exists" or "this whole batch doesn't exist" — never a
// partial batch it doesn't know the ids of.
export async function generateDemoUsers(
  sb: SupabaseClient,
  count: number,
  seed: number
): Promise<DemoUser[]> {
  const rng = makeRng(seed + 1) // offset from the league seed so names don't repeat identically
  const users: DemoUser[] = []
  const usedUsernames = new Set<string>()

  try {
    for (let i = 0; i < count; i++) {
      const { first, last } = randomPersonName(rng)
      const displayName = `${first} ${last}`
      let username = usernameFromName(first, last, i)
      while (usedUsernames.has(username)) {
        username = usernameFromName(first, last, i + Math.floor(rng() * 10000))
      }
      usedUsernames.add(username)

      const { data, error } = await sb.auth.admin.createUser({
        email: `demo+${username}@example.test`,
        password: crypto.randomUUID(),
        email_confirm: true,
        user_metadata: { username, display_name: displayName },
      })
      if (error || !data.user) {
        throw new Error(`Failed to create demo user ${username}: ${error?.message ?? 'unknown error'}`)
      }

      const { error: profileError } = await sb
        .from('profiles')
        .update({ is_demo: true })
        .eq('id', data.user.id)
      if (profileError) {
        throw new Error(`Failed to mark demo profile ${username}: ${profileError.message}`)
      }

      users.push({ id: data.user.id, username, displayName })
    }
  } catch (error) {
    if (users.length > 0) {
      await deleteDemoUsers(sb, users.map((u) => u.id))
    }
    throw error
  }

  return users
}

export async function deleteDemoUsers(sb: SupabaseClient, userIds: string[]): Promise<void> {
  for (const userId of userIds) {
    // Best-effort — a user already removed (e.g. a retried teardown) should
    // not block the rest of cleanup. auth.admin.deleteUser cascades
    // profiles (profiles.id references auth.users(id) on delete cascade),
    // so no separate profiles delete is needed here.
    const { error } = await sb.auth.admin.deleteUser(userId)
    if (error && !error.message?.toLowerCase().includes('not found')) {
      throw new Error(`Failed to delete demo user ${userId}: ${error.message}`)
    }
  }
}
