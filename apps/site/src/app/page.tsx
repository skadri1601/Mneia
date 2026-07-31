import { ButtonPrimary, ButtonSecondaryPill } from '@/components/Button';
import { Card, CardGrid } from '@/components/Card';
import { HandoffArtifact } from '@/components/HandoffArtifact';
import prose from '@/components/Prose.module.css';
import { Tile } from '@/components/Tile';
import { WaitlistForm } from '@/components/WaitlistForm';
import styles from './page.module.css';

const OPERATIONS = [
  {
    index: '01',
    title: 'Checkpoint',
    body: 'At a task or day boundary, extract the decisions, constraints, and open questions out of the session. Detect contradictions with what is already known. Ask a human to confirm the load-bearing ones.',
    aside: 'Explicit capture at a boundary, not ambient capture that produces noise.',
  },
  {
    index: '02',
    title: 'Rehydrate',
    body: 'Given the next task and a token budget, assemble the minimal high-signal slice. Not replay-everything, and not raw semantic search. Semantic search returns what is similar, not what is load-bearing.',
    aside: 'Active constraints are always included, whatever the budget pressure.',
  },
  {
    index: '03',
    title: 'Handoff',
    body: 'Produce something a person or an agent receives: what is done, current state, open questions, constraints, next action. Provenance on every line, so the receiver knows what to trust.',
    aside: 'The artifact, not a memory store you have to know how to query.',
  },
];

export default function HomePage() {
  return (
    <>
      <Tile surface="canvas" centered>
        <div className={styles.hero}>
          <p className={prose.eyebrow}>Project memory and handoff</p>
          <h1 className={prose.hero}>Your agent forgets.</h1>
          <p className={`${prose.lead} ${prose.centered}`}>
            Your teammate never knew. Mneia captures the decisions a session produced at the moment
            work stops, and hands them to whoever picks it up next.
          </p>
          <div className={`${prose.actions} ${prose.actionsCentered}`}>
            <ButtonPrimary href="#waitlist">Request access</ButtonPrimary>
            <ButtonSecondaryPill href="/handoff">See a real handoff</ButtonSecondaryPill>
          </div>
        </div>
      </Tile>

      <Tile surface="dark1" centered>
        <p className={prose.eyebrow}>The problem</p>
        <h2 className={prose.displayLg}>Three hours of context, gone by Tuesday.</h2>
        <div className={styles.scenario}>
          <p>
            A developer works with Claude Code or Cursor for three hours on Monday. They establish
            twenty decisions along the way: why Postgres over DynamoDB, which auth pattern, which
            edge cases are out of scope, what broke when they tried the obvious approach.
          </p>
          <p>
            <strong>On Tuesday they open a new session. The agent knows none of it.</strong> They
            spend the first fifteen minutes re-explaining.
          </p>
          <p>
            Worse: mid-session, auto-compaction fires. The agent silently loses the constraint
            established two hours ago and confidently proposes the approach that was already
            rejected.
          </p>
          <p>
            Worse still: a teammate picks up the work.{' '}
            <strong>
              The decisions live in a chat transcript that was compacted away, or in one
              person&apos;s head.
            </strong>
          </p>
        </div>
      </Tile>

      <Tile surface="canvas" centered>
        <p className={prose.eyebrow}>The artifact</p>
        <h2 className={prose.displayLg}>This is the thing we ship.</h2>
        <p className={`${prose.lead} ${prose.centered}`}>
          Not a memory store you query. An object you receive, with every line marked by who
          asserted it.
        </p>
        <div className={styles.artifactStage}>
          <HandoffArtifact highlightSuperseded />
        </div>
        <div className={`${prose.actions} ${prose.actionsCentered}`}>
          <ButtonSecondaryPill href="/handoff">Read it annotated</ButtonSecondaryPill>
        </div>
      </Tile>

      <Tile surface="parchment" wide centered>
        <p className={prose.eyebrow}>Three operations</p>
        <h2 className={prose.displayLg}>Everything else serves these.</h2>
        <CardGrid>
          {OPERATIONS.map((operation) => (
            <Card
              key={operation.title}
              index={operation.index}
              title={operation.title}
              aside={operation.aside}
            >
              <p>{operation.body}</p>
            </Card>
          ))}
        </CardGrid>
      </Tile>

      <Tile surface="dark1" centered>
        <p className={prose.eyebrow}>Where it runs</p>
        <h2 className={prose.displayLg}>In the tools you already work in.</h2>
        <div className={`${prose.body} ${prose.centered} ${prose.stack}`}>
          <p>
            An MCP server that works in Claude Code, Cursor, Codex, or any MCP client. A CLI. File
            interop with the AGENTS.md and CLAUDE.md you already keep. Plus a deliberately thin web
            app for the things a terminal is bad at.
          </p>
          <p>
            <strong>The inner loop stays in your terminal.</strong> A handoff that only works inside
            one vendor&apos;s tool is not a handoff, it is a session feature.
          </p>
        </div>
      </Tile>

      <Tile surface="canvas" centered id="waitlist">
        <div className={styles.waitlist}>
          <p className={prose.eyebrow}>Access</p>
          <h2 className={prose.displayLg}>Mneia is in private development.</h2>
          <p className={`${prose.lead} ${prose.centered}`}>
            There is no public build yet. Leave an address and you will hear once there is something
            worth your time.
          </p>
          <WaitlistForm />
        </div>
      </Tile>
    </>
  );
}
