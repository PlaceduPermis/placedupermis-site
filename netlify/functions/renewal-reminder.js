// Scheduled function : envoie l'email 5 (rappel J-30 renouvellement annuel)
// Netlify Scheduled Function : cron défini dans netlify.toml.
// À implémenter : requête `select * from subscriptions where plan='annuel' and
// status='active' and current_period_end between now+29d and now+31d`
// et pour chaque : sendMail(email 5).
// TODO template complet.
import { supabase } from '../../backend/lib/supabase.js'
import { sendMail } from '../../backend/lib/email.js'

export const handler = async () => {
  const { data: subs, error } = await supabase.rpc('subs_needing_renewal_reminder')
  if (error) return { statusCode: 500, body: error.message }

  let sent = 0
  for (const s of subs || []) {
    const { data: acc } = await supabase.from('accounts').select('email').eq('id', s.account_id).single()
    if (!acc?.email) continue
    await sendMail({
      to: acc.email,
      subject: 'Votre abonnement se termine dans 30 jours',
      html: `<p>Votre abonnement annuel arrive à échéance le ${s.current_period_end?.slice(0, 10)}. Gérer : ${process.env.SITE_URL}/pro/mon-espace/</p>`,
    }).catch(e => console.error('renewal mail', e))
    sent++
  }
  return { statusCode: 200, body: JSON.stringify({ sent }) }
}

export const config = { schedule: '@daily' }  // Netlify cron
