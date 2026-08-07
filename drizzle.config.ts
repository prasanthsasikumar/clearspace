import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  // Migrations are generated statically; applying them is done by
  // scripts/migrate.ts, which knows how to reach either PGlite or Neon.
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/clearspace',
  },
})
