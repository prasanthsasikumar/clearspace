/**
 * Builds the marketing page.
 *
 * The deliverable has to be one file that makes no external requests, which
 * rules out a stylesheet link for the three faces. So the source keeps them
 * as ordinary relative URLs, readable and previewable by opening
 * page.src.html directly, and this script swaps each one for a data URI on
 * the way to public/site/index.html.
 *
 *   node marketing/build.mjs
 *
 * The woff2 files are the latin subsets Next already downloaded for the app,
 * copied out of .next/static/media so the site and the app render in exactly
 * the same metal.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(here, 'page.src.html')
const OUTPUT = join(here, '..', 'public', 'site', 'index.html')

/*
 * Two shapes of reference, because the two asset kinds are cited differently:
 * fonts through CSS `url(...)`, photographs through an HTML `src`.
 */
const ASSETS = [
  { pattern: /url\("(fonts\/[\w.-]+\.woff2)"\)/g, wrap: (uri) => `url(${uri})`, mime: 'font/woff2' },
  { pattern: /src="(photos\/[\w.-]+\.webp)"/g, wrap: (uri) => `src="${uri}"`, mime: 'image/webp' },
]

const source = await readFile(SOURCE, 'utf8')

const inlined = []
let page = source

for (const { pattern, wrap, mime } of ASSETS) {
  for (const [reference, path] of source.matchAll(pattern)) {
    if (page.indexOf(reference) === -1) continue // already replaced (same asset cited twice)
    const bytes = await readFile(join(here, path))
    const uri = `data:${mime};base64,${bytes.toString('base64')}`
    page = page.split(reference).join(wrap(uri))
    inlined.push({ filename: path, kb: Math.round(bytes.length / 102.4) / 10 })
  }
}

if (inlined.length === 0) {
  throw new Error(`No asset references found in ${SOURCE}. Did the url()/src format change?`)
}

// A leftover relative reference would be a silent external request in the
// artifact, which is the one thing the single-file brief rules out.
if (/url\(["']?(?!data:)[^)]/.test(page) || /src="(?!data:)/.test(page)) {
  throw new Error('A non-data asset reference survived the inlining pass; refusing to write the page.')
}

/*
 * Analytics, injected rather than written into the source.
 *
 * The page is a static file served through a rewrite, so it never sees the
 * app's layout and cannot inherit the tag from it. Injecting here keeps the
 * source readable and keeps the ID out of version control. The reason that
 * actually matters: it keeps the tag out of the shareable preview below,
 * which would otherwise log every teammate opening the artifact as a visitor.
 *
 * The click handler exists because the CTA is a same-domain link, which
 * Google's enhanced measurement does not count as an outbound click. Without
 * it there is no way to tell an auctioneer who read the page from one who
 * pressed the button, and that ratio is the only number this page is judged
 * on.
 */
const GA_ID = process.env.NEXT_PUBLIC_GA_ID

if (GA_ID) {
  const tag = `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');
addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('a[href^="/lots"]').forEach(function (link) {
    link.addEventListener('click', function () {
      gtag('event', 'start_app', { link_text: link.textContent.trim() });
    });
  });
});
</script>
</head>`
  page = page.replace('</head>', tag)
}

await mkdir(dirname(OUTPUT), { recursive: true })
await writeFile(OUTPUT, page)

/*
 * A second emit, for previewing the page somewhere that is not this app.
 *
 * Hosts that wrap uploaded markup in their own document skeleton choke on a
 * whole <html> document, and the CTAs are root-relative ("/lots"), correct
 * once the page is served from the app's own origin and useless anywhere else.
 * So this variant is the same bytes with the shell removed and every product
 * link made absolute. It is a preview artefact, never the thing that ships.
 */
const PREVIEW = join(here, 'preview.fragment.html')
const APP_ORIGIN = 'https://clearspace.auction'

const head = page.match(/<title>([\s\S]*?)<\/title>/)
const style = page.match(/<style>[\s\S]*?<\/style>/)
const body = page.match(/<body>([\s\S]*?)<\/body>/)

if (!head || !style || !body) {
  throw new Error('Could not split the page into title / style / body for the preview emit.')
}

const fragment = [
  `<title>${head[1]}</title>`,
  style[0],
  body[1].replace(/href="(\/[\w/-]*)"/g, (_, path) => `href="${APP_ORIGIN}${path}"`),
].join('\n')

// The tag lives in <head>, which the fragment drops by construction. Assert it
// rather than trust it: a stray tag here would quietly log artifact readers as
// visitors to the real site.
if (/googletagmanager|gtag\(/.test(fragment)) {
  throw new Error('Analytics leaked into the preview fragment; refusing to write it.')
}

await writeFile(PREVIEW, fragment)

const kb = (bytes) => Math.round(Buffer.byteLength(bytes) / 102.4) / 10
console.log(`Wrote ${OUTPUT}: ${kb(page)} kB`)
for (const font of inlined) console.log(`  inlined ${font.filename} (${font.kb} kB)`)
console.log(`Wrote ${PREVIEW}: ${kb(fragment)} kB (preview only)`)
