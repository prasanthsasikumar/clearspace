import type { ItemStatus } from '@/db/schema'
import { statusLabels } from '@/domain/item-status'

/**
 * Status as a glyph plus a word.
 *
 * The glyph carries the hue and the word carries the meaning, so the chip
 * still reads for the ~8% of men who cannot separate red from green and,
 * more to the point here, for anyone squinting at a phone in a storage unit
 * lit by one bulb. Colour alone was never going to survive that.
 */
const GLYPH: Record<ItemStatus, string> = {
  detected: '○',
  photos_needed: '▲',
  ai_identified: '◆',
  needs_confirmation: '▲',
  confirmed: '●',
  listed: '↗',
  sold: '✓',
  discarded: '×',
}

const TONE: Record<ItemStatus, string> = {
  detected: '',
  photos_needed: 'chip--warn',
  ai_identified: 'chip--attention',
  needs_confirmation: 'chip--warn',
  confirmed: 'chip--ok',
  listed: 'chip--ok',
  sold: 'chip--done',
  discarded: 'chip--muted',
}

/**
 * `glyphOnly` is for the 320px rail, where the word would push the item's
 * title out of its own row. The meaning is not thrown away: it moves into the
 * accessible name, so the chip still says "needs confirmation" to a screen
 * reader and on hover rather than being a coloured shape and nothing else.
 */
export function StatusChip({
  status,
  glyphOnly = false,
}: {
  status: ItemStatus
  glyphOnly?: boolean
}) {
  if (glyphOnly) {
    return (
      <span className={`chip chip--glyph ${TONE[status]}`} title={statusLabels[status]}>
        <span className="chip__glyph" aria-hidden="true">
          {GLYPH[status]}
        </span>
        <span className="visually-hidden">{statusLabels[status]}</span>
      </span>
    )
  }

  return (
    <span className={`chip ${TONE[status]}`}>
      <span className="chip__glyph" aria-hidden="true">
        {GLYPH[status]}
      </span>
      {statusLabels[status]}
    </span>
  )
}
