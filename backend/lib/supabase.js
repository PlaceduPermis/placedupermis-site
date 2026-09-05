// Client Supabase côté serveur (utilise le service_role, bypass RLS).
// À utiliser UNIQUEMENT dans les Netlify Functions, jamais dans le front.
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants dans .env')
}

export const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false }
})

// Résout l'account depuis un JWT Supabase (envoyé par le front via Authorization: Bearer ...)
export async function accountFromAuthHeader(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null
  const jwt = authHeader.slice(7)
  const { data, error } = await supabase.auth.getUser(jwt)
  if (error || !data?.user) return null
  return data.user
}
