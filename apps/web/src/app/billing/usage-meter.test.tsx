import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { UsageDial, UsageReport } from '../../server/billing/usage.js';
import { UsageMeter } from './usage-meter.js';

/**
 * A fake, not a call into `usageReport`. The page is being proved here, not the arithmetic,
 * and the states that matter — uncapped, exhausted, torn — are awkward to reach from a
 * real quota row.
 */
const dial = (used: number, allowance: number | null): UsageDial => ({
  used,
  allowance,
  fraction: allowance === null ? null : allowance === 0 ? 1 : used / allowance,
});

const BASE: UsageReport = {
  plan: 'pro',
  periodStart: '2026-08-01T00:00:00.000Z',
  periodEnd: '2026-09-01T00:00:00.000Z',
  turns: dial(0, 272_000),
  extractions: dial(0, 1_700),
  embeddingTokens: dial(1_234_567, 2_720_000),
  checkpoints: 0,
  percentUsed: 0,
  warn: false,
};

const render = (report: UsageReport | null): string =>
  renderToStaticMarkup(<UsageMeter report={report} />);

describe('UsageMeter', () => {
  test('shows one percentage, the checkpoint count, and the period reset date', () => {
    const markup = render({
      ...BASE,
      turns: dial(40_800, 272_000),
      extractions: dial(255, 1_700),
      checkpoints: 41,
      percentUsed: 15,
    });

    expect(markup).toContain('Usage this period');
    expect(markup).toContain('15%');
    expect(markup).toContain('Checkpoints');
    expect(markup).toContain('41');
    expect(markup).toContain('Period resets');
    expect(markup).toContain('2026-09-01');
    expect(markup).toContain('aria-valuenow="15"');
    expect(markup).toContain('aria-valuetext="15% of the included allowance used"');
  });

  test('shows the two visible dials against their allowances', () => {
    const markup = render({
      ...BASE,
      turns: dial(40_800, 272_000),
      extractions: dial(255, 1_700),
      percentUsed: 15,
    });

    expect(markup).toContain('40,800 of 272,000');
    expect(markup).toContain('255 of 1,700');
    expect(markup).toContain('closest to its limit');
  });

  test('never shows the embedding dial, which is recorded and not a customer number', () => {
    const markup = render({ ...BASE, percentUsed: 15 });

    expect(markup).not.toMatch(/embedding/i);
    expect(markup).not.toContain('1,234,567');
    expect(markup).not.toContain('2,720,000');
  });

  test('renders a new workspace at zero with no alarm attached to it', () => {
    const markup = render(BASE);

    expect(markup).toContain('0%');
    expect(markup).toContain('data-state="ok"');
    expect(markup).toContain('style="width:0%"');
    expect(markup).not.toContain('Approaching');
    expect(markup).not.toContain('used up');
  });

  test('states the warn threshold in words, not in colour alone', () => {
    const markup = render({
      ...BASE,
      turns: dial(223_040, 272_000),
      checkpoints: 300,
      percentUsed: 82,
      warn: true,
    });

    expect(markup).toContain('Approaching the included allowance for this period.');
    expect(markup).toContain('data-state="warn"');
    expect(markup).toContain('aria-valuenow="82"');
  });

  test('reads a workspace past its allowance as spent rather than merely approaching', () => {
    const markup = render({
      ...BASE,
      extractions: dial(1_900, 1_700),
      checkpoints: 1_900,
      percentUsed: 100,
      warn: true,
    });

    expect(markup).toContain('The included allowance for this period is used up.');
    expect(markup).toContain('data-state="exhausted"');
    expect(markup).not.toContain('Approaching');
    expect(markup).toContain('aria-valuenow="100"');
    expect(markup).toContain('style="width:100%"');
    expect(markup).toContain('1,900 of 1,700');
  });

  test('treats a zero allowance as spent instead of dividing by it', () => {
    const markup = render({
      ...BASE,
      extractions: dial(0, 0),
      percentUsed: 100,
      warn: true,
    });

    expect(markup).toContain('The included allowance for this period is used up.');
    expect(markup).not.toContain('NaN');
    expect(markup).not.toContain('Infinity');
  });

  test('draws no bar for an uncapped plan instead of a bar at null percent', () => {
    const markup = render({
      ...BASE,
      plan: 'enterprise',
      turns: dial(512_000, null),
      extractions: dial(3_200, null),
      embeddingTokens: dial(1_234_567, null),
      checkpoints: 3_200,
      percentUsed: null,
      warn: false,
    });

    expect(markup).toContain('This plan has no usage limit.');
    expect(markup).not.toContain('role="progressbar"');
    expect(markup).not.toContain('null');
    expect(markup).not.toContain('NaN');
    expect(markup).toContain('512,000 used, no limit');
    expect(markup).toContain('3,200 used, no limit');
    expect(markup).toContain('2026-09-01');
  });

  test('says so plainly when the workspace could not be metered at all', () => {
    const markup = render(null);

    expect(markup).toContain('Usage this period');
    expect(markup).toContain('Usage for this period is unavailable.');
    expect(markup).not.toContain('role="progressbar"');
    expect(markup).not.toContain('%');
  });

  test('labels the bar for a screen reader without borrowing the heading', () => {
    const markup = render({ ...BASE, percentUsed: 15 });

    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-label="Included allowance used"');
    expect(markup).toContain('aria-valuemin="0"');
    expect(markup).toContain('aria-valuemax="100"');
  });
});
