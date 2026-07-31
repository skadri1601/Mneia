import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ButtonPrimary } from '@/components/Button';
import prose from '@/components/Prose.module.css';
import { Tile } from '@/components/Tile';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'About',
  description:
    'Why Mneia exists, who it is built for, how it is licensed, and the things we have decided not to build.',
};

const BET: ReactNode[] = [
  <>
    <strong>Long-running agent sessions degrade.</strong> Context windows fill, compaction is lossy,
    and recall drops well before the window is full. This is measured, not anecdotal.
  </>,
  <>
    <strong>Every provider has responded by externalising context</strong>: memory tools,
    compaction, project instruction files. Which means the context layer is a permanent
    architectural component, not a temporary hack.
  </>,
  <>
    <strong>The existing products are built for one user and one agent.</strong> Nobody has built
    the layer for several humans and several agents working the same project over weeks.
  </>,
  <>
    <strong>Our wedge is the artifact nobody ships: a handoff.</strong> Not a memory store you
    query, but an object a person or an agent receives when picking work up.
  </>,
  <>
    <strong>What keeps a team is not the feature list.</strong> It is becoming the record of what
    the team decided and why, which is not something a competitor can copy, because it is the
    customer&apos;s own history.
  </>,
];

const AUDIENCE = [
  {
    who: 'The individual developer',
    what: 'Living in Claude Code, Cursor, or Codex daily. Cross-session context loss, compaction damage, re-explaining. Free tier, permanently.',
  },
  {
    who: 'A tech lead on a small team',
    what: 'Especially mid-migration or mid-refactor. Context sits in individual heads, onboarding onto in-flight work is expensive, and agents contradict decisions that were already settled.',
  },
  {
    who: 'A multi-team engineering org',
    what: 'No record of what agents decided or why. No audit trail. No governance over what context an agent is allowed to see.',
  },
  {
    who: 'The company around engineering',
    what: 'Support, sales, and operations people build with agents too. They have a real question with no trustworthy current answer: is this on the roadmap, who owns it, what is the state?',
  },
];

const NOT_BUILDING = [
  'Agent orchestration or a runtime',
  'Observability, tracing, or evals',
  'Enterprise document search',
  'A chat interface, or an agent of our own',
  'Durable execution infrastructure',
  'Model hosting or inference',
  'A vector database. We use one',
  'Every framework on day one',
];

export default function AboutPage() {
  return (
    <>
      <Tile surface="canvas">
        <p className={prose.eyebrow}>About</p>
        <h1 className={prose.hero}>The context layer is permanent. Nobody built it for teams.</h1>
        <p className={prose.lead}>
          Mneia is the shared project memory and handoff layer for teams working with AI agents.
          Three operations: checkpoint, rehydrate, handoff. Everything else serves them.
        </p>
      </Tile>

      <Tile surface="dark1">
        <p className={prose.eyebrow}>The bet</p>
        <h2 className={prose.displayLg}>In five sentences.</h2>
        <ol className={styles.bet}>
          {BET.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static ordered prose, never reordered
            <li key={i}>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      </Tile>

      <Tile surface="canvas">
        <p className={prose.eyebrow}>The thesis</p>
        <p className={prose.leadAiry}>
          &ldquo;The unit of value is not memory. It is the handoff.&rdquo;
        </p>
        <div className={`${prose.body} ${prose.stack}`}>
          <p>
            Every competitor built a place to store context and a way to query it. That is a
            database posture. The actual job is a transfer: work stops with one actor and resumes
            with another.
          </p>
          <p>
            Two things follow. <strong>Once work is transferred between people</strong>, the store
            has to handle several writers, which forces provenance, conflict resolution, and
            permissions, and those cannot be bolted onto a single-user product without changing its
            thesis. <strong>And a handoff has to survive crossing tools.</strong> Model providers
            are structurally incentivised against that kind of neutrality. The gap is permanent.
          </p>
        </div>
      </Tile>

      <Tile surface="parchment">
        <p className={prose.eyebrow}>Who it is for</p>
        <h2 className={prose.displayLg}>Built for a company, landed through engineering.</h2>
        <div className={prose.body}>
          <p>
            Context does not stop at a team boundary. A decision made in the payments team changes
            what sales can promise; an open question in platform blocks three feature teams. So the
            data model assumes the company from the first migration: teams as a first-class entity,
            a visibility hierarchy, function on the team. The sales motion does not.
          </p>
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

      <Tile surface="canvas" id="licensing">
        <p className={prose.eyebrow}>Licensing</p>
        <h2 className={prose.displayLg}>Open clients, hosted service.</h2>
        <div className={`${prose.body} ${prose.stack}`}>
          <p>
            The client packages are Apache 2.0: the CLI, the MCP server, and the core, which holds
            the schema definitions, the handoff format, the extraction prompts, and the ranking
            algorithm. The hosted API, the store, billing, and the review surfaces are proprietary.
          </p>
          <p>
            <strong>Being straight about what that means:</strong> Mneia runs as a hosted service.
            The clients require an account and do not function without it. Bring-your-own-cloud is
            on the roadmap for organisations that need it; it does not exist today, and we would
            rather say so here than have you find out after installing.
          </p>
        </div>
      </Tile>

      <Tile surface="dark1" id="not-building">
        <p className={prose.eyebrow}>Scope</p>
        <h2 className={prose.displayLg}>What we have decided not to build.</h2>
        <div className={prose.body}>
          <p>
            A short list of things that are reasonable requests and still get a no. We sit beside
            the frameworks and the observability tools, never above them, and a product that answers
            every adjacent request stops being good at the three operations it exists for.
          </p>
        </div>
        <ul className={styles.notList}>
          {NOT_BUILDING.map((item) => (
            <li key={item}>
              <span className={styles.strike}>·</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <div className={prose.actions}>
          <ButtonPrimary href="/#waitlist">Request access</ButtonPrimary>
        </div>
      </Tile>
    </>
  );
}
