import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from '../helpers/harness'
import { toIdentity } from '@/auth/supabase'
import { getLocalUser, getOrCreateUser } from '@/services/user'
import { createLot, listLots } from '@/services/lots'

describe('toIdentity', () => {
  it('treats Supabase’s empty-string email as no email at all', () => {
    // Supabase reports an anonymous user's email as '' rather than omitting
    // it. Postgres permits many NULLs in a unique index but only one '', so
    // letting this through means the SECOND anonymous visitor gets a 500.
    const identity = toIdentity({ id: 'a', email: '', is_anonymous: true })
    expect(identity.email).toBeNull()
    expect(identity.isAnonymous).toBe(true)
  })

  it('treats whitespace as no email', () => {
    expect(toIdentity({ id: 'a', email: '   ' }).email).toBeNull()
  })

  it('keeps a real address and marks the account permanent', () => {
    const identity = toIdentity({ id: 'a', email: 'sam@example.com', is_anonymous: false })
    expect(identity.email).toBe('sam@example.com')
    expect(identity.isAnonymous).toBe(false)
  })

  it('infers anonymity when the claim is missing', () => {
    expect(toIdentity({ id: 'a' }).isAnonymous).toBe(true)
    expect(toIdentity({ id: 'a', email: 'sam@example.com' }).isAnonymous).toBe(false)
  })
})

describe('identities in the database', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  afterEach(async () => {
    await harness.close()
  })

  const anon = (id: string) => toIdentity({ id, email: '', is_anonymous: true })

  it('lets many anonymous visitors coexist', async () => {
    const a = await getOrCreateUser(harness.db, anon(crypto.randomUUID()))
    const b = await getOrCreateUser(harness.db, anon(crypto.randomUUID()))
    const c = await getOrCreateUser(harness.db, anon(crypto.randomUUID()))

    expect(new Set([a.id, b.id, c.id]).size).toBe(3)
    for (const user of [a, b, c]) {
      expect(user.email).toBeNull()
      expect(user.isAnonymous).toBe(true)
    }
  })

  it('is idempotent for a returning visitor', async () => {
    const id = crypto.randomUUID()
    const first = await getOrCreateUser(harness.db, anon(id))
    const second = await getOrCreateUser(harness.db, anon(id))
    expect(second.id).toBe(first.id)
  })

  it('upgrades an anonymous account in place, keeping its work', async () => {
    const id = crypto.randomUUID()
    const before = await getOrCreateUser(harness.db, anon(id))
    await createLot(harness.db, before.id, { name: 'Unit 41', kind: 'storage_unit' })

    // What signing in does: same Supabase id, now with an address.
    const after = await getOrCreateUser(
      harness.db,
      toIdentity({ id, email: 'sam@example.com', is_anonymous: false }),
    )

    expect(after.id).toBe(before.id)
    expect(after.email).toBe('sam@example.com')
    expect(after.isAnonymous).toBe(false)

    // The lot they photographed before signing in is still theirs.
    const lots = await listLots(harness.db, after.id)
    expect(lots.map((l) => l.name)).toEqual(['Unit 41'])
  })

  it('keeps one visitor’s lots out of another’s list', async () => {
    const mine = await getOrCreateUser(harness.db, anon(crypto.randomUUID()))
    const theirs = await getOrCreateUser(harness.db, anon(crypto.randomUUID()))

    await createLot(harness.db, mine.id, { name: 'My garage', kind: 'garage' })

    expect(await listLots(harness.db, theirs.id)).toHaveLength(0)
    expect(await listLots(harness.db, mine.id)).toHaveLength(1)
  })

  it('does not collide with the no-auth local user', async () => {
    const local = await getLocalUser(harness.db)
    const visitor = await getOrCreateUser(harness.db, anon(crypto.randomUUID()))
    expect(visitor.id).not.toBe(local.id)
  })
})
