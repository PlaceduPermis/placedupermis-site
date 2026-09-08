// POST /api/stripe-webhook  (Stripe → nous)
// Signature vérifiée via STRIPE_WEBHOOK_SECRET.
// Événements gérés :
//   - checkout.session.completed → crée subscription + publie brouillon → email 3
//   - customer.subscription.updated → sync statut / cancel_at_period_end
//   - customer.subscription.deleted → passe fiche en 'gratuit'
//   - invoice.paid → enregistre la facture
import { stripe } from '../../backend/lib/stripe.js'
import { supabase } from '../../backend/lib/supabase.js'
import { sendMail } from '../../backend/lib/email.js'

// Déclenche un rebuild Netlify (fiche Premium apparaît/disparaît publiquement).
// Silencieux si NETLIFY_BUILD_HOOK_URL absent (dev local).
async function triggerRebuild(reason) {
  const url = process.env.NETLIFY_BUILD_HOOK_URL
  if (!url) return
  try {
    await fetch(url, { method: 'POST' })
    console.log('rebuild triggered:', reason)
  } catch (e) {
    console.error('rebuild trigger failed:', e.message)
  }
}

// Netlify passe le body en base64 quand `isBase64Encoded=true`. Il faut le buffer brut.
function rawBody(event) {
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body
}

export const handler = async (event) => {
  const sig = event.headers['stripe-signature']
  if (!sig) return { statusCode: 400, body: 'missing signature' }

  let ev
  try {
    ev = stripe.webhooks.constructEvent(rawBody(event), sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (e) {
    console.error('webhook signature invalid', e.message)
    return { statusCode: 400, body: `Webhook Error: ${e.message}` }
  }

  // Filtre projet (au cas où le compte Stripe est partagé avec Parcoursioux)
  const meta = ev.data?.object?.metadata || ev.data?.object?.subscription_details?.metadata
  if (meta?.project && meta.project !== 'placedupermis') {
    return { statusCode: 200, body: 'ignored (other project)' }
  }

  try {
    switch (ev.type) {
      case 'checkout.session.completed':
        await onCheckoutComplete(ev.data.object)
        break
      case 'customer.subscription.updated':
        await onSubUpdated(ev.data.object)
        break
      case 'customer.subscription.deleted':
        await onSubDeleted(ev.data.object)
        break
      case 'invoice.paid':
        await onInvoicePaid(ev.data.object)
        break
      default:
        // ignoré : on log rien pour rester silencieux
    }
    return { statusCode: 200, body: 'ok' }
  } catch (e) {
    console.error('handler error', ev.type, e)
    return { statusCode: 500, body: 'handler error' }
  }
}

async function onCheckoutComplete(session) {
  const sub = await stripe.subscriptions.retrieve(session.subscription)
  const m = sub.metadata || {}
  const fiche_ids = (m.fiche_ids || '').split(',').filter(Boolean)
  const account_id = m.account_id
  const plan = m.plan
  const is_launch = m.is_launch === '1'
  if (!account_id || !fiche_ids.length) return

  for (const fiche_id of fiche_ids) {
    // Créer la subscription en DB
    const { data: subRow } = await supabase.from('subscriptions').insert({
      account_id, fiche_id,
      stripe_subscription_id: sub.id,
      stripe_price_id: sub.items.data[0].price.id,
      plan, is_launch_price: is_launch, status: 'active',
      cancel_at_period_end: sub.cancel_at_period_end,
      current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
      current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    }).select().single()

    // Publier le brouillon (snapshot)
    const { data: draft } = await supabase.from('drafts').select('*').eq('fiche_id', fiche_id).single()
    if (draft) {
      // désactive l'éventuelle publication précédente
      await supabase.from('publications').update({ is_current: false }).eq('fiche_id', fiche_id).eq('is_current', true)
      await supabase.from('publications').insert({
        fiche_id, subscription_id: subRow.id, content: draft, is_current: true,
      })
    }
  }

  // Incrémente compteur early bird (une fois par checkout)
  if (is_launch) await supabase.rpc('increment_launch_counter').then(() => {}).catch(() => {})

  // Email 3 : confirmation abonnement (TODO templates)
  const { data: acc } = await supabase.from('accounts').select('email').eq('id', account_id).single()
  if (acc?.email) {
    await sendMail({
      to: acc.email,
      subject: '✓ Paiement confirmé · votre fiche est en ligne',
      html: `<p>Merci ! Votre abonnement est actif pour ${fiche_ids.length} fiche(s). Voir ma fiche : ${process.env.SITE_URL}/</p>`,
    }).catch(e => console.error('email confirm error', e))
  }

  // Rebuild : la (les) fiche(s) devient(nent) Premium publiquement
  await triggerRebuild(`checkout ${fiche_ids.length} fiche(s)`)
}

async function onSubUpdated(sub) {
  await supabase.from('subscriptions').update({
    status: sub.status,
    cancel_at_period_end: sub.cancel_at_period_end,
    current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
  }).eq('stripe_subscription_id', sub.id)
}

async function onSubDeleted(sub) {
  await supabase.from('subscriptions').update({
    status: 'canceled', canceled_at: new Date().toISOString(),
  }).eq('stripe_subscription_id', sub.id)
  // La publication devient "expirée" : on la désactive → la fiche redevient gratuite.
  const { data: subRow } = await supabase.from('subscriptions')
    .select('fiche_id').eq('stripe_subscription_id', sub.id).single()
  if (subRow?.fiche_id) {
    await supabase.from('publications').update({ is_current: false })
      .eq('fiche_id', subRow.fiche_id).eq('is_current', true)
  }
  // Volontairement PAS de rebuild ici : un build coûte ~6 min de quota Netlify et
  // rien ne presse pour retirer du contenu. La fiche redevient socle au prochain
  // build programmé (lun/mer/ven) — l'ex-abonné garde sa page enrichie quelques
  // jours de plus, ce qui n'est un problème pour personne.
}

async function onInvoicePaid(inv) {
  const { data: subRow } = await supabase.from('subscriptions')
    .select('id, account_id').eq('stripe_subscription_id', inv.subscription).single()
  if (!subRow) return
  await supabase.from('invoices').upsert({
    id: inv.id,
    account_id: subRow.account_id,
    subscription_id: subRow.id,
    amount_paid_eur: (inv.amount_paid || 0) / 100,
    currency: inv.currency,
    status: inv.status,
    invoice_pdf: inv.invoice_pdf,
    hosted_invoice_url: inv.hosted_invoice_url,
    invoice_date: new Date(inv.created * 1000).toISOString(),
  })
}
