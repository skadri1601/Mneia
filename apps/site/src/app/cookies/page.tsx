import { CookiePreferencesPanel } from '@/components/CookiePreferences';
import { JsonLd } from '@/components/JsonLd';
import {
  LegalBody,
  LegalContents,
  LegalDates,
  LegalReviewNotice,
} from '@/components/LegalDocument';
import prose from '@/components/Prose.module.css';
import { Rise } from '@/components/Reveal';
import { Tile } from '@/components/Tile';
import { COOKIES, REVIEW_NOTICE } from '@/content/legal';
import { breadcrumbSchema, webPageSchema } from '@/lib/schema';
import { pageMetadata } from '@/lib/site';

export const metadata = pageMetadata('/cookies');

export default function CookiesPage() {
  return (
    <>
      <JsonLd nodes={[webPageSchema('/cookies'), breadcrumbSchema('/cookies')]} />

      <Tile surface="canvas">
        <Rise step={0}>
          <p className={prose.eyebrow}>Legal</p>
        </Rise>
        <Rise step={1}>
          <h1 className={prose.hero}>{COOKIES.title}</h1>
        </Rise>
        <Rise step={2}>
          <p className={prose.lead}>{COOKIES.lead}</p>
        </Rise>
        <Rise step={3}>
          <LegalDates doc={COOKIES} />
        </Rise>
        <Rise step={4}>
          <LegalContents doc={COOKIES} />
        </Rise>
      </Tile>

      <Tile surface="parchment">
        <CookiePreferencesPanel />
      </Tile>

      <Tile surface="canvas">
        <LegalBody doc={COOKIES} />
      </Tile>

      <Tile surface="parchment">
        <LegalReviewNotice text={REVIEW_NOTICE} />
      </Tile>
    </>
  );
}
