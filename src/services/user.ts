import { eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { users, type User } from '@/db/schema'

export type AppUser = User

export const LOCAL_USER_EMAIL = 'local@clearspace.app'

export interface UserIdentity {
  id: string
  email: string | null
  isAnonymous: boolean
}

/**
 * Maps a Supabase identity onto a row here.
 *
 * The id is Supabase's, not one we generate, and that is the whole trick: when
 * an anonymous visitor later adds an email or links Google, Supabase keeps the
 * same user id, so their lots, photos, and listings are already theirs. There
 * is no claim step to get wrong at the exact moment someone decides to commit.
 */
export async function getOrCreateUser(
  db: Database,
  identity: UserIdentity,
): Promise<AppUser> {
  // Normalised again at the database boundary, not only where identities are
  // parsed. An empty email is a uniqueness collision waiting for the second
  // anonymous visitor, and this is the last place to stop it.
  const email = identity.email?.trim() || null

  const [existing] = await db.select().from(users).where(eq(users.id, identity.id)).limit(1)

  if (existing) {
    // An anonymous account that has just gained an email is the upgrade
    // happening; record it rather than leaving the row stale.
    if (existing.email !== email || existing.isAnonymous !== identity.isAnonymous) {
      const [updated] = await db
        .update(users)
        .set({ email, isAnonymous: identity.isAnonymous })
        .where(eq(users.id, identity.id))
        .returning()
      return updated ?? existing
    }
    return existing
  }

  const [created] = await db
    .insert(users)
    .values({
      id: identity.id,
      email,
      isAnonymous: identity.isAnonymous,
    })
    .onConflictDoNothing({ target: users.id })
    .returning()

  if (created) return created

  const [raced] = await db.select().from(users).where(eq(users.id, identity.id)).limit(1)
  if (!raced) throw new Error('Could not resolve the signed-in user')
  return raced
}

/**
 * The single implicit user for runs with no auth configured — local
 * development, the seed script, and the test suite. A fresh clone should be
 * fully usable before anyone signs up for anything.
 */
export async function getLocalUser(db: Database): Promise<AppUser> {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, LOCAL_USER_EMAIL))
    .limit(1)

  if (existing) return existing

  const [created] = await db
    .insert(users)
    .values({ email: LOCAL_USER_EMAIL, displayName: 'You', isAnonymous: false })
    .onConflictDoNothing({ target: users.email })
    .returning()

  if (created) return created

  const [raced] = await db
    .select()
    .from(users)
    .where(eq(users.email, LOCAL_USER_EMAIL))
    .limit(1)

  if (!raced) throw new Error('Could not resolve the local user')
  return raced
}

/** Kept for the seed script and tests, which have no HTTP session. */
export const getCurrentUser = getLocalUser
