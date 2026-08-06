import { env } from '../src/config/env'
import { getDb } from '../src/db/client'
import { applyMigrations } from '../src/db/migrate'

async function main() {
  const driver = env.DATABASE_URL ? 'postgres' : 'pglite'
  const target = env.DATABASE_URL ? 'hosted Postgres' : `PGlite at ${env.PGLITE_DIR}`
  console.log(`Applying migrations to ${target}…`)

  await applyMigrations(getDb(), driver)

  console.log('Migrations applied.')
  process.exit(0)
}

main().catch((error) => {
  console.error('Migration failed:', error)
  process.exit(1)
})
