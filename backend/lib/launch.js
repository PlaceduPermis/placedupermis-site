// Détermine si on est encore dans l'early bird (100 places ou 31/12/2026).
import { supabase } from './supabase.js'

export async function isLaunchPriceStillAvailable() {
  const { data } = await supabase
    .from('launch_counter').select('*').eq('id', true).single()
  if (!data) return false
  const now = new Date()
  const endsAt = new Date(data.ends_at)
  return data.seats_taken < data.seats_max && now <= endsAt
}

export async function incrementLaunchCounter() {
  // Atomique : incrémente si seats_taken < seats_max
  const { data, error } = await supabase.rpc('increment_launch_counter')
  if (error) throw error
  return data
}
