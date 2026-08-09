import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, extractFunctionError } from '../lib/supabase'

// Excludes visually-ambiguous characters (0/O, 1/I/L) — a code meant to be
// typed or read aloud shouldn't need a second glance to tell them apart.
const INVITE_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function randomInviteCode(length = 8) {
  let code = ''
  for (let i = 0; i < length; i++) {
    code += INVITE_CODE_CHARS[Math.floor(Math.random() * INVITE_CODE_CHARS.length)]
  }
  return code
}

// pots.invite_code is globally unique (schema-level, not per-pot) — retries
// on a rare collision rather than trusting a single random draw. No backend
// change: pots_update_admin (002_rls_policies.sql) already lets an admin
// update any column on their own pot, invite_code included.
export function useGenerateInviteCode() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (potId) => {
      const maxAttempts = 5
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const code = randomInviteCode()
        const { data, error } = await supabase
          .from('pots')
          .update({ invite_code: code })
          .eq('id', potId)
          .select('invite_code')
          .single()

        if (!error) return data.invite_code
        if (error.code !== '23505') throw error
        // 23505 (unique violation) on a random 8-char draw from a 32-char
        // alphabet — astronomically unlikely twice, but retry rather than
        // fail a real organiser action on bad luck.
      }
      throw new Error('Could not generate a unique invite code — please try again')
    },
    onSuccess: (_code, potId) => qc.invalidateQueries({ queryKey: ['pot', potId] }),
  })
}

// profiles_select_authenticated (002_rls_policies.sql) already lets any
// authenticated user read any profile row — this is a plain read, not a
// new capability, so it's a query hook rather than something needing a new
// Edge Function. Matches by username only (profiles has no email/phone
// column — auth.users isn't client-readable at all, see admin-actions'
// own bulk-verify identifier resolution for why that needs the service
// role instead).
export function useSearchProfilesByUsername(query) {
  const trimmed = query.trim()
  return useQuery({
    queryKey: ['profile-search', trimmed],
    enabled: trimmed.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .ilike('username', `%${trimmed}%`)
        .limit(8)
      if (error) throw error
      return data ?? []
    },
  })
}

export function useAddMember() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ potId, userId }) => {
      const { data, error } = await supabase.functions.invoke('admin-actions', {
        body: { action: 'add_member', pot_id: potId, invite_user_id: userId },
      })
      if (error) throw await extractFunctionError(error)
      if (data?.error) throw new Error(data.error)
      return data
    },
    onSuccess: (_data, { potId }) => qc.invalidateQueries({ queryKey: ['pot', potId] }),
  })
}

export function useRemoveMember() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ potId, userId }) => {
      const { data, error } = await supabase.functions.invoke('admin-actions', {
        body: { action: 'remove_member', pot_id: potId, remove_user_id: userId },
      })
      if (error) throw await extractFunctionError(error)
      if (data?.error) throw new Error(data.error)
      return data
    },
    onSuccess: (_data, { potId }) => qc.invalidateQueries({ queryKey: ['pot', potId] }),
  })
}

// redeem_invite() (004_game_engine_shared_platform.sql) is a security
// definer RPC — resolves the pot from the code, rejects an invalid code or
// an already-a-member caller, inserts a pot_members row as 'member', all
// server-side. Nothing here duplicates that logic; this just calls it and
// translates its two known exception messages into a friendlier shape the
// UI can branch on, plus a best-effort pot-id lookup for the
// already-a-member case (readable only *after* membership is confirmed,
// since pots RLS requires membership to read a row at all).
export function useRedeemInvite() {
  return useMutation({
    mutationFn: async (inviteCode) => {
      const trimmed = inviteCode.trim()
      const { data, error } = await supabase.rpc('redeem_invite', { p_invite_code: trimmed })

      if (!error) return { potId: data.pot_id, alreadyMember: false }

      if (error.message?.includes('Already a member')) {
        const { data: pot } = await supabase
          .from('pots')
          .select('id')
          .eq('invite_code', trimmed)
          .maybeSingle()
        if (pot) return { potId: pot.id, alreadyMember: true }
      }

      throw error
    },
  })
}
