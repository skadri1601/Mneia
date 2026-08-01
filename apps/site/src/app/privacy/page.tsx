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
import { PRIVACY, REVIEW_NOTICE } from '@/content/legal';
import { breadcrumbSchema, webPageSchema } from '@/lib/schema';
import { pageMetadata } from '@/lib/site';

export const metadata = pageMetadata('/privacy');

export default function PrivacyPage() {
  return (
    <>
      <JsonLd nodes={[webPageSchema('/privacy'), breadcrumbSchema('/privacy')]} />

      <Tile surface="canvas">
        <Rise step={0}>
          <p className={prose.eyebrow}>Legal</p>
        </Rise>
        <Rise step={1}>
          <h1 className={prose.hero}>{PRIVACY.title}</h1>
        </Rise>
        <Rise step={2}>
          <p className={prose.lead}>{PRIVACY.lead}</p>
        </Rise>
        <Rise step={3}>
          <LegalDates doc={PRIVACY} />
        </Rise>
        <Rise step={4}>
          <LegalContents doc={PRIVACY} />
        </Rise>
      </Tile>

      <Tile surface="canvas">
        <LegalBody doc={PRIVACY} />
      </Tile>

      <Tile surface="parchment">
        <LegalReviewNotice text={REVIEW_NOTICE} />
      </Tile>
    </>
  );
}
