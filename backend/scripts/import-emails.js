// Patch les emails officiels des fiches depuis auto-ecoles-contacts.xlsx
// (issu du scraping fait plus tôt : étapes 1+2+3A+3B, ~4600 emails).
// Idempotent — met à jour uniquement contact_email_official.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import xlsx from 'xlsx'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const SB = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const XLSX = path.resolve(__dirname, '../../../auto-ecoles-contacts.xlsx')

async function main() {
  console.log('Lecture', XLSX)
  const wb = xlsx.readFile(XLSX)
  const ws = wb.Sheets['Avec email']
  if (!ws) throw new Error('feuille "Avec email" introuvable')
  const rows = xlsx.utils.sheet_to_json(ws)
  console.log(`${rows.length} fiches avec email`)

  const updates = rows
    .filter(r => r.ID && r.Email)
    .map(r => ({ id: String(r.ID), contact_email_official: String(r.Email).split(';')[0].trim().toLowerCase() }))

  // Update ligne par ligne, en parallèle limité à 20 à la fois
  const CONCURRENCY = 20
  let done = 0
  let errors = 0
  async function runOne(row) {
    const { error } = await SB.from('fiches')
      .update({ contact_email_official: row.contact_email_official })
      .eq('id', row.id)
    if (error) {
      errors++
      if (errors < 5) console.error('\nerr', row.id, error.message)
    }
    done++
    if (done % 100 === 0) process.stdout.write(`\r  ${done}/${updates.length} (err: ${errors})`)
  }
  for (let i = 0; i < updates.length; i += CONCURRENCY) {
    await Promise.all(updates.slice(i, i + CONCURRENCY).map(runOne))
  }
  console.log(`\nOK. ${done - errors} mises à jour, ${errors} erreurs.`)
}

main().catch(e => { console.error(e); process.exit(1) })
