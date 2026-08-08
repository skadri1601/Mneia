import Link from 'next/link';
import { ButtonPrimary, ButtonSecondaryPill } from '@/components/Button';
import { JsonLd } from '@/components/JsonLd';
import prose from '@/components/Prose.module.css';
import { SlideOnScroll } from '@/components/Reveal';
import { Rich } from '@/components/RichText';
import { Tile } from '@/components/Tile';
import {
  HELP_ESCALATION,
  HELP_INTRO,
  HELP_PATHS,
  HELP_SYMPTOMS,
  HELP_TASKS,
} from '@/content/support';
import { breadcrumbSchema, faqSchema, webPageSchema } from '@/lib/schema';
import { pageMetadata } from '@/lib/site';
import styles from './page.module.css';

export const metadata = pageMetadata('/help');

const TASK_FAQS = HELP_TASKS.map((task) => ({ question: task.question, answer: task.answer }));

export default function HelpPage() {
  return (
    <>
      <JsonLd nodes={[webPageSchema('/help'), breadcrumbSchema('/help'), faqSchema(TASK_FAQS)]} />

      <Tile surface="canvas">
        <p className={prose.eyebrow}>{HELP_INTRO.eyebrow}</p>
        <h1 className={prose.hero}>{HELP_INTRO.heading}</h1>
        <p className={prose.lead}>{HELP_INTRO.lead}</p>
      </Tile>

      <Tile surface="quiet">
        <SlideOnScroll>
          <p className={prose.eyebrow}>Where to start</p>
          <h2 className={prose.displayLg}>Four ways in, depending on what you need.</h2>
        </SlideOnScroll>
        <ul className={styles.paths}>
          {HELP_PATHS.map((path) => (
            <li className={styles.path} key={path.index}>
              <span className={styles.pathIndex}>{path.index}</span>
              <h3 className={styles.pathTitle}>{path.title}</h3>
              <p className={styles.pathBody}>{path.body}</p>
              <Link className={styles.pathLink} href={path.href}>
                {path.linkLabel}
              </Link>
            </li>
          ))}
        </ul>
      </Tile>

      <Tile surface="quiet">
        <SlideOnScroll>
          <p className={prose.eyebrow}>Common tasks</p>
          <h2 className={prose.displayLg}>How do I…</h2>
        </SlideOnScroll>
        <dl className={styles.tasks}>
          {HELP_TASKS.map((task) => (
            <div className={styles.task} key={task.question}>
              <dt className={styles.taskQuestion}>{task.question}</dt>
              <dd className={styles.taskAnswer}>
                <span>{task.answer}</span>
                <Link className={styles.taskLink} href={task.href}>
                  {task.linkLabel}
                </Link>
              </dd>
            </div>
          ))}
        </dl>
      </Tile>

      <Tile surface="quiet" wide>
        <SlideOnScroll>
          <p className={prose.eyebrow}>Troubleshooting</p>
          <h2 className={prose.displayLg}>What the error means, and what fixes it.</h2>
        </SlideOnScroll>
        <div className={styles.symptomsWrap}>
          <table className={styles.symptoms}>
            <thead>
              <tr>
                <th scope="col">Symptom</th>
                <th scope="col">Why</th>
                <th scope="col">Fix</th>
              </tr>
            </thead>
            <tbody>
              {HELP_SYMPTOMS.map((row) => (
                <tr key={row.symptom}>
                  <th scope="row">
                    <code className={styles.symptomCode}>{row.symptom}</code>
                  </th>
                  <td>{row.cause}</td>
                  <td>{row.fix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tile>

      <Tile centered surface="quiet">
        <SlideOnScroll>
          <p className={prose.eyebrow}>{HELP_ESCALATION.eyebrow}</p>
          <h2 className={`${prose.displayLg} ${prose.centered}`}>{HELP_ESCALATION.heading}</h2>
        </SlideOnScroll>
        <div className={`${prose.body} ${prose.stack} ${prose.centered}`}>
          {HELP_ESCALATION.paragraphs.map((paragraph) => (
            <p key={paragraph[0]?.text}>
              <Rich paragraph={paragraph} />
            </p>
          ))}
        </div>
        <div className={`${prose.actions} ${prose.actionsCentered}`}>
          <ButtonPrimary href="/contact">Contact us</ButtonPrimary>
          <ButtonSecondaryPill href="/faq">Read the FAQ</ButtonSecondaryPill>
        </div>
      </Tile>
    </>
  );
}
