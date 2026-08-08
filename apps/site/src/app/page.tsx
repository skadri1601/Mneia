import { ButtonPrimary, ButtonSecondaryPill } from '@/components/Button';
import { Card, CardGrid } from '@/components/Card';
import { HandoffArtifact } from '@/components/HandoffArtifact';
import { JsonLd } from '@/components/JsonLd';
import prose from '@/components/Prose.module.css';
import { Rise, RiseOnScroll } from '@/components/Reveal';
import { Rich } from '@/components/RichText';
import { Tile } from '@/components/Tile';
import {
  HOME_ARTIFACT,
  HOME_INTRO,
  HOME_OPERATIONS_INTRO,
  HOME_PROBLEM,
  HOME_START,
  HOME_SURFACES,
  OPERATIONS,
} from '@/content/pages';
import { breadcrumbSchema, webPageSchema } from '@/lib/schema';
import { pageMetadata } from '@/lib/site';
import styles from './page.module.css';

export const metadata = pageMetadata('/');

export default function HomePage() {
  return (
    <>
      <JsonLd nodes={[webPageSchema('/'), breadcrumbSchema('/')]} />

      <Tile surface="canvas" centered>
        <div className={styles.hero}>
          <Rise step={0}>
            <p className={prose.eyebrow}>{HOME_INTRO.eyebrow}</p>
          </Rise>
          <Rise step={1}>
            <h1 className={prose.hero}>{HOME_INTRO.heading}</h1>
          </Rise>
          <Rise step={2}>
            <p className={`${prose.lead} ${prose.centered}`}>{HOME_INTRO.lead}</p>
          </Rise>
          <Rise step={3}>
            <div className={`${prose.actions} ${prose.actionsCentered}`}>
              <ButtonPrimary href="https://app.mneia.dev">Start free</ButtonPrimary>
              <ButtonSecondaryPill href="/handoff">See a real handoff</ButtonSecondaryPill>
            </div>
          </Rise>
        </div>
      </Tile>

      <Tile surface="dark1" centered>
        <RiseOnScroll>
          <p className={prose.eyebrow}>{HOME_PROBLEM.eyebrow}</p>
          <h2 className={prose.displayLg}>{HOME_PROBLEM.heading}</h2>
        </RiseOnScroll>
        <div className={styles.scenario}>
          {HOME_PROBLEM.paragraphs.map((paragraph) => (
            <p key={paragraph[0]?.text}>
              <Rich paragraph={paragraph} />
            </p>
          ))}
        </div>
      </Tile>

      <Tile surface="canvas" centered>
        <RiseOnScroll>
          <p className={prose.eyebrow}>{HOME_ARTIFACT.eyebrow}</p>
          <h2 className={prose.displayLg}>{HOME_ARTIFACT.heading}</h2>
        </RiseOnScroll>
        <p className={`${prose.lead} ${prose.centered}`}>{HOME_ARTIFACT.lead}</p>
        <RiseOnScroll late className={styles.artifactStage}>
          <HandoffArtifact highlightSuperseded />
        </RiseOnScroll>
        <div className={`${prose.actions} ${prose.actionsCentered}`}>
          <ButtonSecondaryPill href="/handoff">Read it annotated</ButtonSecondaryPill>
        </div>
      </Tile>

      <Tile surface="parchment" wide centered>
        <RiseOnScroll>
          <p className={prose.eyebrow}>{HOME_OPERATIONS_INTRO.eyebrow}</p>
          <h2 className={prose.displayLg}>{HOME_OPERATIONS_INTRO.heading}</h2>
        </RiseOnScroll>
        <CardGrid>
          {OPERATIONS.map((operation) => (
            <Card
              key={operation.title}
              index={operation.index}
              title={operation.title}
              aside={operation.aside}
            >
              <p>{operation.body}</p>
            </Card>
          ))}
        </CardGrid>
      </Tile>

      <Tile surface="dark1" centered>
        <RiseOnScroll>
          <p className={prose.eyebrow}>{HOME_SURFACES.eyebrow}</p>
          <h2 className={prose.displayLg}>{HOME_SURFACES.heading}</h2>
        </RiseOnScroll>
        <div className={`${prose.body} ${prose.centered} ${prose.stack}`}>
          {HOME_SURFACES.paragraphs.map((paragraph) => (
            <p key={paragraph[0]?.text}>
              <Rich paragraph={paragraph} />
            </p>
          ))}
        </div>
      </Tile>

      <Tile surface="canvas" centered id="start">
        <div className={styles.waitlist}>
          <RiseOnScroll>
            <p className={prose.eyebrow}>{HOME_START.eyebrow}</p>
            <h2 className={prose.displayLg}>{HOME_START.heading}</h2>
          </RiseOnScroll>
          <p className={`${prose.lead} ${prose.centered}`}>{HOME_START.lead}</p>
          <div className={`${prose.actions} ${prose.actionsCentered}`}>
            <ButtonPrimary href="https://app.mneia.dev">Start free</ButtonPrimary>
            <ButtonSecondaryPill href="/docs/quickstart">Read the quickstart</ButtonSecondaryPill>
          </div>
        </div>
      </Tile>
    </>
  );
}
