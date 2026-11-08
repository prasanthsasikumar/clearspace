/**
 * Builds the marketing page, twice, for two different jobs.
 *
 * public/site/index.html is what ships. Its fonts and photographs sit beside
 * it as real files with content-hashed names, so a browser fetches them once
 * and reuses them forever, and the HTML itself stays small enough to paint
 * immediately.
 *
 * marketing/preview.fragment.html is for hosting the page somewhere that is
 * not this app. That one keeps everything inlined, because a preview host
 * blocks external requests and there is nowhere to put a sibling file.
 *
 *   node marketing/build.mjs
 *
 * The woff2 files are the latin subsets Next already downloaded for the app,
 * copied out of .next/static/media so the site and the app render in exactly
 * the same metal.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(here, 'page.src.html')
const SITE_DIR = join(here, '..', 'public', 'site')
const OUTPUT = join(SITE_DIR, 'index.html')
const ASSET_DIR = join(SITE_DIR, 'assets')
const PREVIEW = join(here, 'preview.fragment.html')

/** Served from the app's origin, so an absolute path, not a relative one. */
const ASSET_BASE = '/site/assets'
const APP_ORIGIN = 'https://clearspace.auction'

/*
 * Two shapes of reference, because the two asset kinds are cited differently:
 * fonts through CSS `url(...)`, photographs through an HTML `src`.
 */
const ASSETS = [
  { pattern: /url\("(fonts\/[\w.-]+\.woff2)"\)/g, mime: 'font/woff2', wrap: (v) => `url(${v})` },
  { pattern: /src="(photos\/[\w.-]+\.webp)"/g, mime: 'image/webp', wrap: (v) => `src="${v}"` },
]

const source = await readFile(SOURCE, 'utf8')

/** Every distinct asset the page cites, read once. */
const cited = new Map()
for (const { pattern, mime } of ASSETS) {
  for (const [, path] of source.matchAll(pattern)) {
    if (cited.has(path)) continue
    cited.set(path, { bytes: await readFile(join(here, path)), mime })
  }
}

if (cited.size === 0) {
  throw new Error(`No asset references found in ${SOURCE}. Did the url()/src format change?`)
}

// ---------------------------------------------------------------------------
// The shipped page: assets beside it, addressed by content hash.
// ---------------------------------------------------------------------------

/*
 * The hash is what makes a one-year immutable cache safe. Without it, editing
 * a photograph would leave every returning visitor looking at the old one for
 * a year, so the choice would be between fresh content and a useful cache.
 * Naming the file after its bytes gives both: change the photograph, change
 * the URL.
 */
await rm(ASSET_DIR, { recursive: true, force: true })
await mkdir(ASSET_DIR, { recursive: true })

const hashedNames = new Map()
for (const [path, { bytes }] of cited) {
  const base = path.split('/').pop()
  const ext = extname(base)
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 8)
  const name = `${base.slice(0, -ext.length)}.${digest}${ext}`
  await writeFile(join(ASSET_DIR, name), bytes)
  hashedNames.set(path, `${ASSET_BASE}/${name}`)
}

let shipped = source
for (const { pattern, wrap } of ASSETS) {
  shipped = shipped.replace(pattern, (_, path) => wrap(hashedNames.get(path)))
}

/*
 * The display and body faces are asked for before the CSS that needs them has
 * been parsed. The mono face is deliberately left out: it sets labels and
 * figures, none of which are the first thing anyone reads.
 */
const preloads = ['fonts/space-grotesk-latin.woff2', 'fonts/inter-latin.woff2']
  .filter((path) => hashedNames.has(path))
  .map(
    (path) =>
      `<link rel="preload" as="font" type="font/woff2" href="${hashedNames.get(path)}" crossorigin>`,
  )
  .join('\n')

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
/*
 * Both tags run cookieless, so the page needs no consent banner: Consent Mode
 * defaults to denied before `config`, which makes GA send cookieless pings,
 * and PostHog runs with cookieless_mode 'always' and no person profiles.
 */
const GA_ID = process.env.NEXT_PUBLIC_GA_ID
const POSTHOG_KEY = 'phc_Dpf2jxsea6e9eukisrHaRe5C7gosREy4bvCzzeFriv73'
const tag = GA_ID
  ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', {
  analytics_storage: 'denied', ad_storage: 'denied',
  ad_user_data: 'denied', ad_personalization: 'denied'
});
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
<script>
!function(t,e){var o,n,p,r;e.__SV||(window.posthog && window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey canRenderSurveyAsync identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId captureTraceFeedback captureTraceMetric".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
posthog.init('${POSTHOG_KEY}', {
  api_host: 'https://us.i.posthog.com',
  ui_host: 'https://us.posthog.com',
  defaults: '2025-05-24',
  cookieless_mode: 'always',
  person_profiles: 'never',
  capture_pageview: true,
});
</script>`
  : ''

shipped = shipped.replace('</head>', [preloads, tag, '</head>'].filter(Boolean).join('\n'))

await mkdir(dirname(OUTPUT), { recursive: true })
await writeFile(OUTPUT, shipped)

// ---------------------------------------------------------------------------
// The preview fragment: everything inlined, nothing external, no analytics.
// ---------------------------------------------------------------------------

let inlined = source
for (const { pattern, wrap } of ASSETS) {
  inlined = inlined.replace(pattern, (_, path) => {
    const { bytes, mime } = cited.get(path)
    return wrap(`data:${mime};base64,${bytes.toString('base64')}`)
  })
}

if (/url\(["']?(?!data:)[^)]/.test(inlined) || /src="(?!data:)/.test(inlined)) {
  throw new Error('A non-data asset reference survived the inlining pass; refusing to write the preview.')
}

/*
 * Hosts that wrap uploaded markup in their own document skeleton choke on a
 * whole <html> document, and the CTAs are root-relative ("/lots"), correct
 * once the page is served from the app's own origin and useless anywhere
 * else. So the preview is the same bytes with the shell removed and every
 * product link made absolute. It is a preview artefact, never what ships.
 */
const head = inlined.match(/<title>([\s\S]*?)<\/title>/)
const style = inlined.match(/<style>[\s\S]*?<\/style>/)
const body = inlined.match(/<body>([\s\S]*?)<\/body>/)

if (!head || !style || !body) {
  throw new Error('Could not split the page into title / style / body for the preview emit.')
}

const fragment = [
  `<title>${head[1]}</title>`,
  style[0],
  body[1].replace(/href="(\/[\w/-]*)"/g, (_, path) => `href="${APP_ORIGIN}${path}"`),
].join('\n')

// Asserted rather than assumed: a stray tag here would quietly log artifact
// readers as visitors to the real site.
if (/googletagmanager|gtag\(|posthog/.test(fragment)) {
  throw new Error('Analytics leaked into the preview fragment; refusing to write it.')
}

await writeFile(PREVIEW, fragment)

const kb = (bytes) => Math.round(Buffer.byteLength(bytes) / 102.4) / 10
const assetFiles = await readdir(ASSET_DIR)
console.log(`Wrote ${OUTPUT}: ${kb(shipped)} kB + ${assetFiles.length} cacheable assets`)
console.log(`Wrote ${PREVIEW}: ${kb(fragment)} kB (preview only, fully inlined)`)
