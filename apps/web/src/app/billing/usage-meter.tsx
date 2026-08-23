import type { ReactNode } from 'react';
import type { UsageDial, UsageReport } from '../../server/billing/usage.js';
import styles from './Billing.module.css';

export interface UsageMeterProps {
  /** Null when the workspace could not be metered at all, which is a torn state, not zero usage. */
  readonly report: UsageReport | null;
}

/**
 * Warn and exhausted are said in words as well as drawn in the bar. A meter that changes
 * only its hue is invisible to a colourblind reader, so the note carries the state and the
 * hatch pattern gives it a second non-colour channel.
 */
type MeterState = 'ok' | 'warn' | 'exhausted';

const STATE_NOTES: Readonly<Record<MeterState, string | null>> = {
  ok: null,
  warn: 'Approaching the included allowance for this period.',
  exhausted: 'The included allowance for this period is used up.',
};

const count = (value: number): string => value.toLocaleString('en-US');

const day = (iso: string): string => iso.slice(0, 10);

/**
 * `percentUsed` is clamped to 100 upstream, so on its own it cannot tell "exactly at the
 * limit" from "well past it". The dials can. The test is on `fraction` rather than
 * `used > allowance` so that a zero allowance — spent by definition — reads as spent.
 */
const meterState = (report: UsageReport): MeterState => {
  if (
    [report.turns, report.extractions].some((dial) => dial.fraction !== null && dial.fraction >= 1)
  ) {
    return 'exhausted';
  }
  return report.warn ? 'warn' : 'ok';
};

const dialValue = (dial: UsageDial): string =>
  dial.allowance === null
    ? `${count(dial.used)} used, no limit`
    : `${count(dial.used)} of ${count(dial.allowance)}`;

const Meter = ({ report }: Readonly<{ report: UsageReport }>): ReactNode => {
  const percent = report.percentUsed;
  if (percent === null) {
    return <p className={styles.meterValue}>This plan has no usage limit.</p>;
  }

  const state = meterState(report);
  const note = STATE_NOTES[state];
  const valueText = `${percent}% of the included allowance used`;

  return (
    <div className={styles.meter}>
      <p className={styles.meterValue}>
        <strong>{percent}%</strong> of the included allowance used
      </p>
      <div
        className={styles.track}
        data-state={state}
        role="progressbar"
        aria-label="Included allowance used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={valueText}
      >
        <div className={styles.fill} data-state={state} style={{ width: `${percent}%` }} />
      </div>
      {note === null ? null : <p className={styles.meterNote}>{note}</p>}
    </div>
  );
};

/**
 * One percentage, tracking whichever of the two visible dials binds first. The embedding
 * dial is recorded for cost and is deliberately absent here — a customer cannot act on it.
 */
export function UsageMeter({ report }: UsageMeterProps): ReactNode {
  return (
    <section className={styles.card} aria-labelledby="workspace-usage">
      <h2 id="workspace-usage">Usage this period</h2>

      {report === null ? (
        <p>Usage for this period is unavailable.</p>
      ) : (
        <>
          <Meter report={report} />

          <dl className={styles.facts}>
            <div>
              <dt>Checkpoints</dt>
              <dd>{count(report.checkpoints)}</dd>
            </div>
            <div>
              <dt>Period resets</dt>
              <dd>
                <time dateTime={report.periodEnd}>{day(report.periodEnd)}</time>
              </dd>
            </div>
            <div>
              <dt>Turns</dt>
              <dd>{dialValue(report.turns)}</dd>
            </div>
            <div>
              <dt>Extractions</dt>
              <dd>{dialValue(report.extractions)}</dd>
            </div>
          </dl>

          <p className={styles.meterExplainer}>
            The percentage follows whichever of the two dials is closest to its limit.
          </p>
        </>
      )}
    </section>
  );
}
