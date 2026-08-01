import { ButtonPrimary } from '@/components/Button';
import { FaqList } from '@/components/Faq';
import { JsonLd } from '@/components/JsonLd';
import prose from '@/components/Prose.module.css';
import { Rise, SlideOnScroll } from '@/components/Reveal';
import { Rich } from '@/components/RichText';
import { Tile } from '@/components/Tile';
import {
  METERING,
  PRICING_FAQ,
  PRICING_INTRO,
  PRICING_METERING,
  PRICING_NO_KEY,
  PRICING_PREVIEW,
  TIERS,
} from '@/content/pages';
import { breadcrumbSchema, faqSchema, webPageSchema } from '@/lib/schema';
import { pageMetadata } from '@/lib/site';
import styles from './page.module.css';

export const metadata = pageMetadata('/pricing');

export default function PricingPage() {
  return (
    <>
      <JsonLd
        nodes={[webPageSchema('/pricing'), breadcrumbSchema('/pricing'), faqSchema(PRICING_FAQ)]}
      />

      <Tile surface="canvas" wide>
        <Rise step={0}>
          <p className={prose.eyebrow}>{PRICING_INTRO.eyebrow}</p>
        </Rise>
        <Rise step={1}>
          <h1 className={prose.hero}>{PRICING_INTRO.heading}</h1>
        </Rise>
        <p className={prose.lead}>{PRICING_INTRO.lead}</p>

        <div className={styles.tiers}>
          {TIERS.map((tier) => (
            <div
              className={`${styles.tier} ${tier.featured ? styles.featured : ''}`}
              key={tier.name}
            >
              <div className={styles.tierName}>{tier.name}</div>
              <div className={styles.price}>
                {tier.price}
                {tier.unit ? <span className={styles.unit}>{tier.unit}</span> : null}
              </div>
              <p className={styles.tierNote}>{tier.note}</p>
              <ul className={styles.contents}>
                {tier.contents.map((item) => (
                  <li key={item}>
                    <span className={styles.tick}>·</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className={styles.preview}>
          <Rich paragraph={PRICING_PREVIEW} />
        </div>
      </Tile>

      <Tile surface="dark1" wide>
        <SlideOnScroll>
          <p className={prose.eyebrow}>{PRICING_METERING.eyebrow}</p>
          <h2 className={prose.displayLg}>{PRICING_METERING.heading}</h2>
        </SlideOnScroll>
        <div className={prose.body}>
          {PRICING_METERING.paragraphs.map((paragraph) => (
            <p key={paragraph[0]?.text}>
              <Rich paragraph={paragraph} />
            </p>
          ))}
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.meterTable}>
            <thead>
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Marginal cost</th>
                <th scope="col">Metered</th>
              </tr>
            </thead>
            <tbody>
              {METERING.map((row) => (
                <tr key={row.action}>
                  <th scope="row">{row.action}</th>
                  <td>{row.cost}</td>
                  <td>{row.metered}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tile>

      <Tile surface="canvas">
        <SlideOnScroll>
          <p className={prose.eyebrow}>{PRICING_NO_KEY.eyebrow}</p>
          <h2 className={prose.displayMd}>{PRICING_NO_KEY.heading}</h2>
        </SlideOnScroll>
        <div className={`${prose.body} ${prose.stack}`}>
          {PRICING_NO_KEY.paragraphs.map((paragraph) => (
            <p key={paragraph[0]?.text}>
              <Rich paragraph={paragraph} />
            </p>
          ))}
        </div>
        <div className={prose.actions}>
          <ButtonPrimary href="/#waitlist">Request access</ButtonPrimary>
        </div>
      </Tile>

      <Tile surface="parchment">
        <SlideOnScroll>
          <p className={prose.eyebrow}>Questions</p>
          <h2 className={prose.displayLg}>What people ask about the bill.</h2>
        </SlideOnScroll>
        <FaqList items={PRICING_FAQ} />
      </Tile>
    </>
  );
}
