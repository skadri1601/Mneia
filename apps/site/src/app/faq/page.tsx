import { ButtonPrimary, ButtonSecondaryPill } from '@/components/Button';
import { FaqList } from '@/components/Faq';
import { JsonLd } from '@/components/JsonLd';
import prose from '@/components/Prose.module.css';
import { SlideOnScroll } from '@/components/Reveal';
import { Tile, type TileSurface } from '@/components/Tile';
import { ALL_FAQS, FAQ_GROUPS, FAQ_INTRO } from '@/content/faq';
import { breadcrumbSchema, faqSchema, webPageSchema } from '@/lib/schema';
import { pageMetadata } from '@/lib/site';
import styles from './page.module.css';

export const metadata = pageMetadata('/faq');

const SURFACES: readonly TileSurface[] = ['canvas', 'parchment', 'canvas', 'dark1', 'canvas'];

export default function FaqPage() {
  return (
    <>
      <JsonLd nodes={[webPageSchema('/faq'), breadcrumbSchema('/faq'), faqSchema(ALL_FAQS)]} />

      <Tile surface="canvas">
        <p className={prose.eyebrow}>{FAQ_INTRO.eyebrow}</p>
        <h1 className={prose.hero}>{FAQ_INTRO.heading}</h1>
        <p className={prose.lead}>{FAQ_INTRO.lead}</p>
        <nav aria-label="Question groups" className={styles.jump}>
          {FAQ_GROUPS.map((group) => (
            <a className={styles.jumpLink} href={`#${group.id}`} key={group.id}>
              {group.heading}
            </a>
          ))}
        </nav>
      </Tile>

      {FAQ_GROUPS.map((group, index) => (
        <Tile id={group.id} key={group.id} surface={SURFACES[index] ?? 'canvas'}>
          <SlideOnScroll from={index % 2 === 0 ? 'left' : 'right'}>
            <h2 className={prose.displayLg}>{group.heading}</h2>
            <p className={prose.lead}>{group.blurb}</p>
          </SlideOnScroll>
          <FaqList items={group.items} />
        </Tile>
      ))}

      <Tile centered surface="parchment">
        <SlideOnScroll>
          <p className={prose.eyebrow}>Not answered here</p>
          <h2 className={`${prose.displayLg} ${prose.centered}`}>
            The documentation is more specific.
          </h2>
          <p className={`${prose.lead} ${prose.centered}`}>
            Help covers the errors people actually hit. The reference pages carry every flag and
            every tool. And if something here is wrong, that is a bug worth telling us about.
          </p>
        </SlideOnScroll>
        <div className={`${prose.actions} ${prose.actionsCentered}`}>
          <ButtonPrimary href="/docs">Read the documentation</ButtonPrimary>
          <ButtonSecondaryPill href="/contact">Contact us</ButtonSecondaryPill>
        </div>
      </Tile>
    </>
  );
}
