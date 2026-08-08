/**
 * A minimal XLSX writer.
 *
 * Facebook's Marketplace bulk upload takes the template back as XLS/XLSX, not
 * CSV, so the file has to be a real workbook. Everything a spreadsheet library
 * would add beyond that (styles, formulas, charts, shared strings) is weight
 * this app has no use for, and the same reasoning that kept the Supabase SDK
 * and ffmpeg out applies here: four kilobytes of ZIP and XML against a
 * dependency that ships a parser as well as a writer.
 *
 * The ZIP container itself is in `./zip`, shared with the auction photo bundle.
 */

import { zip } from './zip'

export type CellValue = string | number | null

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Excel rejects most control characters outright, and a description typed on a
 * phone can carry them. Tab, newline, and carriage return are the three the
 * format does allow.
 */
function stripIllegal(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

function columnName(index: number): string {
  let name = ''
  let n = index
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name
    n = Math.floor(n / 26) - 1
  }
  return name
}

function sheetXml(rows: readonly (readonly CellValue[])[]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          if (value === null || value === '') return ''
          const ref = `${columnName(c)}${r + 1}`
          if (typeof value === 'number') {
            return `<c r="${ref}"><v>${value}</v></c>`
          }
          // Inline strings rather than a shared-string table: one fewer part
          // to keep in step, and nothing here repeats enough to pay for it.
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(
            stripIllegal(value),
          )}</t></is></c>`
        })
        .join('')
      return `<row r="${r + 1}">${cells}</row>`
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
}

/** One sheet, named, with the rows given. */
export function buildXlsx(sheetName: string, rows: readonly (readonly CellValue[])[]): Buffer {
  const name = escapeXml(sheetName.slice(0, 31))

  return zip([
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
        'utf8',
      ),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
        'utf8',
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        'utf8',
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
        'utf8',
      ),
    },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml(rows), 'utf8') },
  ])
}
