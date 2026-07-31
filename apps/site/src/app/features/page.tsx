import type { Metadata } from 'next';
import { ButtonPrimary } from '@/components/Button';
import prose from '@/components/Prose.module.css';
import { Tile, type TileSurface } from '@/components/Tile';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Features',
  description:
    'Five things that exist together nowhere else: the handoff artifact, conflict resolution across humans and agents, provenance with actor attribution, selective rehydration under a token budget, and boundary-triggered checkpoints.',
};

const FEATURES = [
  {
    index: '01',
    title: 'The handoff is a first-class object',
    body: 'A receivable artifact produced when work stops and consumed when it resumes. Not a record you have to know how to search for — a thing that arrives.',
    todayLabel: 'Today',
    todayValue: 'Nobody ships this',
    todayBody:
      'Everyone stores memory. Nobody hands off. The closest available thing is "query the memory store", which puts the entire burden on whoever is picking the work up.',
  },
  {
    index: '02',
    title: 'Conflict resolution across humans and agents',
    body: 'Explicit arbitration when a teammate and an agent disagree about project state. Agent versus human-confirmed: the human wins, always, and the agent assertion is stored as disputed rather than silently applied. Human versus human is never auto-resolved.',
    todayLabel: 'Today',
    todayValue: 'Announced, not shipped',
    todayBody:
      'Single-user products have no conflicts by construction. Products that do detect contradictions tend to invalidate the older fact automatically — which is exactly wrong for a decision, where a human has to arbitrate.',
  },
  {
    index: '03',
    title: 'Provenance with actor attribution',
    body: 'Every item records whether a human or an agent asserted it, which one, when, and on what basis. That distinction is rendered everywhere it appears, because it is the distinction that decides what to trust.',
    todayLabel: 'Today',
    todayValue: 'Partial at best',
    todayBody:
      'Some products carry episode-level provenance for facts, or commit history. None distinguish human authority from agent assertion.',
  },
  {
    index: '04',
    title: 'Selective rehydration under a token budget',
    body: 'Choose the minimal correct slice for the next task, with per-kind quotas so a pile of similar facts cannot crowd out every constraint. Load-bearing active constraints are always included, whatever the budget pressure.',
    todayLabel: 'Today',
    todayValue: 'Compaction, which is not selection',
    todayBody:
      'Compaction and context editing shrink the window. They do not select for the task at hand — compaction is lossy by design and task-blind, and semantic search returns what is similar rather than what is load-bearing.',
  },
  {
    index: '05',
    title: 'Boundary-triggered structured checkpoints',
    body: 'Explicit capture at a task or day boundary into a typed schema, with contradiction detection before anything is written, and human confirmation on the load-bearing items.',
    todayLabel: 'Today',
    todayValue: 'Ambient, or threshold-triggered',
    todayBody:
      'Ambient capture produces noise. Threshold compaction fires when the window is full, which is the worst possible moment, and it produces nothing you can review.',
  },
];

const SURFACES: readonly TileSurface[] = ['raised', 'canvas', 'recessed', 'canvas', 'raised'];

export default function FeaturesPage() {
  return (
    <>
      <Tile surface="canvas">
        <p className={prose.eyebrow}>Features</p>
        <h1 className={prose.hero}>Five things that exist together nowhere else.</h1>
        <p className={prose.lead}>
          Individually, several of these have partial answers elsewhere. The combination is what
          does not exist, and the combination is what a team actually needs.
        </p>
      </Tile>

      {FEATURES.map((feature, i) => (
        <Tile key={feature.index} surface={SURFACES[i] ?? 'canvas'}>
          <div className={styles.feature}>
            <div>
              <div className={styles.index}>{feature.index}</div>
              <h2 className={prose.displayMd}>{feature.title}</h2>
              <div className={prose.body}>
                <p>{feature.body}</p>
              </div>
            </div>
            <div className={styles.today}>
              <div className={styles.todayLabel}>{feature.todayLabel}</div>
              <div className={styles.todayValue}>{feature.todayValue}</div>
              <p className={styles.todayBody}>{feature.todayBody}</p>
            </div>
          </div>
        </Tile>
      ))}

      <Tile surface="recessed">
        <p className={prose.eyebrow}>Kept on the wall</p>
        <div className={styles.honest}>
          <p className={prose.quote}>
            &ldquo;Any one of these can be built by a funded team in a quarter.&rdquo;
          </p>
          <div className={`${prose.body} ${prose.stack}`}>
            <p>
              That sentence is from our own founding brief, and it stays there on purpose. Features
              get the first thousand users. What keeps a team is that after a year of checkpointing,
              leaving means abandoning their own institutional memory.
            </p>
            <p>
              <strong>
                If we cannot say why a team stays after eighteen months, the business does not exist
              </strong>{' '}
              regardless of how good the feature list looks today.
            </p>
          </div>
        </div>
        <div className={prose.actions}>
          <ButtonPrimary href="/#waitlist">Request access</ButtonPrimary>
        </div>
      </Tile>
    </>
  );
}
