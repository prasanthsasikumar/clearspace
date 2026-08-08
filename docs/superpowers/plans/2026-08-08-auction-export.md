# Auction Export Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a catalogued lot into a single ZIP an estate auctioneer can upload to HiBid: a lot CSV plus the numbered photos it references.

**Architecture:** Three new pure-domain units (lot numbering, the auction CSV formatter, auction export readiness) sitting on the existing `csv.ts` writer, assembled by one new service function that also fetches photo bytes and packs everything into one archive. The stored-entry ZIP writer currently private inside `src/lib/xlsx.ts` is extracted so both the workbook and the photo bundle share it. Nothing in capture, detection, grouping, or enrichment is touched.

**Tech Stack:** TypeScript, Next.js 16 App Router, Drizzle ORM, PGlite/Postgres, Vitest, zero new dependencies.

## Global Constraints

- **No new npm dependencies.** This codebase hand-rolled an XLSX writer rather than take one (`src/lib/xlsx.ts`, see its header comment). A ZIP library is not to be added; the existing writer is extracted and reused.
- **Never invent an estimate.** An item with no `valuations` row is skipped with a stated reason. Do not synthesise a range by applying a spread to `items.estimatedValueCents`.
- **Never model-generate a reserve.** `reserveCents` is set by a person or left null.
- **Path alias is `@/`** → `src/`. Note `app/` is a sibling of `src/`, not inside it.
- **Exports report what they could not carry** via the existing `skipped` / `warnings` shape used by `src/domain/export/facebook.ts` and `marketplace.ts`. Never emit a blank where the destination requires a value.
- **`AUCTION_COLUMNS` header names are provisional.** See the warning below.
- Test command is `npm test` (Vitest, `vitest run`). Type check with `npm run typecheck`.

## ⚠️ Before any of this output is sent to a real auction house

`AUCTION_COLUMNS` in Task 3 is a **best-effort field set, not a verified HiBid / Auction Flex header row.** The spec requires the formatter be written against a real import template, and no such template was available when this plan was written.

The column list is deliberately isolated in one exported constant with one mapping function beside it, so reconciling it against the real template is a single-file change and the tests around numbering, skipping, and packaging stay valid. **Do not send a generated file to a firm before that reconciliation.** This does not block any task here; the calibration gate and internal testing run fine on provisional headers.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/zip.ts` | **Create.** Stored-entry ZIP writer, extracted from `xlsx.ts`. |
| `src/lib/xlsx.ts` | **Modify.** Import `zip` instead of defining it. |
| `src/db/schema.ts` | **Modify.** `items.lotNumber`, `items.reserveCents`, `auction` in the `marketplace` enum. |
| `drizzle/0004_auction.sql` | **Create** (generated). |
| `src/domain/export/lot-numbers.ts` | **Create.** Pure lot-number assignment. |
| `src/domain/export/auction.ts` | **Create.** Pure auction CSV formatter. |
| `src/domain/export-readiness.ts` | **Modify.** Add `auctionReadiness`. |
| `src/services/exports.ts` | **Modify.** Add `buildLotAuctionExport`. |
| `app/api/lots/[lotId]/export/auction/route.ts` | **Create.** GET returning the ZIP. |
| `tests/lib/zip.test.ts` | **Create.** |
| `tests/domain/lot-numbers.test.ts` | **Create.** |
| `tests/domain/auction.test.ts` | **Create.** |
| `tests/integration/auction-export.test.ts` | **Create.** |

**One refinement on the spec.** The spec describes a CSV and a photo ZIP built alongside each other. This plan puts the CSV *inside* the ZIP as `lots.csv`. It serves the spec's stated invariant more directly (a filename in the CSV cannot drift from the archive when they are the same archive) and it makes the download one click instead of two. The invariant test in Task 5 is unchanged in spirit.

---

### Task 1: Extract the ZIP writer

Pure refactor. `src/lib/xlsx.ts` keeps a private stored-entry ZIP writer that the photo bundle needs too. Move it out, unchanged, and prove the workbook bytes did not shift.

**Files:**
- Create: `src/lib/zip.ts`
- Modify: `src/lib/xlsx.ts:86-143` (remove `Entry`, `crc32`, `CRC_TABLE`, `zip`), `src/lib/xlsx.ts:16-32`
- Create: `tests/lib/zip.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `zip(entries: readonly ZipEntry[]): Buffer` and `interface ZipEntry { name: string; data: Buffer }`, both from `@/lib/zip`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/zip.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { zip } from '@/lib/zip'

