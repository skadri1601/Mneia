'use client';

import Script from 'next/script';
import {
  GA4_MEASUREMENT_ID,
  GOOGLE_ADS_ID,
  GOOGLE_TAG_ID,
  HAS_GOOGLE_TAGS,
  HAS_META_PIXEL,
  META_PIXEL_ID,
} from '@/lib/tags';
import { useConsent } from './ConsentProvider';

const CONSENT_DEFAULTS = `
window.dataLayer = window.dataLayer || [];
function gtag(){window.dataLayer.push(arguments);}
window.gtag = gtag;
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
  wait_for_update: 500
});
`;

function googleConfig(): string {
  const lines = ["gtag('js', new Date());"];
  if (GA4_MEASUREMENT_ID) {
    lines.push(`gtag('config', '${GA4_MEASUREMENT_ID}');`);
  }
  if (GOOGLE_ADS_ID) {
    lines.push(`gtag('config', '${GOOGLE_ADS_ID}');`);
  }
  return lines.join('\n');
}

function metaPixel(limitedDataUse: boolean): string {
  return `
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('dataProcessingOptions', ${limitedDataUse ? "['LDU'], 0, 0" : '[]'});
fbq('init', '${META_PIXEL_ID}');
fbq('track', 'PageView');
`;
}

export function ConsentDefaults() {
  return (
    <Script id="consent-defaults" strategy="beforeInteractive">
      {CONSENT_DEFAULTS}
    </Script>
  );
}

export function Tags() {
  const { ready, categories, limitedDataUse } = useConsent();

  if (!ready) {
    return null;
  }

  const google = HAS_GOOGLE_TAGS && (categories.analytics || categories.advertising);
  const meta = HAS_META_PIXEL && categories.advertising;

  return (
    <>
      {google ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_TAG_ID}`}
            strategy="afterInteractive"
          />
          <Script id="google-tag-config" strategy="afterInteractive">
            {googleConfig()}
          </Script>
        </>
      ) : null}

      {meta ? (
        <Script id="meta-pixel" strategy="afterInteractive">
          {metaPixel(limitedDataUse)}
        </Script>
      ) : null}
    </>
  );
}
