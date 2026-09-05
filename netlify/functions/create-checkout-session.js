// POST /api/create-checkout-session
// body: { plan: 'annuel'|'mensuel', fiche_ids: string[] }
// header: Authorization: Bearer <supabase JWT>
// → { url: <stripe checkout url> }
import { supabase, accountFromAuthHeader } from '../../backend/lib/supabase.js'
import { stripe, priceIdFor } from '../../backend/lib/stripe.js'
import { isLaunchPriceStillAvailable } from '../../backend/lib/launch.js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }

  const user = await accountFromAuthHeader(event.headers.authorization || event.headers.Authorization)
  if (!user) return { statusCode: 401, body: 'Unauthorized' }

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return { statusCode: 400, body: 'Invalid JSON' } }
  const { plan, fiche_ids } = payload
  if (!['annuel', 'mensuel'].includes(plan)) return { statusCode: 400, body: 'plan invalide' }
  if (!Array.isArray(fiche_ids) || !fiche_ids.length) return { statusCode: 400, body: 'fiche_ids requis' }

  // Sécurité : les fiches doivent bien être rattachées à ce compte
  const { data: attached } = await supabase
    .from('account_fiches').select('fiche_id')
    .eq('account_id', user.id).in('fiche_id', fiche_ids)
  if (!attached || attached.length !== fiche_ids.length) {
    return { statusCode: 403, body: 'certaines fiches ne sont pas rattachées à ce compte' }
  }

  const isLaunch = await isLaunchPriceStillAvailable()
  const priceId = priceIdFor(plan, isLaunch)

  // Créer ou réutiliser le Stripe Customer
  const { data: acc } = await supabase.from('accounts').select('*').eq('id', user.id).single()
  let customerId = acc?.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { account_id: user.id, project: 'placedupermis' },
    })
    customerId = customer.id
    await supabase.from('accounts').update({ stripe_customer_id: customerId }).eq('id', user.id)
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: fiche_ids.map(() => ({ price: priceId, quantity: 1 })),
    subscription_data: {
      metadata: {
        project: 'placedupermis',
        account_id: user.id,
        fiche_ids: fiche_ids.join(','),
        plan,
        is_launch: isLaunch ? '1' : '0',
      },
    },
    success_url: `${process.env.SITE_URL}/pro/mon-espace/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.SITE_URL}/pro/mon-espace/?checkout=cancel`,
    allow_promotion_codes: true,
    locale: 'fr',
  })

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: session.url }),
  }
}
