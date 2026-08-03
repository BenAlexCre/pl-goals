import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export function usePots() {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['pots', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pots')
        .select(`
          id, name, description, status, created_at,
          seasons(name, year_start),
          leagues(name),
          pot_members!inner(user_id, role)
        `)
        .eq('pot_members.user_id', user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

export function usePot(potId) {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['pot', potId],
    enabled: !!potId && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pots')
        .select(`
          *,
          seasons(name, year_start),
          leagues(name),
          pot_members(
            user_id, role, joined_at,
            profiles(id, display_name, username, avatar_url)
          )
        `)
        .eq('id', potId)
        .single()
      if (error) throw error
      return data
    },
  })
}

export function useCreatePot() {
  const qc = useQueryClient()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async ({ name, description }) => {
      const { data: season } = await supabase
        .from('seasons').select('id').eq('is_current', true).single()
      const { data: league } = await supabase
        .from('leagues').select('id').eq('is_active', true).limit(1).single()

      const { data: pot, error } = await supabase
        .from('pots')
        .insert({
          name,
          description: description || null,
          created_by: user.id,
          season_id: season?.id,
          league_id: league?.id,
        })
        .select()
        .single()
      if (error) throw error

      // Add creator as admin member
      await supabase.from('pot_members').insert({
        pot_id: pot.id,
        user_id: user.id,
        role: 'admin',
      })
      return pot
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pots'] }),
  })
}