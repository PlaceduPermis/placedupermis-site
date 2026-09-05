// placedupermis.fr — SDK client Supabase pour l'espace pro
// Utilise le CDN pour éviter le build. Les clés sont publiques (anon key).
//
// À importer dans chaque page /pro/* :
//   <script type="module" src="/pro/assets/pdp-pro.js"></script>
//   const {sb, api, requireAuth} = window.pdp

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm'

const SUPABASE_URL = 'https://xwigrkdfafeazjilryhi.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_ywvQZA1g-jZSD61qSFKUtA_d0LGeGq1'

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true, // parse ?code= dans l'URL au retour du magic link
    flowType: 'pkce',
  },
})

// Wrapper fetch pour appeler nos endpoints /api/* avec le JWT dans le header
async function api(path, {method = 'POST', body} = {}) {
  const { data: { session } } = await sb.auth.getSession()
  if (!session) throw new Error('non authentifié')
  const r = await fetch(path, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.access_token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status, data })
  return data
}

// Guard : redirige vers /pro/connexion si pas de session
async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession()
  if (!session) {
    const returnTo = encodeURIComponent(location.pathname + location.search)
    location.replace(`/pro/connexion/?return=${returnTo}`)
    return null
  }
  return session
}

// Récupère la fiche courante d'un compte (première si multiple, ou celle passée en ?fiche_id=)
async function currentAccountFiche() {
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null
  const requested = new URLSearchParams(location.search).get('fiche_id')
  let query = sb.from('account_fiches')
    .select('fiche_id, fiches(id, name, slug, city, postcode, dept)')
    .eq('account_id', user.id)
  if (requested) query = query.eq('fiche_id', requested)
  const { data } = await query.order('attached_at', { ascending: false }).limit(1)
  return data?.[0] || null
}

// Publie une variable globale accessible depuis toutes les pages
window.pdp = { sb, api, requireAuth, currentAccountFiche, SUPABASE_URL }
