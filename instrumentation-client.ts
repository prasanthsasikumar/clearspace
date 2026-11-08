import posthog from 'posthog-js'

/*
 * PostHog, cookieless: no cookies or browser storage, no person profiles, so
 * the app needs no consent banner. Production only, so local sessions never
 * land in the numbers. The marketing page carries its own copy, injected at
 * build time by marketing/build.mjs, against the same project.
 */
if (process.env.NODE_ENV === 'production') {
  posthog.init('phc_Dpf2jxsea6e9eukisrHaRe5C7gosREy4bvCzzeFriv73', {
    api_host: 'https://us.i.posthog.com',
    ui_host: 'https://us.posthog.com',
    defaults: '2025-05-24',
    cookieless_mode: 'always',
    person_profiles: 'never',
    capture_pageview: 'history_change',
  })
}
