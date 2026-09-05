// POST /api/cancel-subscription
// body: { subscription_id: <supabase uuid>, mode: 'at_period_end' | 'immediate' | 'reactivate' }
// - 'at_period_end' : Stripe.cancel_at_period_end = true (garde accès jusqu'à échéance)
// - 'immediate' : Stripe.cancel(prorate=true) (arrêt et remboursement pro-rata en annuel)
// - 'reactivate' : Stripe.cancel_at_period_end = false (annule une résiliation en attente)
import { supabase, accountFromAuthHeader } from '../../backend/lib/supabase.js'
import { stripe } from '../../backend/lib/stripe.js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  const user = await accountFromAuthHeader(event.headers.authorization || event.headers.Authorization)
  if (!user) return { statusCode: 401, body: 'Unauthorized' }

  const { subscription_id, mode } = JSON.parse(event.body || '{}')
  if (!['at_period_end', 'immediate', 'reactivate'].includes(mode)) return { statusCode: 400, body: 'mode invalide' }

  const { data: sub } = await supabase.from('subscriptions')
    .select('*').eq('id', subscription_id).eq('account_id', user.id).maybeSingle()
  if (!sub) return { statusCode: 404, body: 'abonnement introuvable' }
  if (!sub.stripe_subscription_id) return { statusCode: 400, body: 'aucune subscription Stripe' }

  if (mode === 'at_period_end') {
    await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true })
  } else if (mode === 'reactivate') {
    await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: false })
  } else {
    await stripe.subscriptions.cancel(sub.stripe_subscription_id, { prorate: true })
  }
  // Le webhook `customer.subscription.updated`/`deleted` mettra à jour la DB.

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, mode }),
  }
}
