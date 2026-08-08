import sharp, { type OverlayOptions } from 'sharp'

export interface SheetSource {
  itemId: string
  data: Buffer
}

export interface ContactSheet {
  image: Buffer
  mimeType: string
  /** Item ids in tile order: index 0 is the tile printed "1". */
  order: string[]
}

/** Big enough to name a thing, small enough that a lot is one cheap image. */
const TILE = 320
const GAP = 8
const LABEL = 30

/**
 * Every item in a lot, on one numbered page.
 *
 * Enrichment used to be two model calls per item, so a lot of twenty five was
 * fifty calls and several minutes of a person watching a spinner. Almost all
 * of that is spent sending the same instructions over and over with one small
 * picture attached. One sheet asks once.
 *
 * The numbers are burned into the image rather than described in the prompt,
 * because the model has to read them off the thing it is looking at for the
 * answer to be attributable at all. `domain/sheet-results` assumes they will
 * sometimes come back wrong regardless.
 */
export async function buildContactSheet(
  sources: readonly SheetSource[],
): Promise<ContactSheet> {
  if (sources.length === 0) throw new Error('A contact sheet needs at least one tile')

  const cols = Math.min(4, Math.ceil(Math.sqrt(sources.length)))
  const rows = Math.ceil(sources.length / cols)
  const cell = TILE + GAP
  const width = cols * cell + GAP
  const height = rows * (cell + LABEL) + GAP

  const layers: OverlayOptions[] = []
  const order: string[] = []

  for (const [index, source] of sources.entries()) {
    const col = index % cols
    const row = Math.floor(index / cols)
    const left = GAP + col * cell
    const top = GAP + row * (cell + LABEL)

    // Contain, not cover: a crop of a chair squashed into a square stops
    // looking like a chair, and shape is most of what identifies furniture.
    const tile = await sharp(source.data)
      .resize(TILE, TILE, { fit: 'contain', background: '#ffffff' })
      .toBuffer()

    layers.push({ input: tile, left, top })
    layers.push({
      input: Buffer.from(
        `<svg width="${TILE}" height="${LABEL}">
           <text x="4" y="22" font-family="monospace" font-size="22" font-weight="bold"
                 fill="#000">${index + 1}</text>
         </svg>`,
      ),
      left,
      top: top + TILE,
    })
    order.push(source.itemId)
  }

  const image = await sharp({
    create: { width, height, channels: 3, background: '#ffffff' },
  })
    .composite(layers)
    .jpeg({ quality: 82 })
    .toBuffer()

  return { image, mimeType: 'image/jpeg', order }
}

/**
 * How many items may share one sheet.
 *
 * Past this the tiles are too small to identify anything, and the saving is
 * already made: twenty five items becomes two calls instead of fifty.
 */
export const SHEET_LIMIT = 12

export function chunkForSheets<T>(items: readonly T[], size = SHEET_LIMIT): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
