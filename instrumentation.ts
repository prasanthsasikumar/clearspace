/**
 * Boot hook. Runs once per server process, before the first request.
 *
 * Migrations run here so a fresh clone works with `npm run dev` alone — there
 * is no database to provision and no setup step to forget. The worker starts
 * here too, which keeps job processing alive without a second process during
 * development.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const [{ env }, { getDb }, { applyMigrations }, { getAppContext }, { startWorker }] =
    await Promise.all([
      import('@/config/env'),
      import('@/db/client'),
      import('@/db/migrate'),
      import('@/server/context'),
      import('@/jobs/worker'),
    ])

  await applyMigrations(getDb(), env.DATABASE_URL ? 'postgres' : 'pglite')
  startWorker(getAppContext())
}
