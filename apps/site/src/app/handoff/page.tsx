import type { Metadata } from 'next';
import { ButtonPrimary } from '@/components/Button';
import { Card, CardGrid } from '@/components/Card';
import { HandoffArtifact } from '@/components/HandoffArtifact';
import { Rise, RiseOnScroll } from '@/components/Reveal';
import prose from '@/components/Prose.module.css';
import { Tile } from '@/components/Tile';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'The handoff',
  description:
    'A real handoff artifact: what is done, current state, open questions, constraints, next action, with provenance on every line.',
};

const SECTIONS = [
  {
    index: 'Next action',
    title: 'One instruction, not a summary',
    body: 'The receiver should not have to derive what to do from a wall of state. The first thing in the artifact is the single next move, and whether anything blocks it.',
  },
  {
    index: 'Constraints',
    title: 'Marked by who set them',
    body: 'A human-confirmed constraint and an unconfirmed agent assertion are not the same object and must not look the same. Human items carry the accent; agent items are muted until a human confirms them.',
  },
  {
    index: 'Decisions',
    title: 'Carrying the rationale',
    body: 'A decision without its reasoning gets re-litigated the moment someone new arrives. Every decision states why, and what alternative it beat.',
  },
  {
    index: 'Open questions',
    title: 'Unresolved, and visibly so',
    body: 'Including who owns them and how long they have been sitting. An open question with no owner since three weeks ago is information about the project, not just about the task.',
  },
  {
    index: 'Superseded',
    title: 'The section nobody else produces',
    body: 'What was tried, rejected, and must not be proposed again. This is the highest-value block in the artifact and the reason a fresh agent does not walk straight back into the approach the team already ruled out.',
  },
  {
    index: 'Artifacts',
    title: 'Pointers to the real work',
    body: 'PRs, ADRs, tickets. The handoff does not duplicate them, it locates them.',
  },
];

export default function HandoffPage() {
  return (
    <>
      <Tile surface="canvas">
        <Rise step={0}>
          <p className={prose.eyebrow}>The artifact</p>
        </Rise>
        <Rise step={1}>
          <h1 className={prose.hero}>What a handoff actually looks like.</h1>
        </Rise>
        <Rise step={2}>
          <p className={prose.lead}>
            Every competitor built a place to store context and a way to query it. That is a
            database posture. The job to be done is a transfer.
          </p>
        </Rise>
      </Tile>

      <Tile surface="parchment">
        <RiseOnScroll className={styles.artifactWrap}>
          <HandoffArtifact highlightSuperseded />
        </RiseOnScroll>
        <p className={styles.caption}>Rendered markdown, frozen at creation, plus a live link.</p>
      </Tile>

      <Tile surface="canvas" wide>
        <RiseOnScroll>
          <p className={prose.eyebrow}>Section by section</p>
          <h2 className={prose.displayLg}>Why each block is in there.</h2>
        </RiseOnScroll>
        <CardGrid>
          {SECTIONS.map((section) => (
            <Card key={section.index} index={section.index} title={section.title}>
              <p>{section.body}</p>
            </Card>
          ))}
        </CardGrid>
      </Tile>

      <Tile surface="dark1">
        <p className={prose.eyebrow}>The thesis</p>
        <p className={prose.leadAiry}>
          &ldquo;The unit of value is not memory. It is the handoff.&rdquo;
        </p>
        <div className={`${prose.body} ${prose.stack}`}>
          <p>
            Work stops with one actor and resumes with another: the same human tomorrow, a different
            human next week, a different agent on the next task. The thing that should exist is an
            artifact produced at the moment of stopping and consumed at the moment of resuming.
          </p>
          <p>
            <strong>It also has to survive crossing tools.</strong> If it only works inside one
            vendor&apos;s client, it is not a handoff.
          </p>
        </div>
        <div className={prose.actions}>
          <ButtonPrimary href="/#waitlist">Request access</ButtonPrimary>
        </div>
      </Tile>
    </>
  );
}
