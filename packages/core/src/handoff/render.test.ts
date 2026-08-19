import { describe, expect, it } from 'vitest';
import type { Actor, ContextItem, Project, Uuid } from '../domain/types.js';
import type { RenderHandoffInput } from './render.js';
import { HANDOFF_SECTION_HEADINGS, provenanceLine, renderHandoff } from './render.js';

const id = (prefix: string): Uuid => `${prefix}-1111-4111-8111-111111111111`;

const WORKSPACE = id('w0rkspac');
const HUMAN = id('human000');
const AGENT = id('agent000');
const CREATED_AT = new Date('2026-07-26T18:40:07.500Z');
const ASSERTED_AT = new Date('2026-07-14T09:30:00.000Z');
const SUPERSEDED_SINCE = new Date('2026-07-01T00:00:00.000Z');

const PROJECT: Project = {
  id: id('pr0ject0'),
  workspaceId: WORKSPACE,
  teamId: null,
  slug: 'payments-migration',
  repoUrl: null,
  createdAt: CREATED_AT,
};

const actor = (overrides: Partial<Actor>): Actor => ({
  id: HUMAN,
  workspaceId: WORKSPACE,
  kind: 'human',
  displayName: 'Saad',
  externalRef: null,
  createdAt: CREATED_AT,
  ...overrides,
});

const SAAD = actor({});
const CLAUDE = actor({ id: AGENT, kind: 'agent', displayName: 'claude-code' });

const contextItem = (overrides: Partial<ContextItem>): ContextItem => ({
  id: id('00000000'),
  workspaceId: WORKSPACE,
  projectId: PROJECT.id,
  kind: 'fact',
  title: 'Untitled',
  body: null,
  status: 'active',
  assertedBy: HUMAN,
  assertedAt: ASSERTED_AT,
  sourceSessionId: null,
  sourceRef: null,
  confidence: 0.8,
  humanConfirmed: false,
  loadBearing: false,
  lastVerifiedAt: null,
  decayAfter: null,
  validFrom: ASSERTED_AT,
  validTo: null,
  supersedesId: null,
  supersededById: null,
  accessScope: 'project',
  embedding: null,
  embeddingModel: null,
  supersedeReason: null,
  ...overrides,
});

const input = (overrides: Partial<RenderHandoffInput> = {}): RenderHandoffInput => ({
  project: PROJECT,
  from: SAAD,
  to: null,
  createdAt: CREATED_AT,
  nextAction:
    'Wire the retry path in `charges/worker.rb` to the new idempotency key. Nothing else is blocking.',
  items: [],
  actors: new Map([
    [HUMAN, SAAD],
    [AGENT, CLAUDE],
  ]),
  supersededSince: SUPERSEDED_SINCE,
  ...overrides,
});

