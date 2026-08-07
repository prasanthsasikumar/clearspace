import { env } from '../src/config/env'
import { getDb } from '../src/db/client'
import { applyMigrations } from '../src/db/migrate'
import { getBlobStore } from '../src/storage'

/**
 * One-command Supabase setup, safe to re-run.
 *
 * Creates the storage bucket if it is missing, applies migrations, then
 * round-trips a real object through the store. That last step is the point:
 * credentials that authenticate but cannot write are the failure mode here,
 * and finding out during setup beats finding out when a user's first upload
 * silently vanishes.
 */
async function ensureBucket(): Promise<'created' | 'exists'> {
  const base = `${env.SUPABASE_URL!.replace(/\/$/, '')}/storage/v1`
  const headers = {
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY!}`,
    'Content-Type': 'application/json',
  }

  const existing = await fetch(`${base}/bucket/${env.SUPABASE_BUCKET}`, { headers })
  if (existing.ok) return 'exists'
  if (existing.status !== 400 && existing.status !== 404) {
    throw new Error(
      `Could not reach Supabase Storage (${existing.status}). ` +
        `Check SUPABASE_URL and that the key is the service_role key, not anon.`,
    )
  }

  const created = await fetch(`${base}/bucket`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: env.SUPABASE_BUCKET,
      id: env.SUPABASE_BUCKET,
      // Private: photos of the inside of someone's home are not public data,
      // and the app proxies reads through its own route anyway.
      public: false,
      file_size_limit: 26_214_400,
    }),
  })

  if (!created.ok) {
    throw new Error(
      `Could not create bucket "${env.SUPABASE_BUCKET}" (${created.status}): ` +
        `${(await created.text()).slice(0, 200)}`,
    )
  }
  return 'created'
}

async function main() {
  if (env.BLOB_DRIVER !== 'supabase') {
    throw new Error('Set BLOB_DRIVER=supabase in .env.local before running this.')
  }
  console.log(`Bucket "${env.SUPABASE_BUCKET}"…`)
  console.log(`  ${await ensureBucket()}`)

  // Storage and the database are configured independently, so the script does
  // whichever half it has credentials for rather than refusing both.
  if (env.DATABASE_URL) {
    console.log('Applying migrations…')
    await applyMigrations(getDb(), 'postgres')
    console.log('  done')
  } else {
    console.log('Migrations skipped — no DATABASE_URL set yet.')
  }

  console.log('Round-tripping a test object…')
  const blobs = getBlobStore()
  const key = `checks/${crypto.randomUUID()}.txt`
  const payload = Buffer.from('clearspace storage check')
  await blobs.put(key, payload, 'text/plain')
  const read = await blobs.get(key)
  if (!read || !read.data.equals(payload)) {
    throw new Error('Wrote an object but could not read it back identically.')
  }
  await blobs.delete(key)
  console.log('  write, read, delete all OK')

  console.log(
    env.DATABASE_URL
      ? '\nSupabase is ready. Photos and data will persist.'
      : '\nStorage is ready. Add DATABASE_URL and re-run to finish the database.',
  )
  process.exit(0)
}

main().catch((error) => {
  console.error(`\nSetup failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
