import { HANDOFF, type Provenance } from '@/content/handoff';
import styles from './HandoffArtifact.module.css';

function Marker({ provenance, children }: { provenance: Provenance; children: string }) {
  const tone = provenance === 'agent' ? styles.agent : styles.human;
  return <span className={`${styles.marker} ${tone}`}>[{children}]</span>;
}

export function HandoffArtifact({
  highlightSuperseded = false,
}: {
  highlightSuperseded?: boolean;
}) {
  return (
    <div className={styles.panel}>
      <div className={styles.chrome}>{HANDOFF.path}</div>
      <div className={styles.scroll}>
        <div className={styles.body}>
          <div className={styles.title}># {HANDOFF.title}</div>
          <div className={styles.meta}>
            From: {HANDOFF.from} · {HANDOFF.sentAt}
          </div>
          <div className={styles.meta}>To: {HANDOFF.to}</div>

          <div className={styles.heading}>## Next action</div>
          <p>
            {HANDOFF.nextAction.lead}
            <code className={styles.code}>{HANDOFF.nextAction.code}</code>
            {HANDOFF.nextAction.tail}
          </p>

          <div className={styles.heading}>## State</div>
          {HANDOFF.state.map((line) => (
            <p key={line}>{line}</p>
          ))}

          <div className={styles.heading}>## Constraints (do not violate)</div>
          <ul className={styles.list}>
            {HANDOFF.constraints.map((item) => (
              <li className={styles.line} key={item.text}>
                <span className={styles.bullet}>-</span>
                <span>
                  <Marker provenance={item.provenance}>{item.marker}</Marker> {item.text}
                </span>
              </li>
            ))}
          </ul>

          <div className={styles.heading}>## Decisions and why</div>
          <ul className={styles.list}>
            {HANDOFF.decisions.map((item) => (
              <li className={styles.line} key={item.text}>
                <span className={styles.bullet}>-</span>
                <span>
                  <Marker provenance={item.provenance}>{item.marker}</Marker> {item.text}
                  <span className={styles.rationale}>{item.rationale}</span>
                </span>
              </li>
            ))}
          </ul>

          <div className={styles.heading}>## Open questions</div>
          <ul className={styles.list}>
            {HANDOFF.openQuestions.map((question) => (
              <li className={styles.line} key={question}>
                <span className={styles.bullet}>- [ ]</span>
                <span>{question}</span>
              </li>
            ))}
          </ul>

          <div className={highlightSuperseded ? styles.highlight : undefined}>
            <div className={styles.heading}>## Superseded recently (do not re-propose)</div>
            <ul className={styles.list}>
              {HANDOFF.superseded.map((item) => (
                <li className={styles.line} key={item.struck}>
                  <span className={styles.bullet}>-</span>
                  <span>
                    <span className={styles.struck}>~~{item.struck}~~</span>{' '}
                    <span className={styles.note}>{item.note}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className={styles.heading}>## Artifacts</div>
          <ul className={styles.list}>
            {HANDOFF.artifacts.map((artifact) => (
              <li className={styles.line} key={artifact}>
                <span className={styles.bullet}>-</span>
                <span>{artifact}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
