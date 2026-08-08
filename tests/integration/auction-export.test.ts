import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { items, lots, users } from '@/db/schema'
import { createHarness, type Harness } from '../helpers/harness'

let harness: Harness

afterEach(async () => {
  await harness?.close()
})

describe('auction schema', () => {
  it('stores a lot number and a reserve, and defaults both to null', async () => {
    harness = await createHarness()
    const { db } = harness

    const [user] = await db.insert(users).values({ isAnonymous: true }).returning()
    const [lot] = await db
      .insert(lots)
      .values({ userId: user!.id, name: 'Ashfield estate', kind: 'estate' })
      .returning()

    const [plain] = await db
      .insert(items)
      .values({ lotId: lot!.id, title: 'Walnut sideboard' })
      .returning()

    expect(plain!.lotNumber).toBeNull()
    expect(plain!.reserveCents).toBeNull()

    await db
      .update(items)
      .set({ lotNumber: 12, reserveCents: 15000 })
      .where(eq(items.id, plain!.id))

    const [updated] = await db.select().from(items).where(eq(items.id, plain!.id))
    expect(updated!.lotNumber).toBe(12)
    expect(updated!.reserveCents).toBe(15000)
  })
})
