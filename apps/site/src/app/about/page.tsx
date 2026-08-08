import { ButtonPrimary } from '@/components/Button';
import { JsonLd } from '@/components/JsonLd';
import prose from '@/components/Prose.module.css';
import { Rise, RiseOnScroll, SlideOnScroll } from '@/components/Reveal';
import { Rich } from '@/components/RichText';
import { Tile } from '@/components/Tile';
import {
  ABOUT_AUDIENCE,
  ABOUT_BET,
  ABOUT_INTRO,
  ABOUT_LICENSING,
  ABOUT_SCOPE,
  ABOUT_THESIS,
  AUDIENCE,
  THESIS_QUOTE,
} from '@/content/pages';
import { breadcrumbSchema, webPageSchema } from '@/lib/schema';
import { pageMetadata } from '@/lib/site';
import styles from './page.module.css';

export const metadata = pageMetadata('/about');

export default function AboutPage() {
  return (
    <>
      <JsonLd nodes={[webPageSchema('/about'), breadcrumbSchema('/about')]} />

      <Tile surface="canvas">
        <Rise step={0}>
          <p className={prose.eyebrow}>{ABOUT_INTRO.eyebrow}</p>
        </Rise>
        <Rise step={1}>
          <h1 className={prose.hero}>{ABOUT_INTRO.heading}</h1>
        </Rise>
        <Rise step={2}>
          <p className={prose.lead}>{ABOUT_INTRO.lead}</p>
        </Rise>
      </Tile>

      <Tile surface="quiet">
        <SlideOnScroll>
          <p className={prose.eyebrow}>{ABOUT_BET.eyebrow}</p>
          <h2 className={prose.displayLg}>{ABOUT_BET.heading}</h2>
        </SlideOnScroll>
        <ol className={styles.bet}>
          {ABOUT_BET.paragraphs.map((paragraph) => (
            <li key={paragraph[0]?.text}>
              <span>
                <Rich paragraph={paragraph} />
              </span>
            </li>
          ))}
        </ol>
      </Tile>

      <Tile surface="quiet">
        <SlideOnScroll>
          <p className={prose.eyebrow}>{ABOUT_THESIS.eyebrow}</p>
        </SlideOnScroll>
        <p className={prose.leadAiry}>&ldquo;{THESIS_QUOTE}&rdquo;</p>
        <div className={`${prose.body} ${prose.stack}`}>
          {ABOUT_THESIS.paragraphs.map((paragraph) => (
            <p key={paragraph[0]?.text}>
              <Rich paragraph={paragraph} />
            </p>
          ))}
        </div>
      </Tile>

      <Tile surface="quiet">
        <SlideOnScroll>
          <p className={prose.eyebrow}>{ABOUT_AUDIENCE.eyebrow}</p>
          <h2 className={prose.displayLg}>{ABOUT_AUDIENCE.heading}</h2>
        </SlideOnScroll>
        <div className={prose.body}>
          {ABOUT_AUDIENCE.paragraphs.map((paragraph) => (
            <p key={paragraph[0]?.text}>
              <Rich paragraph={paragraph} />
            </p>
          ))}
        </div>
        <div className={styles.audience}>
          {AUDIENCE.map((row) => (
            <div className={styles.audienceRow} key={row.who}>
              <div className={styles.audienceWho}>{row.who}</div>
              <p className={styles.audienceWhat}>{row.what}</p>
            </div>
          ))}
        </div>
      </Tile>

      <Tile surface="quiet" id="licensing">
        <RiseOnScroll>
          <p className={prose.eyebrow}>{ABOUT_LICENSING.eyebrow}</p>
          <h2 className={prose.displayLg}>{ABOUT_LICENSING.heading}</h2>
        </RiseOnScroll>
        <div className={`${prose.body} ${prose.stack}`}>
          {ABOUT_LICENSING.paragraphs.map((paragraph) => (
            <p key={paragraph[0]?.text}>
              <Rich paragraph={paragraph} />
            </p>
          ))}
        </div>
      </Tile>

      <Tile surface="quiet">
        <SlideOnScroll>
          <p className={prose.eyebrow}>{ABOUT_SCOPE.eyebrow}</p>
          <h2 className={prose.displayLg}>{ABOUT_SCOPE.heading}</h2>
        </SlideOnScroll>
        <div className={prose.body}>
          {ABOUT_SCOPE.paragraphs.map((paragraph) => (
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