describe('renderHandoff', () => {
  it('renders all eight sections even when the project has nothing in most of them', () => {
    const rendered = renderHandoff(input());

    expect(rendered).toContain('# Handoff: payments-migration');
    for (const heading of HANDOFF_SECTION_HEADINGS) {
      expect(rendered).toContain(`## ${heading}`);
    }
  });

  it('names the sender and the moment, and reports an unassigned handoff as open', () => {
    const rendered = renderHandoff(input());

    expect(rendered).toContain('From: Saad (human) · 2026-07-26 18:40 UTC');
    expect(rendered).toContain('To: open');
  });

  it('names the recipient when the handoff is addressed', () => {
    const rendered = renderHandoff(input({ to: CLAUDE }));

    expect(rendered).toContain('To: claude-code (agent)');
  });

  it('puts the next action first, immediately under the header', () => {
    const rendered = renderHandoff(input());
    const sections = HANDOFF_SECTION_HEADINGS.map((heading) => rendered.indexOf(`## ${heading}`));

    expect(sections[0]).toBe(rendered.indexOf('## Next action'));
    expect(sections).toEqual([...sections].sort((left, right) => left - right));
  });

  it('refuses a handoff with no next action, because it transfers nothing', () => {
    expect(() => renderHandoff(input({ nextAction: '   ' }))).toThrow(/transfers nothing/);
  });

  it('says so explicitly when a section is empty, rather than omitting the heading', () => {
    const rendered = renderHandoff(input());

    expect(rendered).toContain('## Constraints (do not violate)\nNo active constraints.');
    expect(rendered).toContain('## Open questions\nNone open.');
  });

  it('routes each item kind to its own section', () => {
    const rendered = renderHandoff(
      input({
        items: [
          contextItem({ id: id('fact0000'), kind: 'fact', title: 'Ledger writes are cut over' }),
          contextItem({
            id: id('c0nstr00'),
            kind: 'constraint',
            title: 'No downtime window',
          }),
          contextItem({
            id: id('decisi00'),
            kind: 'decision',
            title: 'Postgres advisory locks over Redis',
          }),
          contextItem({
            id: id('quest000'),
            kind: 'open_question',
            title: 'Who owns the backfill?',
          }),
          contextItem({ id: id('artifac0'), kind: 'artifact_ref', title: 'PR #2841' }),
        ],
      }),
    );

    const sectionOf = (title: string): string => {
      const blocks = rendered.split('\n## ');
      const found = blocks.find((block) => block.includes(title));
      return found === undefined ? '' : (found.split('\n')[0] ?? '');
    };

    expect(sectionOf('Ledger writes are cut over')).toBe('State');
    expect(sectionOf('No downtime window')).toBe('Constraints (do not violate)');
    expect(sectionOf('Postgres advisory locks over Redis')).toBe('Decisions and why');
    expect(sectionOf('Who owns the backfill?')).toBe('Open questions');
    expect(sectionOf('PR #2841')).toBe('Artifacts');
  });

  it('carries an item body as indented lines under its title', () => {
    const rendered = renderHandoff(
      input({
        items: [
          contextItem({
            kind: 'decision',
            title: 'Dual-read window set to 14 days, not 7',
            body: 'Rationale: month-end reconciliation needs a full cycle inside the window.',
          }),
        ],
      }),
    );

    expect(rendered).toContain(
      '  Rationale: month-end reconciliation needs a full cycle inside the window.',
    );
  });

  describe('the superseded block', () => {
    const superseded = (overrides: Partial<ContextItem> = {}) =>
      contextItem({
        kind: 'decision',
        status: 'superseded',
        title: 'Redis-based cutover lock',
        validTo: new Date('2026-07-11T12:00:00.000Z'),
        supersedeReason: 'see the advisory lock decision',
        ...overrides,
      });

    it('strikes the title through and says when and why it went', () => {
      const rendered = renderHandoff(input({ items: [superseded()] }));

      expect(rendered).toContain(
        '- ~~Redis-based cutover lock~~ superseded 2026-07-11, see the advisory lock decision.',
      );
    });

    it('drops an item superseded before the window, so the block stays recent', () => {
      const rendered = renderHandoff(
        input({ items: [superseded({ validTo: new Date('2026-06-01T00:00:00.000Z') })] }),
      );

      expect(rendered).not.toContain('Redis-based cutover lock');
      expect(rendered).toContain('Nothing superseded in this window.');
    });

    it('keeps a superseded item whose validTo was never set, rather than silently dropping it', () => {
      const rendered = renderHandoff(
        input({ items: [superseded({ validTo: null, supersedeReason: null })] }),
      );

      expect(rendered).toContain('- ~~Redis-based cutover lock~~ superseded.');
    });

    it('never lists a superseded item in its own kind section', () => {
      const rendered = renderHandoff(input({ items: [superseded()] }));

      expect(rendered).toContain('## Decisions and why\nNo decisions recorded.');
    });
  });

  describe('the provenance line', () => {
    it('reads a confirmed human assertion as confirmed, with the day', () => {
      const line = provenanceLine(contextItem({ humanConfirmed: true }), input());

      expect(line).toBe('[human · Saad · confirmed 2026-07-14]');
    });

    it('distinguishes a human assertion nobody confirmed', () => {
      const line = provenanceLine(contextItem({ humanConfirmed: false }), input());

      expect(line).toBe('[human · Saad · asserted 2026-07-14]');
    });

    it('reads an unconfirmed agent assertion as unconfirmed, and carries no date', () => {
      const line = provenanceLine(contextItem({ assertedBy: AGENT }), input());

      expect(line).toBe('[agent · claude-code · unconfirmed]');
    });

    it('marks an agent assertion a human confirmed, so the two are never conflated', () => {
      const line = provenanceLine(
        contextItem({ assertedBy: AGENT, humanConfirmed: true }),
        input(),
      );

      expect(line).toBe('[agent · claude-code · human-confirmed 2026-07-14]');
    });

    it('takes the actor kind from the resolved actor, never from the item', () => {
      const line = provenanceLine(contextItem({ assertedBy: AGENT }), input());

      expect(line).toContain('agent');
      expect(line).not.toContain('human');
    });

    it('refuses to render an item whose actor was not resolved, rather than guessing', () => {
      expect(() =>
        renderHandoff(input({ items: [contextItem({ assertedBy: id('miss0000') })] })),
      ).toThrow(/resolve the item's actors from the store/);
    });
  });

  it('refuses an invalid createdAt', () => {
    expect(() => renderHandoff(input({ createdAt: new Date('nope') }))).toThrow(/Invalid Date/);
  });
});
