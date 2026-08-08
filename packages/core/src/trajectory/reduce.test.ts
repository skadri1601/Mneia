import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_RESULT_CHARS, reduceTrajectory } from './reduce.js';
import { redactSecrets } from './secrets.js';
import type { Trajectory, TrajectoryTurn, TurnKind, TurnRole } from './types.js';

const turn = (ref: string, role: TurnRole, kind: TurnKind, text: string): TrajectoryTurn => ({
  ref,
  role,
  kind,
  text,
  toolName: null,
  at: null,
});

const trajectoryOf = (turns: readonly TrajectoryTurn[]): Trajectory => ({
  source: 'claude-code',
  sessionRef: 'session-1',
  cwd: 'C:\\repo',
  turns,
});

describe('redactSecrets', () => {
  it('redacts provider keys, bearer tokens, and private key blocks', () => {
    const cases: readonly [string, string][] = [
      ['sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123', 'anthropic-key'],
      ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'github-token'],
      ['AKIAIOSFODNN7EXAMPLE', 'aws-access-key'],
      ['xoxb-1234567890-abcdefghij', 'slack-token'],
      ['Authorization: Bearer abcdefghijklmnopqrstuvwxyz', 'bearer-token'],
      ['-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----', 'private-key'],
    ];

    for (const [input, label] of cases) {
      const result = redactSecrets(input);
      expect(result.redactions).toContain(label);
      expect(result.text).toContain(`[redacted:${label}]`);
    }
  });

  it('redacts the value of a secret-looking environment assignment', () => {
    const result = redactSecrets(
      'DATABASE_PASSWORD=hunter2hunter2\nPUBLIC_URL=https://example.com',
    );
    expect(result.text).toContain('[redacted:env-assignment]');
    expect(result.text).not.toContain('hunter2hunter2');
    expect(result.text).toContain('https://example.com');
  });

  it('redacts credentials embedded in a connection string', () => {
    const result = redactSecrets('postgres://app:s3cr3tpassword@db.example.com:5432/mneia');
    expect(result.text).not.toContain('s3cr3tpassword');
    expect(result.text).toContain('db.example.com');
  });

  it('redacts real service credentials found in transcripts', () => {
    const cases: readonly string[] = [
      'CLERK_SECRET_KEY=sk_live_04ei66Rn7Ruq4bwbWQ7cWLZdCQc4gAC9elpr4sXGqp',
      'RESEND_API_KEY="re_AUuVj1Cv_HgdjuiRFTwGpJEwvcLZyP6cb"',
      'postgresql://neondb_owner:npg_n0FkuWSix3Gz@ep-x.neon.tech/db',
      'POSTGRES_PASSWORD=postgres',
    ];
    for (const input of cases) {
      const result = redactSecrets(input);
      expect(result.redactions.length).toBeGreaterThan(0);
      expect(result.text).toContain('[redacted:');
    }
  });

  it('does not redact identifiers that merely contain a secret-sounding word', () => {
    const safe: readonly string[] = [
      'tokens: --editor-chrome: #1a1a1a;',
      'CANDIDATES_PER_1K_TOKENS = 40',
      'const heuristicTokenCounter: TokenCounter = createCounter()',
      'tokenizer: 349-373ms',
      'MNEIA_AUTH_URL=http://localhost:3210',
      'export const CREDENTIALS_ENV_VAR = MNEIA_TOKEN',
    ];
    for (const input of safe) {
      const result = redactSecrets(input);
      expect(result.text, `should not redact: ${input}`).toBe(input);
      expect(result.redactions).toHaveLength(0);
    }
  });

  it('leaves ordinary prose untouched', () => {
    const prose = 'We rejected Redis because the store must stay a single dependency.';
    const result = redactSecrets(prose);
    expect(result.text).toBe(prose);
    expect(result.redactions).toHaveLength(0);
  });
});

describe('reduceTrajectory', () => {
  it('keeps user and assistant prose verbatim', () => {
    const reduced = reduceTrajectory(
      trajectoryOf([
        turn('1', 'user', 'text', 'Use Postgres.'),
        turn('2', 'assistant', 'text', 'Agreed.'),
      ]),
    );
    expect(reduced.trajectory.turns.map((entry) => entry.text)).toEqual([
      'Use Postgres.',
      'Agreed.',
    ]);
    expect(reduced.truncatedTurns).toBe(0);
    expect(reduced.droppedTurns).toBe(0);
  });

  it('caps tool results and tool calls but keeps the turn', () => {
    const long = 'x'.repeat(DEFAULT_TOOL_RESULT_CHARS * 3);
    const reduced = reduceTrajectory(
      trajectoryOf([
        turn('1', 'user', 'text', 'Read the file.'),
        turn('2', 'user', 'tool_result', long),
      ]),
    );

    expect(reduced.trajectory.turns).toHaveLength(2);
    const result = reduced.trajectory.turns[1];
    expect(result?.text.length).toBeLessThan(long.length);
    expect(result?.text).toContain('truncated by mneia');
    expect(reduced.truncatedTurns).toBe(1);
  });

  it('redacts secrets before they can leave the machine', () => {
    const reduced = reduceTrajectory(
      trajectoryOf([turn('1', 'user', 'tool_result', 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuv')]),
    );
    expect(reduced.trajectory.turns[0]?.text).not.toContain('sk-abcdefghijklmnopqrstuv');
    expect(reduced.redactions.length).toBeGreaterThan(0);
  });

  it('drops tool results before tool calls, and thinking before prose', () => {
    const filler = 'y'.repeat(400);
    const reduced = reduceTrajectory(
      trajectoryOf([
        turn('1', 'user', 'text', 'The decision that matters.'),
        turn('2', 'assistant', 'thinking', filler),
        turn('3', 'assistant', 'tool_call', filler),
        turn('4', 'user', 'tool_result', filler),
        turn('5', 'assistant', 'text', 'The conclusion that matters.'),
      ]),
      { maxChars: 900, maxToolCallChars: 10_000, maxToolResultChars: 10_000 },
    );

    const kinds = reduced.trajectory.turns.map((entry) => entry.kind);
    expect(kinds).not.toContain('tool_result');
    expect(reduced.trajectory.turns.map((entry) => entry.text)).toContain(
      'The decision that matters.',
    );
    expect(reduced.trajectory.turns.map((entry) => entry.text)).toContain(
      'The conclusion that matters.',
    );
    expect(reduced.droppedTurns).toBeGreaterThan(0);
  });

  it('never drops a user prose turn, even under an impossible budget', () => {
    const reduced = reduceTrajectory(
      trajectoryOf([
        turn('1', 'user', 'text', 'a'.repeat(500)),
        turn('2', 'assistant', 'text', 'b'.repeat(500)),
        turn('3', 'user', 'text', 'c'.repeat(500)),
      ]),
      { maxChars: 10 },
    );

    const remaining = reduced.trajectory.turns;
    expect(remaining.every((entry) => entry.role === 'user' && entry.kind === 'text')).toBe(true);
    expect(remaining).toHaveLength(2);
  });

  it('reports how much it removed', () => {
    const reduced = reduceTrajectory(
      trajectoryOf([turn('1', 'user', 'tool_result', 'z'.repeat(5000))]),
    );
    expect(reduced.originalChars).toBe(5000);
    expect(reduced.reducedChars).toBeLessThan(reduced.originalChars);
  });
});
