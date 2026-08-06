import { and, count, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { items, lots, type ItemStatus, type Lot, type LotKind } from '@/db/schema'
import { isActionable } from '@/domain/item-status'

export interface LotSummary extends Lot {
  itemCount: number
  actionableCount: number
  statusCounts: Partial<Record<ItemStatus, number>>
}

export interface CreateLotInput {
  name: string
  kind: LotKind
  locationText?: string | null
  notes?: string | null
}

export async function createLot(
  db: Database,
  userId: string,
  input: CreateLotInput,
): Promise<Lot> {
  const [lot] = await db
    .insert(lots)
    .values({
      userId,
      name: input.name.trim(),
      kind: input.kind,
      locationText: input.locationText?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .returning()

  if (!lot) throw new Error('Failed to create lot')
  return lot
}

export async function getLot(
  db: Database,
  userId: string,
  lotId: string,
): Promise<Lot | null> {
  const [lot] = await db
    .select()
    .from(lots)
    .where(and(eq(lots.id, lotId), eq(lots.userId, userId)))
    .limit(1)
  return lot ?? null
}

/**
 * Lists lots with their item counts.
 *
 * The counts come from one grouped query rather than a per-lot count, because
 * the dashboard is the first screen and an N+1 there is felt immediately.
 */
export async function listLots(db: Database, userId: string): Promise<LotSummary[]> {
  const rows = await db
    .select()
    .from(lots)
    .where(and(eq(lots.userId, userId), isNull(lots.archivedAt)))
    .orderBy(desc(lots.updatedAt))

  if (rows.length === 0) return []

  const counts = await db
    .select({ lotId: items.lotId, status: items.status, total: count() })
    .from(items)
    .innerJoin(lots, eq(lots.id, items.lotId))
    .where(eq(lots.userId, userId))
    .groupBy(items.lotId, items.status)

  const byLot = new Map<string, Partial<Record<ItemStatus, number>>>()
  for (const row of counts) {
    const bucket = byLot.get(row.lotId) ?? {}
    bucket[row.status] = row.total
    byLot.set(row.lotId, bucket)
  }

  return rows.map((lot) => {
    const statusCounts = byLot.get(lot.id) ?? {}
    const entries = Object.entries(statusCounts) as Array<[ItemStatus, number]>
    return {
      ...lot,
      statusCounts,
      itemCount: entries
        .filter(([status]) => status !== 'discarded')
        .reduce((sum, [, n]) => sum + n, 0),
      actionableCount: entries
        .filter(([status]) => isActionable(status))
        .reduce((sum, [, n]) => sum + n, 0),
    }
  })
}

export interface UpdateLotInput {
  name?: string
  kind?: LotKind
  locationText?: string | null
  notes?: string | null
  archived?: boolean
}

export async function updateLot(
  db: Database,
  userId: string,
  lotId: string,
  input: UpdateLotInput,
): Promise<Lot | null> {
  const [updated] = await db
    .update(lots)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.locationText !== undefined
        ? { locationText: input.locationText?.trim() || null }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      ...(input.archived !== undefined
        ? { archivedAt: input.archived ? new Date() : null }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(lots.id, lotId), eq(lots.userId, userId)))
    .returning()

  return updated ?? null
}

export async function deleteLot(
  db: Database,
  userId: string,
  lotId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(lots)
    .where(and(eq(lots.id, lotId), eq(lots.userId, userId)))
    .returning({ id: lots.id })
  return deleted.length > 0
}

/** Bumps a lot's `updated_at` so recent activity sorts it to the top. */
export async function touchLot(db: Database, lotId: string): Promise<void> {
  await db.update(lots).set({ updatedAt: sql`now()` }).where(eq(lots.id, lotId))
}