describe('zip', () => {
  it('writes a local header, a central directory, and an end record', () => {
    const buf = zip([{ name: 'a.txt', data: Buffer.from('hello', 'utf8') }])

    expect(buf.readUInt32LE(0)).toBe(0x04034b50)
    expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50)
    expect(buf.readUInt16LE(buf.length - 22 + 10)).toBe(1)
  })

  it('stores rather than deflates, so entry bytes appear verbatim', () => {
    const buf = zip([{ name: 'a.txt', data: Buffer.from('hello', 'utf8') }])
    expect(buf.includes(Buffer.from('hello', 'utf8'))).toBe(true)
  })

  it('is byte-stable, so the same entries always produce the same file', () => {
    const once = zip([{ name: 'a.txt', data: Buffer.from('x') }])
    const twice = zip([{ name: 'a.txt', data: Buffer.from('x') }])
    expect(once.equals(twice)).toBe(true)
  })

  it('records every entry in the end-of-central-directory count', () => {
    const buf = zip([
      { name: '1_1.jpg', data: Buffer.from([0xff, 0xd8, 0xff]) },
      { name: '1_2.jpg', data: Buffer.from([0xff, 0xd8, 0xfe]) },
      { name: 'lots.csv', data: Buffer.from('a,b\r\n', 'utf8') },
    ])
    expect(buf.readUInt16LE(buf.length - 22 + 10)).toBe(3)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/lib/zip.test.ts`
Expected: FAIL, cannot resolve `@/lib/zip`.

- [ ] **Step 3: Create the extracted module**

Create `src/lib/zip.ts`. The body of `crc32`, `CRC_TABLE`, and `zip` is moved verbatim from `src/lib/xlsx.ts`. Do not rewrite the byte offsets.

```ts
/**
 * A minimal stored-entry ZIP writer.
 *
 * Extracted from the XLSX writer, which needs it because a workbook is a ZIP,
 * and now shared with the auction photo bundle, which needs it because an
 * auctioneer wants one file rather than forty. The reasoning that kept a
 * dependency out still holds: entries are stored rather than deflated, every
 * reader accepts method 0, it removes the only part that would need zlib, and
 * the bundle is JPEGs, which are already compressed.
 */

export interface ZipEntry {
  name: string
  data: Buffer
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Fixed timestamp, so the same entries always produce the same bytes. */
export function zip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const crc = crc32(entry.data)
    const size = entry.data.length

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(0, 8) // method: stored
    local.writeUInt16LE(0, 10) // time
    local.writeUInt16LE(0x21, 12) // date: 1980-01-01, so output is byte-stable
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(size, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, entry.data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(size, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + size
  }

  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([Buffer.concat(locals), centralBuf, end])
}
```

- [ ] **Step 4: Rewire `xlsx.ts`**

In `src/lib/xlsx.ts`, delete the `CRC_TABLE` constant, `crc32`, `interface Entry`, and the `zip` function. Add to the imports at the top of the file:

```ts
import { zip } from './zip'
```

Leave `buildXlsx` and everything else exactly as it is, since it already calls `zip([...])` with `{ name, data }` objects, which is the `ZipEntry` shape.

Update the file's header comment, whose last paragraph now describes code that lives elsewhere. Replace that paragraph with:

```
 * The ZIP container itself is in `./zip`, shared with the auction photo bundle.
```

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, including the pre-existing `tests/lib/xlsx.test.ts`. Those tests passing unchanged is the proof this refactor moved code without altering a byte.

- [ ] **Step 6: Type check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/zip.ts src/lib/xlsx.ts tests/lib/zip.test.ts
git commit -m "Lift the ZIP out of the spreadsheet"
```

---

### Task 2: Schema, lot number, reserve, and the auction destination

**Files:**
- Modify: `src/db/schema.ts:79-85` (the `marketplace` enum), `src/db/schema.ts:159-182` (the `items` table)
- Create: `drizzle/0004_auction.sql` (generated, not hand-written)
- Create: `tests/integration/auction-export.test.ts` (first test only; Task 5 adds to it)

**Interfaces:**
- Consumes: nothing.
- Produces: `items.lotNumber: number | null`, `items.reserveCents: number | null`, and `'auction'` as a valid `marketplace` enum value. The inferred `Item` type gains both fields.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/auction-export.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/integration/auction-export.test.ts`
Expected: FAIL, `lotNumber` does not exist on the items type / column missing.

- [ ] **Step 3: Add the enum value**

In `src/db/schema.ts`, extend the `marketplace` enum. Append rather than reorder, because the values are persisted.

```ts
export const marketplace = pgEnum('marketplace', [
  'facebook',
  'ebay',
  'craigslist',
  'offerup',
  'generic',
  'auction',
])
```

- [ ] **Step 4: Add the two item columns**

In `src/db/schema.ts`, inside the `items` table definition, add these after `priceUnconfirmed`:

```ts
  /**
   * Assigned when an auction export is built, never at detection, and kept
   * once assigned. See docs/superpowers/specs/2026-08-08-clearspace-liquidator-reframe-design.md:
   * the CSV and the photo filenames are generated from one ordering in one
   * pass, and a published catalogue must not renumber when two more items
   * are added to the lot tomorrow.
   */
  lotNumber: integer('lot_number'),
  /**
   * A seller's instruction with legal weight, so it is set by a person or it
   * is absent. Nothing in the enrichment pipeline may write this.
   */
  reserveCents: integer('reserve_cents'),
```

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate`
Expected: creates `drizzle/0004_auction.sql` containing an `ALTER TYPE ... ADD VALUE 'auction'` and two `ALTER TABLE items ADD COLUMN` statements.

Open the generated file and confirm both columns are nullable with no default. Additive and nullable is what makes this migration safe against the deployment colleagues are testing on, which shares this database.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/integration/auction-export.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the whole suite and type check**

Run: `npm test && npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts drizzle/ tests/integration/auction-export.test.ts
git commit -m "Give an item a lot number and a reserve"
```

---

### Task 3: Lot numbering

Pure function, no I/O. Assignment happens over a set the caller has already ordered.

**Files:**
- Create: `src/domain/export/lot-numbers.ts`
- Create: `tests/domain/lot-numbers.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `assignLotNumbers(items: readonly NumberableItem[]): Map<string, number>` and `interface NumberableItem { id: string; lotNumber: number | null }`, from `@/domain/export/lot-numbers`. The returned map is keyed by item id and contains **every** input item, already-numbered ones included.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/lot-numbers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { assignLotNumbers } from '@/domain/export/lot-numbers'

describe('assignLotNumbers', () => {
  it('numbers an unnumbered lot from one, in the order given', () => {
    const result = assignLotNumbers([
      { id: 'a', lotNumber: null },
      { id: 'b', lotNumber: null },
      { id: 'c', lotNumber: null },
    ])

    expect(result.get('a')).toBe(1)
    expect(result.get('b')).toBe(2)
    expect(result.get('c')).toBe(3)
  })

  it('keeps numbers that were already assigned', () => {
    const result = assignLotNumbers([
      { id: 'a', lotNumber: 1 },
      { id: 'b', lotNumber: 2 },
    ])

    expect(result.get('a')).toBe(1)
    expect(result.get('b')).toBe(2)
  })

  it('continues from the highest existing number, so a published catalogue never shifts', () => {
    const result = assignLotNumbers([
      { id: 'a', lotNumber: 1 },
      { id: 'new', lotNumber: null },
      { id: 'c', lotNumber: 40 },
      { id: 'alsoNew', lotNumber: null },
    ])

    expect(result.get('a')).toBe(1)
    expect(result.get('c')).toBe(40)
    expect(result.get('new')).toBe(41)
    expect(result.get('alsoNew')).toBe(42)
  })

  it('returns an entry for every item so callers never read undefined', () => {
    const result = assignLotNumbers([
      { id: 'a', lotNumber: 7 },
      { id: 'b', lotNumber: null },
    ])
    expect(result.size).toBe(2)
  })

  it('handles an empty lot', () => {
    expect(assignLotNumbers([]).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/domain/lot-numbers.test.ts`
Expected: FAIL, cannot resolve `@/domain/export/lot-numbers`.

- [ ] **Step 3: Implement**

Create `src/domain/export/lot-numbers.ts`:

```ts
/**
 * Lot numbers, assigned at export rather than at detection.
 *
 * Two properties matter, and both come from the same rule. The CSV and the
 * photo filenames are produced from one ordering in one pass, so a filename
 * cannot drift away from the row that references it. And a number, once given,
 * is kept: an auctioneer who has published a catalogue and then adds two more
 * items must not find the first forty renumbered underneath them.
 *
 * Ordering is the caller's business. The service passes items in createdAt
 * order; this function only decides who gets which number.
 */

export interface NumberableItem {
  id: string
  lotNumber: number | null
}

/** Keyed by item id, with an entry for every item passed in. */
export function assignLotNumbers(
  items: readonly NumberableItem[],
): Map<string, number> {
  const assigned = new Map<string, number>()

  let next = 0
  for (const item of items) {
    if (item.lotNumber !== null) next = Math.max(next, item.lotNumber)
  }

  for (const item of items) {
    if (item.lotNumber !== null) {
      assigned.set(item.id, item.lotNumber)
      continue
    }
    next += 1
    assigned.set(item.id, next)
  }

  return assigned
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/domain/lot-numbers.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/export/lot-numbers.ts tests/domain/lot-numbers.test.ts
git commit -m "Number the lots once and never again"
```

---

### Task 4: The auction catalogue formatter

Pure function on top of the existing `csv.ts` writer, in the same shape as `facebook.ts`.

**Files:**
- Create: `src/domain/export/auction.ts`
- Create: `tests/domain/auction.test.ts`

**Interfaces:**
- Consumes: `toCsv` from `@/domain/export/csv`; `ItemCondition` from `@/db/schema`.
- Produces, from `@/domain/export/auction`:
  - `AUCTION_COLUMNS: readonly string[]`
  - `interface AuctionItem { id: string; lotNumber: number; title: string; description: string | null; condition: ItemCondition | null; lowCents: number | null; highCents: number | null; reserveCents: number | null; category: string | null; photoFilenames: readonly string[] }`
  - `interface AuctionWarning { itemId: string; field: string; message: string }`
  - `interface AuctionResult { csv: string; rowCount: number; skipped: AuctionWarning[]; warnings: AuctionWarning[] }`
  - `buildAuctionCatalog(items: readonly AuctionItem[]): AuctionResult`

- [ ] **Step 1: Write the failing test**

Create `tests/domain/auction.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { AUCTION_COLUMNS, buildAuctionCatalog, type AuctionItem } from '@/domain/export/auction'

const base: AuctionItem = {
  id: 'item-1',
  lotNumber: 1,
  title: 'Walnut sideboard',
  description: 'Mid-century, four drawers.',
  condition: 'good',
  lowCents: 12000,
  highCents: 18000,
  reserveCents: null,
  category: 'furniture',
  photoFilenames: ['1_1.jpg', '1_2.jpg'],
}

describe('buildAuctionCatalog', () => {
  it('writes a header row and one row per lot', () => {
    const result = buildAuctionCatalog([base])
    const lines = result.csv.trimEnd().split('\r\n')

    expect(lines[0]).toContain(AUCTION_COLUMNS[0]!)
    expect(lines).toHaveLength(2)
    expect(result.rowCount).toBe(1)
  })

  it('carries the estimate range as whole dollars, not cents', () => {
    const result = buildAuctionCatalog([base])
    expect(result.csv).toContain('"120"')
    expect(result.csv).toContain('"180"')
  })

  it('skips an item with no estimate rather than inventing a range', () => {
    const result = buildAuctionCatalog([
      { ...base, lowCents: null, highCents: null },
    ])

    expect(result.rowCount).toBe(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]!.field).toBe('estimate')
    expect(result.skipped[0]!.message).toContain('Walnut sideboard')
  })

  it('skips an untitled item', () => {
    const result = buildAuctionCatalog([{ ...base, title: '   ' }])
    expect(result.rowCount).toBe(0)
    expect(result.skipped[0]!.field).toBe('title')
  })

  it('leaves the reserve column empty when nobody set one', () => {
    const withReserve = buildAuctionCatalog([{ ...base, reserveCents: 10000 }])
    expect(withReserve.csv).toContain('"100"')

    const without = buildAuctionCatalog([base])
    const cells = without.csv.trimEnd().split('\r\n')[1]!.split(',')
    const reserveIndex = AUCTION_COLUMNS.indexOf('reserve')
    expect(cells[reserveIndex]).toBe('""')
  })

  it('joins photo filenames so the row points at entries in the same archive', () => {
    const result = buildAuctionCatalog([base])
    expect(result.csv).toContain('1_1.jpg|1_2.jpg')
  })

  it('warns when a lot has no photographs, since it will not sell', () => {
    const result = buildAuctionCatalog([{ ...base, photoFilenames: [] }])
    expect(result.rowCount).toBe(1)
    expect(result.warnings[0]!.field).toBe('photos')
  })

  it('escapes the quotes and newlines a description is full of', () => {
    const result = buildAuctionCatalog([
      { ...base, description: 'He said "mint", then\nadded a caveat.' },
    ])
    expect(result.csv).toContain('""mint""')
  })

  it('renders a condition the enum spells with an underscore as words', () => {
    const result = buildAuctionCatalog([{ ...base, condition: 'for_parts' }])
    expect(result.csv).toContain('For parts')
  })

  it('handles an empty lot without producing a headerless file', () => {
    const result = buildAuctionCatalog([])
    expect(result.rowCount).toBe(0)
    expect(result.csv).toContain(AUCTION_COLUMNS[0]!)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/domain/auction.test.ts`
Expected: FAIL, cannot resolve `@/domain/export/auction`.

- [ ] **Step 3: Implement**

Create `src/domain/export/auction.ts`:

```ts
import type { ItemCondition } from '@/db/schema'
import { toCsv } from './csv'

/**
 * A lot catalogue for an online auction platform.
 *
 * The unit here is a lot, not a listing, and the difference runs through every
 * column. A listing has one price a buyer pays; a lot has a range the
 * auctioneer publishes as guidance and a reserve they may not go below. So
 * this file reads the valuation's low and high directly rather than the single
 * recommended figure the Marketplace exports flatten it to.
 *
 * PROVISIONAL HEADERS. These names are a field set, not a verified HiBid /
 * Auction Flex import template. Reconcile them against a real template before
 * a generated file is sent to an auction house. The rest of this module (the
 * skip rules, the dollar conversion, the photo references) is independent of
 * what the columns end up being called, so that reconciliation is a change to
 * the two constants below and nothing else.
 */
export const AUCTION_COLUMNS = [
  'lot',
  'title',
  'description',
  'condition',
  'estimate_low',
  'estimate_high',
  'reserve',
  'category',
  'quantity',
  'photos',
] as const

/** The enum spells these for a database; an auctioneer reads them in a sheet. */
const CONDITION_LABELS: Record<ItemCondition, string> = {
  new: 'New',
  like_new: 'Like new',
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  for_parts: 'For parts',
}

/**
 * Photo filenames in one cell, pipe-separated.
 *
 * A comma would be indistinguishable from a column break to anyone opening
 * the file by eye, which is how most import problems get diagnosed.
 */
const PHOTO_SEPARATOR = '|'

export interface AuctionItem {
  id: string
  lotNumber: number
  title: string
  description: string | null
  condition: ItemCondition | null
  lowCents: number | null
  highCents: number | null
  reserveCents: number | null
  category: string | null
  /** Names of entries in the same archive as this CSV. */
  photoFilenames: readonly string[]
}

export interface AuctionWarning {
  itemId: string
  field: string
  message: string
}

export interface AuctionResult {
  csv: string
  rowCount: number
  skipped: AuctionWarning[]
  warnings: AuctionWarning[]
}

/** Whole dollars. Auction estimates are not quoted to the cent. */
function dollars(cents: number): number {
  return Math.round(cents / 100)
}

/**
 * Builds the catalogue, and reports what it could not carry.
 *
 * An item with no valuation is left out rather than sent with a range derived
 * from the single estimated value by applying some spread. That spread would
 * be invented, and an invented range in an auction catalogue is a number the
 * auctioneer would reasonably believe someone had researched.
 */
export function buildAuctionCatalog(
  items: readonly AuctionItem[],
): AuctionResult {
  const rows: (string | number | null)[][] = []
  const skipped: AuctionWarning[] = []
  const warnings: AuctionWarning[] = []

  for (const item of items) {
    const title = item.title.trim()

    if (!title) {
      skipped.push({
        itemId: item.id,
        field: 'title',
        message: `Lot ${item.lotNumber} has no title, so it was left out.`,
      })
      continue
    }

    if (item.lowCents === null || item.highCents === null) {
      skipped.push({
        itemId: item.id,
        field: 'estimate',
        message: `“${title}” has no estimate yet, so it was left out.`,
      })
      continue
    }

    if (item.condition === null) {
      warnings.push({
        itemId: item.id,
        field: 'condition',
        message: `“${title}” has no condition set.`,
      })
    }

    if (item.photoFilenames.length === 0) {
      warnings.push({
        itemId: item.id,
        field: 'photos',
        message: `“${title}” has no photographs, and an unphotographed lot does not sell.`,
      })
    }

    rows.push([
      item.lotNumber,
      title,
      item.description ?? '',
      item.condition === null ? '' : CONDITION_LABELS[item.condition],
      dollars(item.lowCents),
      dollars(item.highCents),
      item.reserveCents === null ? null : dollars(item.reserveCents),
      item.category ?? '',
      1,
      item.photoFilenames.join(PHOTO_SEPARATOR),
    ])
  }

  return {
    csv: toCsv(AUCTION_COLUMNS, rows),
    rowCount: rows.length,
    skipped,
    warnings,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/domain/auction.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Type check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/domain/export/auction.ts tests/domain/auction.test.ts
git commit -m "Write a catalogue in lots rather than listings"
```

---

### Task 5: Auction export readiness

`exportReadiness` encodes Marketplace's requirements: title, price, condition. The auction file needs an estimate range instead of a price, so the board would otherwise promise an export it cannot keep.

**Files:**
- Modify: `src/domain/export-readiness.ts` (append; do not alter `exportReadiness`)
- Modify: `tests/domain/export-readiness.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `ExportReadiness` and the private `isApproved` helper, both already in the file.
- Produces: `auctionReadiness(item: AuctionReadinessInput): ExportReadiness` and `interface AuctionReadinessInput { status: ItemStatus; title: string | null; lowCents: number | null; highCents: number | null }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/domain/export-readiness.test.ts`. Add `auctionReadiness` to the existing import from `@/domain/export-readiness`, then add:

```ts
describe('auctionReadiness', () => {
  const ready = {
    status: 'confirmed' as const,
    title: 'Walnut sideboard',
    lowCents: 12000,
    highCents: 18000,
  }

  it('is ready when approved, titled, and estimated', () => {
    expect(auctionReadiness(ready)).toEqual({ ready: true, blocker: null })
  })

  it('says nothing about an item nobody has approved yet', () => {
    expect(auctionReadiness({ ...ready, status: 'detected' })).toEqual({
      ready: false,
      blocker: null,
    })
  })

  it('blocks on a missing estimate rather than a missing price', () => {
    expect(auctionReadiness({ ...ready, lowCents: null, highCents: null })).toEqual({
      ready: false,
      blocker: 'Needs an estimate',
    })
  })

  it('blocks on a missing title', () => {
    expect(auctionReadiness({ ...ready, title: '  ' })).toEqual({
      ready: false,
      blocker: 'Needs a title',
    })
  })

  it('does not require a condition, which an auctioneer grades themselves', () => {
    expect(auctionReadiness(ready).ready).toBe(true)
  })

  it('stays quiet about a discarded item', () => {
    expect(auctionReadiness({ ...ready, status: 'discarded' })).toEqual({
      ready: false,
      blocker: null,
    })
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/domain/export-readiness.test.ts`
Expected: FAIL, `auctionReadiness` is not exported.

- [ ] **Step 3: Implement**

Append to `src/domain/export-readiness.ts`:

```ts
export interface AuctionReadinessInput {
  status: ItemStatus
  title: string | null
  lowCents: number | null
  highCents: number | null
}

/**
 * The same question as `exportReadiness`, asked of the auction catalogue.
 *
 * It is a separate function rather than a flag because the requirements
 * genuinely differ: a lot needs a published estimate range where a listing
 * needs one price, and condition is optional here because an auctioneer grades
 * goods themselves and would rather see a blank than the app's guess.
 */
export function auctionReadiness(item: AuctionReadinessInput): ExportReadiness {
  if (item.status === 'discarded') return { ready: false, blocker: null }
  if (!isApproved(item.status)) return { ready: false, blocker: null }

  if (!item.title?.trim()) return { ready: false, blocker: 'Needs a title' }
  if (item.lowCents === null || item.highCents === null) {
    return { ready: false, blocker: 'Needs an estimate' }
  }

  return { ready: true, blocker: null }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/domain/export-readiness.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add src/domain/export-readiness.ts tests/domain/export-readiness.test.ts
git commit -m "Ask readiness the auction's question, not Marketplace's"
```

---

### Task 6: Assemble the bundle

The service function: read the lot, order it, assign and persist numbers, fetch photo bytes, name them, build the CSV, pack one archive.

**Files:**
- Modify: `src/services/exports.ts` (append)
- Modify: `tests/integration/auction-export.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `assignLotNumbers` / `NumberableItem` (Task 3), `buildAuctionCatalog` / `AuctionItem` / `AuctionWarning` (Task 4), `zip` / `ZipEntry` (Task 1), `BlobStore` from `@/storage`, `extensionForMime` from `@/storage`.
- Produces: `buildLotAuctionExport(db: Database, blobs: BlobStore, input: { lotId: string; itemIds?: readonly string[] }): Promise<LotAuctionExport>` where `interface LotAuctionExport { archive: Buffer; filename: string; rowCount: number; skipped: AuctionWarning[]; warnings: AuctionWarning[]; unconfirmedPrices: number }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/auction-export.test.ts`. Extend the top-level imports to include:

```ts
import { itemPhotos, valuations } from '@/db/schema'
import { buildLotAuctionExport } from '@/services/exports'
```

Then add:

```ts
/**
 * Unpacks a stored-entry ZIP by walking its local headers.
 *
 * Reading the entries properly rather than searching the archive as a string
 * is the whole point: entry names appear in the ZIP headers, so a test that
 * stringifies the archive and looks for a filename passes whether or not the
 * CSV ever mentions it.
 */
function readEntries(archive: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>()
  let i = 0

  while (i + 30 <= archive.length && archive.readUInt32LE(i) === 0x04034b50) {
    const size = archive.readUInt32LE(i + 18)
    const nameLength = archive.readUInt16LE(i + 26)
    const extraLength = archive.readUInt16LE(i + 28)
    const name = archive.subarray(i + 30, i + 30 + nameLength).toString('utf8')
    const start = i + 30 + nameLength + extraLength

    entries.set(name, archive.subarray(start, start + size))
    i = start + size
  }

  return entries
}

describe('buildLotAuctionExport', () => {
  async function seedLot() {
    harness = await createHarness()
    const { db, blobs } = harness

    const [user] = await db.insert(users).values({ isAnonymous: true }).returning()
    const [lot] = await db
      .insert(lots)
      .values({ userId: user!.id, name: 'Ashfield estate', kind: 'estate' })
      .returning()

    const [item] = await db
      .insert(items)
      .values({
        lotId: lot!.id,
        title: 'Walnut sideboard',
        condition: 'good',
        status: 'confirmed',
      })
      .returning()

    await db.insert(valuations).values({
      itemId: item!.id,
      conditionTier: 'good',
      lowCents: 12000,
      highCents: 18000,
      recommendedCents: 15000,
      method: 'test',
    })

    await blobs.put('items/test/a.jpg', Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')
    await db.insert(itemPhotos).values({
      itemId: item!.id,
      blobKey: 'items/test/a.jpg',
      isPrimary: true,
    })

    return { db, blobs, lot: lot!, item: item! }
  }

  it('every photo the CSV names is in the archive, and every photo in the archive is named', async () => {
    const { db, blobs, lot } = await seedLot()

    const result = await buildLotAuctionExport(db, blobs, { lotId: lot.id })
    const entries = readEntries(result.archive)

    const csvBytes = entries.get('lots.csv')
    expect(csvBytes).toBeDefined()
    const csv = csvBytes!.toString('utf8')

    const photoNames = [...entries.keys()].filter((n) => n !== 'lots.csv')
    expect(photoNames.length).toBeGreaterThan(0)

    // Both directions. One alone leaves the other failure mode open.
    const namedInCsv = new Set(
      [...csv.matchAll(/[0-9]+_[0-9]+\.[a-z]+/g)].map((m) => m[0]),
    )
    expect([...namedInCsv].sort()).toEqual([...photoNames].sort())
  })

  it('names photos by lot number so a filename identifies its row', async () => {
    const { db, blobs, lot } = await seedLot()

    const result = await buildLotAuctionExport(db, blobs, { lotId: lot.id })
    expect([...readEntries(result.archive).keys()]).toContain('1_1.jpg')
  })

  it('does not ship photographs belonging to a lot the CSV left out', async () => {
    const { db, blobs, lot } = await seedLot()

    // Confirmed and photographed, but never estimated, so it cannot be a row.
    const [orphan] = await db
      .insert(items)
      .values({ lotId: lot.id, title: 'Unestimated bureau', status: 'confirmed' })
      .returning()

    await blobs.put('items/test/b.jpg', Buffer.from([0xff, 0xd8, 0xfe]), 'image/jpeg')
    await db
      .insert(itemPhotos)
      .values({ itemId: orphan!.id, blobKey: 'items/test/b.jpg', isPrimary: true })

    const result = await buildLotAuctionExport(db, blobs, { lotId: lot.id })
    const photoNames = [...readEntries(result.archive).keys()].filter((n) => n !== 'lots.csv')

    expect(result.rowCount).toBe(1)
    expect(photoNames).toEqual(['1_1.jpg'])
  })

  it('persists the lot number, so a second export does not renumber', async () => {
    const { db, blobs, lot, item } = await seedLot()

    await buildLotAuctionExport(db, blobs, { lotId: lot.id })
    const [first] = await db.select().from(items).where(eq(items.id, item.id))
    expect(first!.lotNumber).toBe(1)

    await buildLotAuctionExport(db, blobs, { lotId: lot.id })
    const [second] = await db.select().from(items).where(eq(items.id, item.id))
    expect(second!.lotNumber).toBe(1)
  })

  it('leaves an unestimated item out and says so', async () => {
    const { db, blobs, lot } = await seedLot()

    await db.insert(items).values({
      lotId: lot.id,
      title: 'Box of assorted linen',
      status: 'confirmed',
    })

    const result = await buildLotAuctionExport(db, blobs, { lotId: lot.id })
    expect(result.rowCount).toBe(1)
    expect(result.skipped.some((s) => s.field === 'estimate')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/integration/auction-export.test.ts`
Expected: FAIL, `buildLotAuctionExport` is not exported.

- [ ] **Step 3: Implement**

Add to the imports at the top of `src/services/exports.ts`:

```ts
import { asc } from 'drizzle-orm'
import { itemPhotos, items, listings, valuations } from '@/db/schema'
import { buildAuctionCatalog, type AuctionItem, type AuctionWarning } from '@/domain/export/auction'
import { assignLotNumbers } from '@/domain/export/lot-numbers'
import { zip, type ZipEntry } from '@/lib/zip'
import { extensionForMime, type BlobStore } from '@/storage'
```

Note the existing import of `{ itemPhotos, items, listings }` from `@/db/schema` must be extended with `valuations` rather than duplicated, and `{ and, desc, eq, inArray, ne }` from `drizzle-orm` extended with `asc`.

Append to the file:

```ts
export interface LotAuctionExport {
  /** One ZIP holding lots.csv and every photo it references. */
  archive: Buffer
  filename: string
  rowCount: number
  skipped: AuctionWarning[]
  warnings: AuctionWarning[]
  unconfirmedPrices: number
}

/**
 * Builds one archive an auctioneer can upload: the lot catalogue and its
 * photographs, named to match.
 *
 * They are packed together rather than downloaded separately because the
 * failure this design exists to prevent is a filename in a row pointing at a
 * photograph that is not there, and that failure is discovered by the
 * recipient, mid-upload, not by us. Generating both from a single ordering
 * pass into a single archive makes the disagreement unrepresentable.
 */
export async function buildLotAuctionExport(
  db: Database,
  blobs: BlobStore,
  input: { lotId: string; itemIds?: readonly string[] },
): Promise<LotAuctionExport> {
  const filename = 'clearspace-auction.zip'

  // createdAt order is the ordering the whole export is built from. Reordering
  // lots is deliberately not supported here; auctioneers do it in Auction Flex.
  const rows = await db
    .select()
    .from(items)
    .where(
      input.itemIds && input.itemIds.length > 0
        ? and(eq(items.lotId, input.lotId), inArray(items.id, [...input.itemIds]))
        : and(eq(items.lotId, input.lotId), ne(items.status, 'discarded')),
    )
    .orderBy(asc(items.createdAt))

  const live = rows.filter((item) => item.status !== 'discarded')

  if (live.length === 0) {
    const empty = buildAuctionCatalog([])
    return {
      archive: zip([{ name: 'lots.csv', data: Buffer.from(empty.csv, 'utf8') }]),
      filename,
      rowCount: 0,
      skipped: [],
      warnings: [],
      unconfirmedPrices: 0,
    }
  }

  const ids = live.map((item) => item.id)
  const numbers = assignLotNumbers(live)

  const [photos, drafts, prices] = await Promise.all([
    db
      .select()
      .from(itemPhotos)
      .where(inArray(itemPhotos.itemId, ids))
      .orderBy(desc(itemPhotos.isPrimary)),
    db.select().from(listings).where(inArray(listings.itemId, ids)).orderBy(desc(listings.createdAt)),
    db.select().from(valuations).where(inArray(valuations.itemId, ids)).orderBy(desc(valuations.createdAt)),
  ])

  // Newest wins for both, matching the rule the other exports already follow.
  const listingByItem = new Map<string, (typeof drafts)[number]>()
  for (const draft of drafts) {
    if (!listingByItem.has(draft.itemId)) listingByItem.set(draft.itemId, draft)
  }
  const valuationByItem = new Map<string, (typeof prices)[number]>()
  for (const price of prices) {
    if (!valuationByItem.has(price.itemId)) valuationByItem.set(price.itemId, price)
  }

  const photosByItem = new Map<string, (typeof photos)[number][]>()
  for (const photo of photos) {
    const bucket = photosByItem.get(photo.itemId) ?? []
    bucket.push(photo)
    photosByItem.set(photo.itemId, bucket)
  }

  // One pass: fetch the bytes, name the entry, and keep both against the item,
  // so deciding what to pack later is a lookup rather than a guess from the
  // shape of a filename.
  const entriesByItem = new Map<string, ZipEntry[]>()

  for (const item of live) {
    const lotNumber = numbers.get(item.id)!
    const itemEntries: ZipEntry[] = []

    for (const photo of photosByItem.get(item.id) ?? []) {
      const blob = await blobs.get(photo.blobKey)
      // A photo row whose blob has gone is skipped rather than named, because
      // naming it would put a filename in the CSV with nothing behind it.
      if (!blob) continue

      const name = `${lotNumber}_${itemEntries.length + 1}.${extensionForMime(blob.contentType)}`
      itemEntries.push({ name, data: blob.data })
    }

    entriesByItem.set(item.id, itemEntries)
  }

  const catalogItems: AuctionItem[] = live.map((item) => {
    const draft = listingByItem.get(item.id)
    const valuation = valuationByItem.get(item.id)
    return {
      id: item.id,
      lotNumber: numbers.get(item.id)!,
      title: draft?.title ?? item.title,
      description: draft?.description ?? item.userNotes,
      condition: item.condition,
      lowCents: valuation?.lowCents ?? null,
      highCents: valuation?.highCents ?? null,
      reserveCents: item.reserveCents,
      category: item.category,
      photoFilenames: (entriesByItem.get(item.id) ?? []).map((e) => e.name),
    }
  })

  const catalog = buildAuctionCatalog(catalogItems)

  // Persist only after the catalogue is built, so a formatter that throws
  // leaves no numbers behind to constrain the next attempt.
  const skippedIds = new Set(catalog.skipped.map((s) => s.itemId))
  await Promise.all(
    live
      .filter((item) => item.lotNumber === null && !skippedIds.has(item.id))
      .map((item) =>
        db
          .update(items)
          .set({ lotNumber: numbers.get(item.id)!, updatedAt: new Date() })
          .where(eq(items.id, item.id)),
      ),
  )

  // Only the photographs of lots that actually became rows. Shipping the rest
  // would put files in the archive that nothing references, which reads to the
  // recipient as an export that lost their data.
  const packed = live
    .filter((item) => !skippedIds.has(item.id))
    .flatMap((item) => entriesByItem.get(item.id) ?? [])

  return {
    archive: zip([
      { name: 'lots.csv', data: Buffer.from(catalog.csv, 'utf8') },
      ...packed,
    ]),
    filename,
    rowCount: catalog.rowCount,
    skipped: catalog.skipped,
    warnings: catalog.warnings,
    unconfirmedPrices: live.filter(
      (item) => item.priceUnconfirmed && valuationByItem.has(item.id),
    ).length,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/auction-export.test.ts`
Expected: PASS, 6 tests (the schema test from Task 2 plus the five here).

- [ ] **Step 5: Run the whole suite and type check**

Run: `npm test && npm run typecheck`
Expected: PASS, no errors. The pre-existing Facebook and Marketplace export tests must be untouched and green.

- [ ] **Step 6: Commit**

```bash
git add src/services/exports.ts tests/integration/auction-export.test.ts
git commit -m "Pack the catalogue and its photographs into one file"
```

---

### Task 7: The download route

**Files:**
- Create: `app/api/lots/[lotId]/export/auction/route.ts`
- Modify: `tests/integration/auction-export.test.ts` (append one test)

**Interfaces:**
- Consumes: `buildLotAuctionExport` (Task 6); `route` and `fail` from `@/server/api`; `getAppContext` from `@/server/context`; `requireSessionUser` from `@/server/auth`; `getLot` from `@/services/lots`.
- Produces: `GET /api/lots/:lotId/export/auction` → `application/zip`.

- [ ] **Step 1: Write the ownership-guard test**

Not a red-then-green step: this asserts an existing guarantee the route is about to depend on, so it should pass immediately. Append to `tests/integration/auction-export.test.ts`:

```ts
describe('the auction export route', () => {
  it('refuses a lot belonging to someone else', async () => {
    harness = await createHarness()
    const { db } = harness

    const [mine] = await db.insert(users).values({ isAnonymous: true }).returning()
    const [theirs] = await db.insert(users).values({ isAnonymous: true }).returning()
    const [lot] = await db
      .insert(lots)
      .values({ userId: theirs!.id, name: 'Not yours', kind: 'estate' })
      .returning()

    const { getLot } = await import('@/services/lots')
    expect(await getLot(db, mine!.id, lot!.id)).toBeFalsy()
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/integration/auction-export.test.ts`
Expected: PASS. If it fails, **stop**. The route's security model is not what this plan assumes, and `getLot` scoping must be resolved before any handler is written on top of it.

- [ ] **Step 3: Write the route**

Create `app/api/lots/[lotId]/export/auction/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { fail, route } from '@/server/api'
import { getAppContext } from '@/server/context'
import { getLot } from '@/services/lots'
import { requireSessionUser } from '@/server/auth'
import { buildLotAuctionExport } from '@/services/exports'

type Params = { params: Promise<{ lotId: string }> }

/**
 * Downloads the auction bundle: one ZIP holding lots.csv and its photographs.
 *
 * Unlike the Facebook feed this needs no origin, because nothing in it is a
 * URL. The photographs are in the archive, which is what makes the file useful
 * on an auctioneer's desktop rather than only on the machine that made it.
 */
export const GET = route(async (_request: NextRequest, { params }: Params) => {
  const { lotId } = await params
  const { db, blobs } = getAppContext()
  const user = await requireSessionUser(db)

  const lot = await getLot(db, user.id, lotId)
  if (!lot) return fail('not_found', 'That lot no longer exists.', 404)

  const result = await buildLotAuctionExport(db, blobs, { lotId: lot.id })

  return new NextResponse(new Uint8Array(result.archive), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'X-Clearspace-Rows': String(result.rowCount),
      'X-Clearspace-Skipped': String(result.skipped.length),
      'X-Clearspace-Unconfirmed': String(result.unconfirmedPrices),
    },
  })
})
```

- [ ] **Step 4: Run the whole suite and type check**

Run: `npm test && npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 5: Build, since a route is only real once Next compiles it**

Run: `npm run build`
Expected: succeeds, and `/api/lots/[lotId]/export/auction` appears in the route list.

- [ ] **Step 6: Commit**

```bash
git add "app/api/lots/[lotId]/export/auction/route.ts" tests/integration/auction-export.test.ts
git commit -m "Hand the whole auction over in one download"
```

---

## Verification

After Task 7, from a clean tree:

```bash
npm test && npm run typecheck && npm run build
```

All three must pass. Then, by hand, the part no test covers:

1. `npm run dev -- -p 3300`, create a lot, upload photos of several objects, let enrichment finish.
2. `curl -sO -J http://localhost:3300/api/lots/<lotId>/export/auction`
3. `unzip -l clearspace-auction.zip`, and every photo named in `lots.csv` is present.
4. Open `lots.csv` in Excel. Confirm the estimate columns read as whole dollars, descriptions with quotes and line breaks survive, and the reserve column is empty rather than zero.

## Not in this plan

- The marketing site (spec Section 2). It gets its own plan once the outreach artifacts exist, because the spec sequences its copy after them.
- Outreach, the target list, and the calibration gate (spec Section 3) are operational, not code.
- Any UI for triggering the auction export. The route is reachable directly, which is enough for the calibration gate and for the first pilots. A button belongs with the site work, when there is a professional surface to put it on.
- Reserve entry UI. The column and the export honour it; nothing sets it yet. Deliberate: it is only worth building once a real auctioneer has asked for it.
- Lot reordering, staff seats, consignor records, multi-platform export. Out of scope per the spec.
