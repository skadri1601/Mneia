import type { ReactNode } from 'react';
import styles from './ProjectSectionLoading.module.css';

export type ProjectSection = 'overview' | 'decisions' | 'timeline' | 'review';

const SECTION_LABELS: Readonly<Record<ProjectSection, string>> = {
  overview: 'Overview',
  decisions: 'Decisions',
  timeline: 'Timeline',
  review: 'Review queue',
};

const SETTINGS_CARD_KEYS = ['name', 'lifecycle'] as const;
const DECISION_ROW_KEYS = ['first', 'second', 'third', 'fourth'] as const;
const BELIEF_SECTION_KEYS = ['then', 'since'] as const;
const BELIEF_ROW_KEYS = ['first', 'second'] as const;
const REVIEW_CARD_KEYS = ['first', 'second', 'third'] as const;

const overviewShape = (): ReactNode => (
  <>
    <div className={styles.heading} aria-hidden="true" />
    {SETTINGS_CARD_KEYS.map((key) => (
      <div key={key} className={styles.card} aria-hidden="true">
        <div className={styles.lineShort} aria-hidden="true" />
        <div className={styles.line} aria-hidden="true" />
        <div className={styles.control} aria-hidden="true" />
      </div>
    ))}
  </>
);

const decisionsShape = (): ReactNode => (
  <>
    <div className={styles.heading} aria-hidden="true" />
    <div className={styles.filters} aria-hidden="true" />
    <div className={styles.count} aria-hidden="true" />
    {DECISION_ROW_KEYS.map((key) => (
      <div key={key} className={styles.row} aria-hidden="true">
        <div className={styles.chip} aria-hidden="true" />
        <div className={styles.line} aria-hidden="true" />
        <div className={styles.lineShort} aria-hidden="true" />
      </div>
    ))}
  </>
);

const timelineShape = (): ReactNode => (
  <>
    <div className={styles.heading} aria-hidden="true" />
    <div className={styles.dateControl} aria-hidden="true" />
    {BELIEF_SECTION_KEYS.map((sectionKey) => (
      <div key={sectionKey} className={styles.beliefSection} aria-hidden="true">
        <div className={styles.lineShort} aria-hidden="true" />
        {BELIEF_ROW_KEYS.map((rowKey) => (
          <div key={rowKey} className={styles.row} aria-hidden="true">
            <div className={styles.chip} aria-hidden="true" />
            <div className={styles.line} aria-hidden="true" />
          </div>
        ))}
      </div>
    ))}
  </>
);

const reviewShape = (): ReactNode => (
  <>
    <div className={styles.heading} aria-hidden="true" />
    {REVIEW_CARD_KEYS.map((key) => (
      <div key={key} className={styles.reviewCard} aria-hidden="true">
        <div className={styles.chip} aria-hidden="true" />
        <div className={styles.line} aria-hidden="true" />
        <div className={styles.control} aria-hidden="true" />
      </div>
    ))}
  </>
);

const SECTION_SHAPES: Readonly<Record<ProjectSection, () => ReactNode>> = {
  overview: overviewShape,
  decisions: decisionsShape,
  timeline: timelineShape,
  review: reviewShape,
};

export function ProjectSectionLoading({
  section,
}: Readonly<{ section: ProjectSection }>): ReactNode {
  return (
    <div className={styles.section} aria-busy="true">
      <p className={styles.status} role="status" aria-live="polite">
        Loading {SECTION_LABELS[section]}…
      </p>
      {SECTION_SHAPES[section]()}
    </div>
  );
}
