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
import { REVIEW_NOTICE, TERMS } from '@/content/legal';
import { breadcrumbSchema, webPageSchema } from '@/lib/schema';
import { pageMetadata } from '@/lib/site';

export const metadata = pageMetadata('/terms');

export default function TermsPage() {
  return (
    <>
      <JsonLd nodes={[webPageSchema('/terms'), breadcrumbSchema('/terms')]} />

      <Tile surface="canvas">
        <Rise step={0}>
          <p className={prose.eyebrow}>Legal</p>
        </Rise>
        <Rise step={1}>
          <h1 className={prose.hero}>{TERMS.title}</h1>
        </Rise>
        <Rise step={2}>
          <p className={prose.lead}>{TERMS.lead}</p>
        </Rise>
        <Rise step={3}>
          <LegalDates doc={TERMS} />
        </Rise>
        <Rise step={4}>
          <LegalContents doc={TERMS} />
        </Rise>
      </Tile>

      <Tile surface="canvas">
        <LegalBody doc={TERMS} />
      </Tile>

      <Tile surface="parchment">
        <LegalReviewNotice text={REVIEW_NOTICE} />
      </Tile>
    </>
  );
}
