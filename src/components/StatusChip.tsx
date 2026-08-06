import type { ItemStatus } from '@/db/schema'
import { statusLabels } from '@/domain/item-status'

const TONE: Partial<Record<ItemStatus, string>> = {
  photos_needed: 'chip--attention',
  needs_confirmation: 'chip--attention',
  ai_identified: 'chip--warn',
  confirmed: 'chip--ok',
  listed: 'chip--ok',
  sold: 'chip--ok',
}

/**
 * Status is carried by the word first and the colour second. A seller sorting
 * fifty items in bad light should never have to distinguish two shades of
 * chip to know what still needs doing.
 */
export function StatusChip({ status }: { status: ItemStatus }) {
  return <span className={`chip ${TONE[status] ?? ''}`}>{statusLabels[status]}</span>
}
