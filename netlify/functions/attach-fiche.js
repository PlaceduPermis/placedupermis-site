// POST /api/attach-fiche  { fiche_id: 'E1808500090' }
// Rattache la fiche au compte connecté. Vérifie l'existence.
// Détermine le verification_status (auto vs pending).
import { supabase, accountFromAuthHeader } from '../../backend/lib/supabase.js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  const user = await accountFromAuthHeader(event.headers.authorization || event.headers.Authorization)
  if (!user) return { statusCode: 401, body: 'Unauthorized' }

  const { fiche_id } = JSON.parse(event.body || '{}')
  if (!fiche_id) return { statusCode: 400, body: 'fiche_id requis' }

  const { data: fiche } = await supabase.from('fiches')
    .select('id, contact_email_official, status').eq('id', fiche_id).maybeSingle()
  if (!fiche) return { statusCode: 404, body: 'fiche introuvable' }
  if (fiche.status !== 'active') return { statusCode: 400, body: 'fiche fermée, revendication impossible' }

  const officialEmail = (fiche.contact_email_official || '').toLowerCase().trim()
  const userEmail = (user.email || '').toLowerCase().trim()
  const verification_status = officialEmail && officialEmail === userEmail ? 'auto' : 'pending'

  const { error } = await supabase.from('account_fiches').upsert({
    account_id: user.id, fiche_id, verification_status,
  }, { onConflict: 'account_id,fiche_id' })
  if (error) return { statusCode: 500, body: error.message }

  // TODO : si 'pending', envoyer un email de confirmation à officialEmail
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, verification_status }),
  }
}
