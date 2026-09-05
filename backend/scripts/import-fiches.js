// Import initial des 21k fiches depuis data/schools.json → table public.fiches.
// Idempotent (upsert). Peut être ré-exécuté après chaque rafraîchissement mensuel du pipeline.
//
// Usage :  node backend/scripts/import-fiches.js
// Attend : SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY dans .env

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const SB = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const DATA = path.resolve(__dirname, '../../data/schools.json')
const CONTACTS = path.resolve(__dirname, '../../../auto-ecoles-contacts.xlsx')  // pour email officiel

function pick(s) {
  const addr = s.address || {}
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    status: s.status || 'active',
    address_line1: addr.line1 || null,
    postcode: addr.postcode || null,
    city: addr.city || null,
    dept: addr.dept || null,
    lat: addr.lat || null,
    lon: addr.lon || null,
    contact_website: (s.contact || {}).website || null,
    contact_email_official: null,  // sera rempli plus loin depuis l'xlsx si dispo
    categories: s.categories || [],
    flags: s.flags || {},
    stats: s.stats || {},
    updated_at: new Date().toISOString(),
  }
}

async function main() {
  console.log('Lecture', DATA)
  const raw = JSON.parse(fs.readFileSync(DATA, 'utf8'))
  console.log(`${raw.length} fiches à importer`)

  const rows = raw.map(pick)
  const BATCH = 500
  let done = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const { error } = await SB.from('fiches').upsert(chunk, { onConflict: 'id' })
    if (error) {
      console.error('erreur upsert batch', i, error.message)
      process.exit(1)
    }
    done += chunk.length
    process.stdout.write(`\r  upsert ${done}/${rows.length}`)
  }
  console.log('\nOK. Sans emails officiels pour l\'instant — les patcher avec :')
  console.log('  node backend/scripts/import-emails.js')
}

main().catch(e => { console.error(e); process.exit(1) })
