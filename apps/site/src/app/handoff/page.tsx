import { ButtonPrimary } from '@/components/Button';
import { Card, CardGrid } from '@/components/Card';
import { HandoffArtifact } from '@/components/HandoffArtifact';
import { JsonLd } from '@/components/JsonLd';
import prose from '@/components/Prose.module.css';
import { Rise, RiseOnScroll } from '@/components/Reveal';
import { Rich } from '@/components/RichText';
import { Tile } from '@/components/Tile';
import {
  HANDOFF_CAPTION,
  HANDOFF_INTRO,
  HANDOFF_SECTIONS,
  HANDOFF_SECTIONS_INTRO,
  HANDOFF_THESIS,
  THESIS_QUOTE,
} from '@/content/pages';
import { breadcrumbSchema, webPageSchema } from '@/lib/schema';
import { pageMetadata } from '@/lib/site';
import styles from './page.module.css';

export const metadata = pageMetadata('/handoff');

export default function HandoffPage() {
  return (
    <>
      <JsonLd nodes={[webPageSchema('/handoff'), breadcrumbSchema('/handoff')]} />

      <Tile surface="canvas">
        <Rise step={0}>
          <p className={prose.eyebrow}>{HANDOFF_INTRO.eyebrow}</p>
        </Rise>
        <Rise step={1}>
          <h1 className={prose.hero}>{HANDOFF_INTRO.heading}</h1>
        </Rise>
        <Rise step={2}>
          <p className={prose.lead}>{HANDOFF_INTRO.lead}</p>
        </Rise>
      </Tile>

      <Tile surface="parchment">
        <RiseOnScroll className={styles.artifactWrap}>
          <HandoffArtifact highlightSuperseded />
        </RiseOnScroll>
        <p className={styles.caption}>{HANDOFF_CAPTION}</p>
      </Tile>

      <Tile surface="canvas" wide>
        <RiseOnScroll>
          <p className={prose.eyebrow}>{HANDOFF_SECTIONS_INTRO.eyebrow}</p>
          <h2 className={prose.displayLg}>{HANDOFF_SECTIONS_INTRO.heading}</h2>
        </RiseOnScroll>
        <CardGrid>
          {HANDOFF_SECTIONS.map((section) => (
            <Card key={section.index} index={section.index} title={section.title}>
              <p>{section.body}</p>
            </Card>
          ))}
        </CardGrid>
      </Tile>

      <Tile surface="dark1">
        <p className={prose.eyebrow}>{HANDOFF_THESIS.eyebrow}</p>
        <p className={prose.leadAiry}>&ldquo;{THESIS_QUOTE}&rdquo;</p>
        <div className={`${prose.body} ${prose.stack}`}>
          {HANDOFF_THESIS.paragraphs.map((paragraph) => (
            <p key={paragraph[0]?.text}>
              <Rich paragraph={paragraph} />
            </p>
          ))}
        </div>
        <div className={prose.actions}>
          <ButtonPrimary href="https://app.mneia.dev">Start free</ButtonPrimary>
        </div>
      </Tile>
    </>
  );
}
