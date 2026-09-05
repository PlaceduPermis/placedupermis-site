// Wrapper Brevo (ex-Sendinblue) pour l'envoi d'emails transactionnels.
// Utilisé pour : bienvenue, paiement confirmé, modifs publiées, rappel renouvellement.
// (Le magic link auth est envoyé par Supabase directement, pas ici.)

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email'

export async function sendMail({ to, subject, html, text, replyTo }) {
  const key = process.env.BREVO_API_KEY
  if (!key) throw new Error('BREVO_API_KEY manquant dans .env')

  const fromRaw = process.env.BREVO_FROM || 'placedupermis.fr <bonjour@placedupermis.fr>'
  const m = fromRaw.match(/^(.*?)\s*<(.+)>$/)
  const from = m ? { name: m[1].trim(), email: m[2].trim() } : { email: fromRaw.trim() }
  const replyEmail = replyTo || process.env.BREVO_REPLY_TO || process.env.RESEND_REPLY_TO
  const toList = (Array.isArray(to) ? to : [to]).map(x =>
    typeof x === 'string' ? { email: x } : x
  )

  const body = {
    sender: from,
    to: toList,
    subject,
    htmlContent: html,
    textContent: text,
  }
  if (replyEmail) body.replyTo = { email: replyEmail }

  const r = await fetch(BREVO_URL, {
    method: 'POST',
    headers: {
      'api-key': key,
      'accept': 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    throw new Error(`Brevo ${r.status}: ${detail.slice(0, 300)}`)
  }
  return r.json()
}
