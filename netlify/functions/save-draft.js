// POST /api/save-draft
// body: { fiche_id, patch: {...champs à modifier} }
// header: Authorization: Bearer <JWT>
// Upsert atomique + log des diffs dans changes_log.
import { supabase, accountFromAuthHeader } from '../../backend/lib/supabase.js'

const ALLOWED = new Set([
  'contact_email', 'contact_phone', 'contact_whatsapp', 'contact_website',
  'description', 'quote_text', 'manager_name', 'manager_role',
  'photos', 'prices', 'hours', 'hours_note', 'specialties',
  'offer_title', 'offer_subtitle', 'offer_tag', 'offer_emoji', 'offer_ends_at',
])

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  const user = await accountFromAuthHeader(event.headers.authorization || event.headers.Authorization)
  if (!user) return { statusCode: 401, body: 'Unauthorized' }

  const { fiche_id, patch } = JSON.parse(event.body || '{}')
  if (!fiche_id || !patch) return { statusCode: 400, body: 'fiche_id + patch requis' }

  // Fiche bien rattachée au compte ?
  const { data: att } = await supabase.from('account_fiches')
    .select('fiche_id').eq('account_id', user.id).eq('fiche_id', fiche_id).maybeSingle()
  if (!att) return { statusCode: 403, body: 'fiche non rattachée' }

  // Filtrer les champs autorisés
  const clean = {}
  for (const [k, v] of Object.entries(patch)) if (ALLOWED.has(k)) clean[k] = v
  if (!Object.keys(clean).length) return { statusCode: 400, body: 'aucun champ valide' }

  // Récup ancien pour diff
  const { data: before } = await supabase.from('drafts').select('*').eq('fiche_id', fiche_id).maybeSingle()

  const { data: after, error } = await supabase.from('drafts').upsert({
    fiche_id, account_id: user.id, ...clean,
  }, { onConflict: 'fiche_id' }).select().single()

  if (error) return { statusCode: 500, body: error.message }

  // Journal des diffs
  const diffs = []
  for (const k of Object.keys(clean)) {
    if (JSON.stringify(before?.[k]) !== JSON.stringify(after[k])) {
      diffs.push({
        account_id: user.id, fiche_id, field: k,
        before_value: before?.[k] ?? null, after_value: after[k],
      })
    }
  }
  if (diffs.length) await supabase.from('changes_log').insert(diffs)

  // Si la fiche est actuellement Premium (abo actif + publication en cours),
  // on met à jour publications.content en silencieux : les modifs seront prises
  // au prochain rebuild (cron quotidien). Pas de rebuild déclenché ici — sinon
  // chaque autosave (~1 par champ) déclencherait un build de 5-8 min.
  const { data: activeSub } = await supabase.from('subscriptions')
    .select('id').eq('fiche_id', fiche_id).eq('status', 'active').maybeSingle()
  if (activeSub) {
    await supabase.from('publications')
      .update({ content: after })
      .eq('fiche_id', fiche_id).eq('is_current', true)
  }

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, draft: after }),
  }
}
