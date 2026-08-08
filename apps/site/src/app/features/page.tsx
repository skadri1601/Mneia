import { ButtonPrimary } from '@/components/Button';
import { FaqList } from '@/components/Faq';
import { JsonLd } from '@/components/JsonLd';
import prose from '@/components/Prose.module.css';
import { SlideOnScroll } from '@/components/Reveal';
import { Rich } from '@/components/RichText';
import { Tile, type TileSurface } from '@/components/Tile';
import {
  FEATURES,
  FEATURES_COMPOUND,
  FEATURES_COMPOUND_QUOTE,
  FEATURES_FAQ,
  FEATURES_INTRO,
} from '@/content/pages';
import { breadcrumbSchema, faqSchema, webPageSchema } from '@/lib/schema';
import { pageMetadata } from '@/lib/site';
import styles from './page.module.css';

export const metadata = pageMetadata('/features');

const SURFACES: readonly TileSurface[] = ['dark1', 'canvas', 'parchment', 'canvas', 'dark1'];

export default function FeaturesPage() {
  return (
    <>
      <JsonLd
        nodes={[webPageSchema('/features'), breadcrumbSchema('/features'), faqSchema(FEATURES_FAQ)]}
      />

      <Tile surface="canvas">
        <p className={prose.eyebrow}>{FEATURES_INTRO.eyebrow}</p>
        <h1 className={prose.hero}>{FEATURES_INTRO.heading}</h1>
        <p className={prose.lead}>{FEATURES_INTRO.lead}</p>
      </Tile>

      {FEATURES.map((feature, i) => (
        <Tile key={feature.index} surface={SURFACES[i] ?? 'canvas'}>
          <div className={styles.feature}>
            <SlideOnScroll from={i % 2 === 0 ? 'left' : 'right'}>
              <div className={styles.index}>{feature.index}</div>
              <h2 className={prose.displayMd}>{feature.title}</h2>
              <div className={prose.body}>
                <p>{feature.body}</p>
              </div>
            </SlideOnScroll>
            <div className={styles.today}>
              <div className={styles.todayLabel}>{feature.todayLabel}</div>
              <div className={styles.todayValue}>{feature.todayValue}</div>
              <p className={styles.todayBody}>{feature.todayBody}</p>
            </div>
          </div>
        </Tile>
      ))}

      <Tile surface="parchment">
        <SlideOnScroll>
          <p className={prose.eyebrow}>{FEATURES_COMPOUND.eyebrow}</p>
        </SlideOnScroll>
        <div className={styles.honest}>
          <p className={prose.leadAiry}>{FEATURES_COMPOUND_QUOTE}</p>
          <div className={`${prose.body} ${prose.stack}`}>
            {FEATURES_COMPOUND.paragraphs.map((paragraph) => (
              <p key={paragraph[0]?.text}>
                <Rich paragraph={paragraph} />
              </p>
            ))}
          </div>
        </div>
        <div className={prose.actions}>
          <ButtonPrimary href="https://app.mneia.dev">Start free</ButtonPrimary>
        </div>
      </Tile>

      <Tile surface="canvas">
        <SlideOnScroll>
          <p className={prose.eyebrow}>Questions</p>
          <h2 className={prose.displayLg}>What people ask before they install it.</h2>
        </SlideOnScroll>
        <FaqList items={FEATURES_FAQ} />
      </Tile>
    </>
  );
}
