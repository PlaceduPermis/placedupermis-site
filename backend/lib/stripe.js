import Stripe from 'stripe'

const key = process.env.STRIPE_SECRET_KEY
if (!key) throw new Error('STRIPE_SECRET_KEY manquant dans .env')

// apiVersion pinnée à 2024-06-20 : la 2024-12-18 rejette le paramètre "coupon" sur
// promotion_codes.create (breaking change côté Stripe). À réévaluer quand on bump.
export const stripe = new Stripe(key, { apiVersion: '2024-06-20' })

export const PRICES = {
  annuel_launch: process.env.STRIPE_PRICE_ANNUEL_LAUNCH,
  annuel_normal: process.env.STRIPE_PRICE_ANNUEL_NORMAL,
  mensuel_launch: process.env.STRIPE_PRICE_MENSUEL_LAUNCH,
  mensuel_normal: process.env.STRIPE_PRICE_MENSUEL_NORMAL,
}

// Convention : plan = 'annuel' | 'mensuel', is_launch bool
export function priceIdFor(plan, isLaunch) {
  const key = `${plan}_${isLaunch ? 'launch' : 'normal'}`
  const id = PRICES[key]
  if (!id) throw new Error(`price introuvable pour ${key}`)
  return id
}
