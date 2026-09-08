// POST /api/send-lead  (public, sans auth — appelé depuis une fiche Premium)
// body: { fiche_id, name, email, phone?, message?, website? }
//   `website` est un honeypot : rempli = bot, on répond 200 sans rien faire.
//
// Sécurité : l'adresse du gérant n'est JAMAIS fournie par le client. Elle est relue
// côté serveur depuis la publication active, ce qui empêche d'utiliser l'endpoint
// comme relais d'envoi vers une adresse arbitraire.
import { supabase } from '../../backend/lib/supabase.js'
import { sendMail } from '../../backend/lib/email.js'
import crypto from 'node:crypto'

const MAX_PER_FICHE_PER_HOUR = 10
const esc = (s) => String(s || '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }

  let p
  try { p = JSON.parse(event.body || '{}') } catch { return { statusCode: 400, body: 'Invalid JSON' } }
  const { fiche_id, name, email, phone, message, website } = p

  // Honeypot : un vrai visiteur ne remplit jamais ce champ (masqué en CSS).
  if (website) return { statusCode: 200, body: JSON.stringify({ ok: true }) }

  if (!fiche_id || !name || !email) return { statusCode: 400, body: 'nom et email requis' }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return { statusCode: 400, body: 'email invalide' }
  if (String(name).length > 120 || String(message || '').length > 2000) {
    return { statusCode: 400, body: 'champ trop long' }
  }

  // La fiche doit être Premium en cours : sinon pas de formulaire, donc pas d'envoi.
  const { data: pub } = await supabase.from('publications')
    .select('content').eq('fiche_id', fiche_id).eq('is_current', true).maybeSingle()
  if (!pub) return { statusCode: 404, body: 'fiche non premium' }

  const { data: fiche } = await supabase.from('fiches')
    .select('name, city, slug, contact_email_official').eq('id', fiche_id).maybeSingle()
  if (!fiche) return { statusCode: 404, body: 'fiche introuvable' }

  const target = pub.content?.contact_email || fiche.contact_email_official
  if (!target) return { statusCode: 422, body: 'aucune adresse de contact configurée' }

  // Garde-fou anti-abus : plafond horaire par fiche.
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString()
  const { count } = await supabase.from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('fiche_id', fiche_id).gte('created_at', oneHourAgo)
  if ((count || 0) >= MAX_PER_FICHE_PER_HOUR) {
    return { statusCode: 429, body: 'trop de demandes, réessayez plus tard' }
  }

  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || ''
  const ipHash = ip ? crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16) : null

  const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#16203a">
  <p style="font-size:1.05rem;margin:0 0 4px"><b>Nouvelle demande de devis</b></p>
  <p style="color:#4c5670;margin:0 0 18px">Reçue depuis votre fiche <b>${esc(fiche.name)}</b> sur placedupermis.fr</p>
  <table style="border-collapse:collapse;width:100%">
    <tr><td style="padding:7px 12px 7px 0;color:#4c5670;font-weight:600">Nom</td><td style="padding:7px 0">${esc(name)}</td></tr>
    <tr><td style="padding:7px 12px 7px 0;color:#4c5670;font-weight:600">Email</td><td style="padding:7px 0"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
    ${phone ? `<tr><td style="padding:7px 12px 7px 0;color:#4c5670;font-weight:600">Téléphone</td><td style="padding:7px 0"><a href="tel:${esc(String(phone).replace(/\s/g, ''))}">${esc(phone)}</a></td></tr>` : ''}
    ${message ? `<tr><td style="padding:7px 12px 7px 0;color:#4c5670;font-weight:600;vertical-align:top">Message</td><td style="padding:7px 0;white-space:pre-wrap">${esc(message)}</td></tr>` : ''}
  </table>
  <p style="margin:22px 0 0;padding:12px 14px;background:#eef2fd;border-radius:8px;font-size:.9rem;color:#4c5670">
    Répondez directement à cet email pour recontacter ce candidat.
  </p>
  <p style="color:#8a93a8;font-size:.78rem;margin-top:22px">
    placedupermis.fr · <a href="https://placedupermis.fr/auto-ecole/${esc(fiche.slug)}/" style="color:#2452e0">voir ma fiche</a>
  </p>
</div>`

  let delivered = false
  try {
    await sendMail({
      to: target,
      replyTo: email,
      subject: `Demande de devis · ${name}`,
      html,
    })
    delivered = true
  } catch (e) {
    console.error('send-lead: envoi KO', e.message)
  }

  await supabase.from('leads').insert({
    fiche_id,
    visitor_name: name,
    visitor_email: email,
    visitor_phone: phone || null,
    message: message || null,
    sent_to: target,
    delivered,
    ip_hash: ipHash,
  })

  // On répond OK même si l'email a échoué : le lead est enregistré, on relancera.
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  }
}
