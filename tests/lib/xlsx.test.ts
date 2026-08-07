import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildXlsx } from '@/lib/xlsx'

/**
 * A workbook nobody can open is worse than a CSV, so these read the bytes back
 * with a tool that was not involved in writing them. `unzip` knows nothing
 * about this code: if the archive is malformed, it says so.
 */
describe('buildXlsx', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    dirs.length = 0
  })

  function unpack(buffer: Buffer): { list: string; sheet: string } {
    const dir = mkdtempSync(path.join(tmpdir(), 'clearspace-xlsx-'))
    dirs.push(dir)
    const file = path.join(dir, 'book.xlsx')
    writeFileSync(file, buffer)
    // -t tests the archive's integrity, including every CRC.
    const list = execFileSync('unzip', ['-t', file], { encoding: 'utf8' })
    const sheet = execFileSync('unzip', ['-p', file, 'xl/worksheets/sheet1.xml'], {
      encoding: 'utf8',
    })
    return { list, sheet }
  }

  it('produces an archive that passes an integrity check', () => {
    const { list } = unpack(buildXlsx('Sheet', [['TITLE', 'PRICE']]))
    expect(list).toContain('No errors detected')
    expect(list).toContain('[Content_Types].xml')
    expect(list).toContain('xl/worksheets/sheet1.xml')
  })

  it('writes numbers as numbers and text as inline strings', () => {
    const { sheet } = unpack(buildXlsx('Sheet', [['Lounge chair', 140]]))
    expect(sheet).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">Lounge chair')
    expect(sheet).toContain('<c r="B1"><v>140</v></c>')
  })

  it('escapes the characters that would otherwise break the XML', () => {
    const { sheet } = unpack(buildXlsx('Sheet', [['Chairs & "tables" <set>']]))
    expect(sheet).toContain('Chairs &amp; &quot;tables&quot; &lt;set&gt;')
    // The raw ampersand must not survive anywhere in the cell.
    expect(sheet).not.toContain('& "tables"')
  })

  it('skips empty cells instead of emitting hollow ones', () => {
    const { sheet } = unpack(buildXlsx('Sheet', [['A', null, '', 'D']]))
    expect(sheet).toContain('r="A1"')
    expect(sheet).toContain('r="D1"')
    expect(sheet).not.toContain('r="B1"')
    expect(sheet).not.toContain('r="C1"')
  })

  it('strips control characters a phone keyboard can produce', () => {
    const { sheet } = unpack(buildXlsx('Sheet', [['bad\u0000value\u0007here']]))
    expect(sheet).toContain('badvaluehere')
  })

  it('keeps column letters right past Z', () => {
    const row = Array.from({ length: 28 }, (_, i) => `c${i}`)
    const { sheet } = unpack(buildXlsx('Sheet', [row]))
    expect(sheet).toContain('r="Z1"')
    expect(sheet).toContain('r="AA1"')
    expect(sheet).toContain('r="AB1"')
  })

  it('is byte-stable, so the same rows always produce the same file', () => {
    const rows = [['TITLE', 'PRICE'], ['Chair', 140]]
    expect(buildXlsx('Sheet', rows).equals(buildXlsx('Sheet', rows))).toBe(true)
  })
})
