import Script from 'next/script'

/**
 * GA4 with Consent Mode defaulted to denied before `config`, so it sends
 * cookieless pings and the app needs no consent banner. The plain gtag snippet
 * rather than @next/third-parties, because that component calls `config`
 * itself and leaves no place to set the consent default first.
 */
export function GoogleAnalytics({ gaId }: { gaId: string }) {
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} strategy="afterInteractive" />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', {
  analytics_storage: 'denied', ad_storage: 'denied',
  ad_user_data: 'denied', ad_personalization: 'denied'
});
gtag('js', new Date());
gtag('config', '${gaId}');`}
      </Script>
    </>
  )
}
