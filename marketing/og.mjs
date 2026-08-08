/**
 * Renders marketing/og.src.html to public/og.png at 1200x630.
 *
 * Kept out of `npm run build` on purpose: it needs a real Chrome, which the
 * deploy image has no reason to carry. The PNG is committed instead, and this
 * script exists so regenerating it is one command rather than an afternoon in
 * a design tool.
 *
 *   node marketing/og.mjs
 */
import { execFile } from 'node:child_process'
import { access, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(here, 'og.src.html')
const OUTPUT = join(here, '..', 'public', 'og.png')

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

async function findChrome() {
  for (const path of CHROME_CANDIDATES) {
    try {
      await access(path)
      return path
    } catch {}
  }
  throw new Error(
    'No Chrome found. Install it, or add its path to CHROME_CANDIDATES in marketing/og.mjs.',
  )
}

const chrome = await findChrome()

await run(chrome, [
  '--headless',
  '--disable-gpu',
  '--hide-scrollbars',
  // The card is a fixed 1200x630; anything else is not an OG image.
  '--window-size=1200,630',
  '--default-background-color=00000000',
  `--screenshot=${OUTPUT}`,
  // Long enough for the three woff2 faces and the photograph to paint.
  '--virtual-time-budget=4000',
  `file://${SOURCE}`,
])

const { size } = await stat(OUTPUT)
console.log(`Wrote ${OUTPUT} - ${Math.round(size / 102.4) / 10} kB`)
