import { eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { users, type User } from '@/db/schema'

export const DEFAULT_USER_EMAIL = 'local@sorta.app'

/**
 * Phase 1 runs as a single local user.
 *
 * Every query is already scoped by `user_id`, so adding real authentication
 * later means replacing this one function with a session lookup — no other
 * call site changes, and no rows need backfilling.
 */
export async function getCurrentUser(db: Database): Promise<User> {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, DEFAULT_USER_EMAIL))
    .limit(1)

  if (existing) return existing

  const [created] = await db
    .insert(users)
    .values({ email: DEFAULT_USER_EMAIL, displayName: 'You' })
    .onConflictDoNothing({ target: users.email })
    .returning()

  if (created) return created

  // Lost an insert race; the row exists now.
  const [raced] = await db
    .select()
    .from(users)
    .where(eq(users.email, DEFAULT_USER_EMAIL))
    .limit(1)

  if (!raced) throw new Error('Could not resolve the default user')
  return raced
}
