import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from '../helpers/harness'
import { getOrCreateUser, transferAnonymousWork } from '@/services/user'
import { createLot, listLots } from '@/services/lots'

/**
 * Signing in is a plain sign-in now, so the account someone lands on is
 * whichever one owns the identity, and the work they did before signing in has
 * to be carried across deliberately. These are the rules that carrying obeys.
 */
describe('transferAnonymousWork', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  afterEach(async () => {
    await harness.close()
  })

  async function anonymous(id: string) {
    return getOrCreateUser(harness.db, { id, email: null, isAnonymous: true })
  }

  async function permanent(id: string, email: string) {
    return getOrCreateUser(harness.db, { id, email, isAnonymous: false })
  }

  it('moves every lot, and with it everything hanging off one', async () => {
    const guest = await anonymous('11111111-1111-4111-8111-111111111111')
    const account = await permanent('22222222-2222-4222-8222-222222222222', 'sam@example.com')

    await createLot(harness.db, guest.id, { name: 'Unit 41', kind: 'storage_unit' })
    await createLot(harness.db, guest.id, { name: 'Garage', kind: 'garage' })

    expect(await transferAnonymousWork(harness.db, guest.id, account.id)).toBe(2)

    expect(await listLots(harness.db, account.id)).toHaveLength(2)
    expect(await listLots(harness.db, guest.id)).toHaveLength(0)
  })

  /*
   * The security boundary. A ticket is only ever as trustworthy as the
   * narrowest thing it can be used for, and without this check a valid one
   * naming any id at all would empty a real account into the caller's.
   */
  it('refuses to move work off an account that is not anonymous', async () => {
    const victim = await permanent('33333333-3333-4333-8333-333333333333', 'victim@example.com')
    const attacker = await permanent('44444444-4444-4444-8444-444444444444', 'thief@example.com')

    await createLot(harness.db, victim.id, { name: 'Storage locker', kind: 'storage_unit' })

    expect(await transferAnonymousWork(harness.db, victim.id, attacker.id)).toBe(0)
    expect(await listLots(harness.db, victim.id)).toHaveLength(1)
    expect(await listLots(harness.db, attacker.id)).toHaveLength(0)
  })

  it('does nothing when the source does not exist', async () => {
    const account = await permanent('55555555-5555-4555-8555-555555555555', 'sam@example.com')
    const missing = '66666666-6666-4666-8666-666666666666'
    expect(await transferAnonymousWork(harness.db, missing, account.id)).toBe(0)
  })

  it('does nothing when the target does not exist', async () => {
    const guest = await anonymous('77777777-7777-4777-8777-777777777777')
    await createLot(harness.db, guest.id, { name: 'Unit 41', kind: 'storage_unit' })

    const missing = '88888888-8888-4888-8888-888888888888'
    expect(await transferAnonymousWork(harness.db, guest.id, missing)).toBe(0)
    expect(await listLots(harness.db, guest.id)).toHaveLength(1)
  })

  it('is a no-op when the visitor already is the account', async () => {
    const guest = await anonymous('99999999-9999-4999-8999-999999999999')
    await createLot(harness.db, guest.id, { name: 'Unit 41', kind: 'storage_unit' })
    expect(await transferAnonymousWork(harness.db, guest.id, guest.id)).toBe(0)
    expect(await listLots(harness.db, guest.id)).toHaveLength(1)
  })

  it('is safe to run twice, which is what a double-clicked link amounts to', async () => {
    const guest = await anonymous('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    const account = await permanent('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'sam@example.com')
    await createLot(harness.db, guest.id, { name: 'Unit 41', kind: 'storage_unit' })

    expect(await transferAnonymousWork(harness.db, guest.id, account.id)).toBe(1)
    expect(await transferAnonymousWork(harness.db, guest.id, account.id)).toBe(0)
    expect(await listLots(harness.db, account.id)).toHaveLength(1)
  })
})
