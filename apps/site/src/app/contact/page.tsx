import { ButtonPrimary } from '@/components/Button';
import { JsonLd } from '@/components/JsonLd';
import prose from '@/components/Prose.module.css';
import { SlideOnScroll } from '@/components/Reveal';
import { Rich } from '@/components/RichText';
import { Tile } from '@/components/Tile';
import {
  CONTACT_ACCESS,
  CONTACT_CHANNELS,
  CONTACT_INTRO,
  CONTACT_NOT_YET,
} from '@/content/support';
import { breadcrumbSchema, contactPageSchema } from '@/lib/schema';
import { pageMetadata } from '@/lib/site';
import styles from './page.module.css';

export const metadata = pageMetadata('/contact');

export default function ContactPage() {
  return (
    <>
      <JsonLd nodes={[contactPageSchema(), breadcrumbSchema('/contact')]} />

      <Tile surface="canvas">
        <p className={prose.eyebrow}>{CONTACT_INTRO.eyebrow}</p>
        <h1 className={prose.hero}>{CONTACT_INTRO.heading}</h1>
        <p className={prose.lead}>{CONTACT_INTRO.lead}</p>
      </Tile>

      <Tile surface="parchment">
        <ul className={styles.channels}>
          {CONTACT_CHANNELS.map((channel) => (
            <li className={styles.channel} id={channel.id} key={channel.id}>
              <h2 className={styles.label}>{channel.label}</h2>
              <a className={styles.address} href={`mailto:${channel.address}`}>
                {channel.address}
              </a>
              <p className={styles.what}>{channel.what}</p>
              <p className={styles.note}>{channel.note}</p>
            </li>
          ))}
        </ul>
      </Tile>

      <Tile surface="dark1">
        <SlideOnScroll>
          <p className={prose.eyebrow}>{CONTACT_ACCESS.eyebrow}</p>
          <h2 className={prose.displayLg}>{CONTACT_ACCESS.heading}</h2>
        </SlideOnScroll>
        <div className={`${prose.body} ${prose.stack}`}>
          {CONTACT_ACCESS.paragraphs.map((paragraph) => (
            <p key={paragraph[0]?.text}>
              <Rich paragraph={paragraph} />
            </p>
          ))}
        </div>
        <div className={prose.actions}>
          <ButtonPrimary href="https://app.mneia.dev">Start free</ButtonPrimary>
        </div>
      </Tile>

      <Tile surface="canvas">
        <SlideOnScroll>
          <p className={prose.eyebrow}>{CONTACT_NOT_YET.eyebrow}</p>
        </SlideOnScroll>
        <div className={prose.body}>
          {CONTACT_NOT_YET.paragraphs.map((paragraph) => (
            <p key={paragraph[0]?.text}>
              <Rich paragraph={paragraph} />
            </p>
          ))}
        </div>
        <p className={styles.pointer}>
          Looking for an answer rather than a person? <a href="/faq">The FAQ</a> and{' '}
          <a href="/help">Help</a> cover most of what reaches these inboxes.
        </p>
      </Tile>
    </>
  );
}
