/**
 * RFC 4180 CSV writing.
 *
 * Listing descriptions routinely contain commas, quotes, and newlines, and a
 * feed that breaks on the first apostrophe wastes the whole upload. Quoting is
 * unconditional rather than conditional: it is always valid, and it removes an
 * entire class of "worked on my data" bug.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""'
  return `"${String(value).replace(/"/g, '""')}"`
}

export function csvRow(cells: readonly (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',')
}

export function toCsv(
  columns: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  // CRLF and a UTF-8 BOM: Excel is the tool most sellers will open this in, and
  // without the BOM it mangles anything non-ASCII in a description.
  const body = [csvRow(columns), ...rows.map(csvRow)].join('\r\n')
  return `﻿${body}\r\n`
}
