import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliError } from './command.js';
import {
  applyGeneratedSection,
  assertGeneratedSectionUnedited,
  digestOf,
  extractConstraints,
  FENCE_BEGIN,
  FENCE_BEGIN_PREFIX,
  fenceBeginFor,
  FENCE_END,
  type GeneratedSectionInput,
  importConstraints,
  readInteropSources,
  renderGeneratedSection,
  writeGeneratedSection,
} from './interop.js';

const SECTION: GeneratedSectionInput = {
  workspace: 'acme',
  project: 'checkout',
  endpoint: 'https://api.mneia.dev',
  constraintsImported: 3,
  sources: ['AGENTS.md'],
  sessionStartHooks: ['Claude Code', 'Codex', 'Cursor'],
};

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mne81-interop-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(relativePath: string, text: string): Promise<string> {
  const path = join(root, relativePath);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, text, 'utf8');
  return path;
}

function fenced(body: string): string {
  return `${fenceBeginFor(body)}\n${body}\n${FENCE_END}`;
}

describe('the generated section fence', () => {
  it('appends a fence to a file that has none, byte-for-byte preserving what was there', () => {
    const existing = '# Our repo\n\nHand written rules that we care about.\n';
    const next = applyGeneratedSection(existing, 'generated body', 'AGENTS.md');

    expect(next.startsWith(existing)).toBe(true);
    expect(next).toContain(FENCE_BEGIN_PREFIX);
    expect(next).toContain(FENCE_END);
    expect(next.slice(existing.length).trim()).toBe(fenced('generated body'));
  });

  it('preserves a file with no trailing newline and separates the fence from it', () => {
    const existing = '# Our repo';
    const next = applyGeneratedSection(existing, 'generated body', 'AGENTS.md');

    expect(next).toBe(`# Our repo\n\n${fenced('generated body')}\n`);
  });

  it('writes only the fence when the file is empty', () => {
    expect(applyGeneratedSection('', 'generated body', 'AGENTS.md')).toBe(
      `${fenced('generated body')}\n`,
    );
  });

  it('replaces only what is between the markers and leaves both sides byte-identical', () => {
    const prefix = '# Our repo\n\nHand written intro.\n\n';
    const suffix = '\n\n## Human written outro\n\nStill here.\n';
    const existing = `${prefix}${fenced('stale generated body')}${suffix}`;

    const next = applyGeneratedSection(existing, 'fresh generated body', 'AGENTS.md');

    expect(next).toBe(`${prefix}${fenced('fresh generated body')}${suffix}`);
    expect(next.startsWith(prefix)).toBe(true);
    expect(next.endsWith(suffix)).toBe(true);
    expect(next).not.toContain('stale generated body');
  });

  it('is byte-stable when applied repeatedly with the same body', () => {
    const existing = '# Our repo\n\nHand written rules.\n';
    const once = applyGeneratedSection(existing, 'generated body', 'AGENTS.md');
    const twice = applyGeneratedSection(once, 'generated body', 'AGENTS.md');
    const thrice = applyGeneratedSection(twice, 'generated body', 'AGENTS.md');

    expect(twice).toBe(once);
    expect(thrice).toBe(once);
    expect(twice.split(FENCE_BEGIN_PREFIX)).toHaveLength(2);
    expect(twice.split(FENCE_END)).toHaveLength(2);
  });

  it('refuses a begin marker with no end marker rather than guessing', () => {
    const existing = `# Our repo\n\n${FENCE_BEGIN}\nhalf a section\n`;

    expect(() => applyGeneratedSection(existing, 'body', 'AGENTS.md')).toThrowError(CliError);
    try {
      applyGeneratedSection(existing, 'body', 'AGENTS.md');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      const failure = error as CliError;
      expect(failure.kind).toBe('failed');
      expect(failure.message).toContain('AGENTS.md');
      expect(failure.message).toContain('no matching');
      expect(failure.fix).toContain('run mneia init again');
    }
  });

  it('refuses an end marker with no begin marker', () => {
    const existing = `# Our repo\n\nsome text\n${FENCE_END}\n`;

    expect(() => applyGeneratedSection(existing, 'body', 'AGENTS.md')).toThrowError(
      /no matching <!-- mneia:begin -->/,
    );
  });

  it('refuses an end marker that comes before the begin marker', () => {
    const existing = `${FENCE_END}\nupside down\n${FENCE_BEGIN}\n`;

    expect(() => applyGeneratedSection(existing, 'body', 'AGENTS.md')).toThrowError(
      /end marker comes before the begin marker/,
    );
  });

  it('refuses a file with duplicated markers', () => {
    const existing = `${fenced('one')}\n\n${fenced('two')}\n`;

    expect(() => applyGeneratedSection(existing, 'body', 'AGENTS.md')).toThrowError(
      /found 2 begin markers and 2 end markers/,
    );
  });

  it('refuses to write a body that itself contains a marker', () => {
    expect(() => applyGeneratedSection('', `evil ${FENCE_END} evil`, 'AGENTS.md')).toThrowError(
      /body contains a Mneia fence marker/,
    );
  });

  it('leaves a corrupted file untouched on disk', async () => {
    const damaged = `# Our repo\n\n${FENCE_BEGIN}\nhalf a section\n`;
    const path = await write('AGENTS.md', damaged);

    await expect(writeGeneratedSection(path, 'body')).rejects.toThrowError(CliError);
    await expect(readFile(path, 'utf8')).resolves.toBe(damaged);
  });

  it('reports created, updated, and unchanged as it writes', async () => {
    const path = join(root, 'AGENTS.md');

    await expect(writeGeneratedSection(path, 'first body')).resolves.toBe('created');
    await expect(writeGeneratedSection(path, 'second body')).resolves.toBe('updated');
    await expect(writeGeneratedSection(path, 'second body')).resolves.toBe('unchanged');
    await expect(readFile(path, 'utf8')).resolves.toContain('second body');
  });
});

describe('hand edits inside the fence', () => {
  const HUMAN_PREFIX = '# Our repo\n\nHand written intro.\n\n';
  const HUMAN_SUFFIX = '\n\n## Human written outro\n\nStill here.\n';

  function repoWithSection(body: string): string {
    return `${HUMAN_PREFIX}${fenced(body)}${HUMAN_SUFFIX}`;
  }

  it('stamps the begin marker with a digest of the body it wrote', () => {
    const text = applyGeneratedSection('', 'generated body', 'AGENTS.md');

    expect(text).toContain(`sha=${digestOf('generated body')}`);
    expect(() => assertGeneratedSectionUnedited(text, 'AGENTS.md')).not.toThrow();
  });

  it('detects a hand edit inside the fence rather than silently overwriting it', () => {
    const edited = repoWithSection('generated body').replace(
      'generated body',
      'generated body, plus a line a human added',
    );

    expect(() => assertGeneratedSectionUnedited(edited, 'AGENTS.md')).toThrowError(CliError);
    try {
      assertGeneratedSectionUnedited(edited, 'AGENTS.md');
      expect.unreachable('expected a CliError');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).message).toContain('hand edits inside');
      expect((error as CliError).fix).toContain('--force');
    }
  });

  it('accepts an untouched section, and one whose surrounding human text changed', () => {
    const text = repoWithSection('generated body');
    expect(() => assertGeneratedSectionUnedited(text, 'AGENTS.md')).not.toThrow();

    const editedOutside = text
      .replace('Hand written intro.', 'Hand written intro, revised.')
      .replace('Still here.', 'Still here, and edited.');
    expect(() => assertGeneratedSectionUnedited(editedOutside, 'AGENTS.md')).not.toThrow();
  });

  it('does not accuse a legacy section written before digests existed', () => {
    const legacy = `${HUMAN_PREFIX}${FENCE_BEGIN}\nwritten by an older mneia\n${FENCE_END}${HUMAN_SUFFIX}`;

    expect(() => assertGeneratedSectionUnedited(legacy, 'AGENTS.md')).not.toThrow();
  });

  it('upgrades a legacy section to a stamped one on the next write', () => {
    const legacy = `${HUMAN_PREFIX}${FENCE_BEGIN}\nwritten by an older mneia\n${FENCE_END}${HUMAN_SUFFIX}`;
    const next = applyGeneratedSection(legacy, 'fresh body', 'AGENTS.md');

    expect(next).toBe(repoWithSection('fresh body'));
    expect(next).toContain(`sha=${digestOf('fresh body')}`);
    expect(() => assertGeneratedSectionUnedited(next, 'AGENTS.md')).not.toThrow();
  });

  it('round-trips import, write back, and re-import with no duplicates or drift', async () => {
    await write('AGENTS.md', '# Our repo\n\n- Never commit secrets to the repository\n');

    const first = await importConstraints(root);
    expect(first.constraints).toHaveLength(1);

    const body = renderGeneratedSection({ ...SECTION, constraintsImported: 1 });
    const path = join(root, 'AGENTS.md');
    await expect(writeGeneratedSection(path, body)).resolves.toBe('updated');

    const second = await importConstraints(root);
    expect(second.constraints).toEqual(first.constraints);

    await expect(writeGeneratedSection(path, body)).resolves.toBe('unchanged');

    const third = await importConstraints(root);
    expect(third.constraints).toEqual(first.constraints);
    expect(() => assertGeneratedSectionUnedited(readFileSync(path, 'utf8'), path)).not.toThrow();
  });

  it('refuses the write when the file on disk has an edited section', async () => {
    const path = await write(
      'AGENTS.md',
      repoWithSection('generated body').replace('generated body', 'a human rewrote this'),
    );
    const before = await readFile(path, 'utf8');

    expect(() => assertGeneratedSectionUnedited(before, path)).toThrowError(CliError);
    await expect(readFile(path, 'utf8')).resolves.toBe(before);
  });
});

describe('constraint import', () => {
  it('reads AGENTS.md, CLAUDE.md, and .cursor/rules in that order', async () => {
    await write('AGENTS.md', '- from agents\n');
    await write('CLAUDE.md', '- from claude\n');
    await write('.cursor/rules/style.mdc', '- from cursor style\n');
    await write('.cursor/rules/api.md', '- from cursor api\n');
    await write('.cursor/rules/notes.txt', '- ignored, wrong extension\n');

    const sources = await readInteropSources(root);

    expect(sources.map((source) => source.path)).toEqual([
      'AGENTS.md',
      'CLAUDE.md',
      '.cursor/rules/api.md',
      '.cursor/rules/style.mdc',
    ]);
  });

  it('imports constraints from all three source kinds', async () => {
    await write('AGENTS.md', '# Rules\n\n- Never commit secrets\n');
    await write('CLAUDE.md', '- Always run the linter before pushing\n');
    await write(
      '.cursor/rules/style.mdc',
      '---\nglobs: "**/*.ts"\n---\n\n- Prefer named exports\n',
    );

    const imported = await importConstraints(root);

    expect(imported.sources).toEqual(['AGENTS.md', 'CLAUDE.md', '.cursor/rules/style.mdc']);
    expect(imported.constraints.map((constraint) => constraint.title)).toEqual([
      'Never commit secrets',
      'Always run the linter before pushing',
      'Prefer named exports',
    ]);
    expect(imported.constraints.map((constraint) => constraint.sourceRef)).toEqual([
      'AGENTS.md:3',
      'CLAUDE.md:1',
      '.cursor/rules/style.mdc:5',
    ]);
  });

  it('reads .cursor/rules when it is a single file rather than a directory', async () => {
    await write('.cursor/rules', '- Legacy single file rule\n');

    const imported = await importConstraints(root);

    expect(imported.sources).toEqual(['.cursor/rules']);
    expect(imported.constraints[0]?.title).toBe('Legacy single file rule');
  });

  it('returns nothing when the repo has none of the three sources', async () => {
    const imported = await importConstraints(root);

    expect(imported.sources).toEqual([]);
    expect(imported.constraints).toEqual([]);
  });

  it('deduplicates a constraint repeated across files, keeping the first source', async () => {
    await write('AGENTS.md', '- Never commit secrets\n');
    await write('CLAUDE.md', '- never commit secrets\n- Run the tests\n');

    const imported = await importConstraints(root);

    expect(imported.constraints).toHaveLength(2);
    expect(imported.constraints[0]?.sourceRef).toBe('AGENTS.md:1');
    expect(imported.constraints[1]?.title).toBe('Run the tests');
  });

  it('skips fenced code blocks, headings, prose, and rules', () => {
    const text = [
      '# Heading',
      '',
      'Some prose that is not a constraint.',
      '',
      '```sh',
      '- this is example output, not a rule',
      '```',
      '',
      '---',
      '',
      '- A genuine constraint',
    ].join('\n');

    const constraints = extractConstraints({ path: 'AGENTS.md', text });

    expect(constraints.map((constraint) => constraint.title)).toEqual(['A genuine constraint']);
  });

  it('never re-imports its own generated section', () => {
    const body = renderGeneratedSection(SECTION);
    const text = applyGeneratedSection('# Our repo\n\n- A human rule\n', body, 'AGENTS.md');

    const constraints = extractConstraints({ path: 'AGENTS.md', text });

    expect(constraints.map((constraint) => constraint.title)).toEqual(['A human rule']);
    expect(body).toContain('- `mneia brief');
  });

  it('reads a soft-wrapped bullet as one constraint, rather than cutting the title at the wrap', () => {
    const text = [
      '- Do not clobber user files',
      '  because it is an unrecoverable trust failure',
    ].join('\n');

    const constraints = extractConstraints({ path: 'AGENTS.md', text });

    expect(constraints[0]?.title).toBe(
      'Do not clobber user files because it is an unrecoverable trust failure',
    );
    expect(constraints[0]?.body).toBeNull();
  });

  it('never repeats the title in the body, so the rendered artifact does not print it twice', () => {
    const text = [
      '1. **Never auto-supersede a human-confirmed item with an agent assertion.** §10.1 — the word *ever*',
      '   is in the original. Needs a test, not a comment.',
    ].join('\n');

    const constraint = extractConstraints({ path: 'AGENTS.md', text })[0];

    expect(constraint?.title).toBe(
      '**Never auto-supersede a human-confirmed item with an agent assertion.** §10.1 — the word *ever* is in the original. Needs a test, not a comment.',
    );
    expect(constraint?.body).toBeNull();
  });

  it('truncates an overlong title but keeps the whole text in the body', () => {
    const long = `- ${'constraint '.repeat(40)}end`;

    const constraints = extractConstraints({ path: 'AGENTS.md', text: long });
    const constraint = constraints[0];

    expect(constraint?.title.length).toBeLessThanOrEqual(201);
    expect(constraint?.title.endsWith('…')).toBe(true);
    expect(constraint?.body).toContain('end');
  });

  it('accepts numbered lists and nested bullets', () => {
    const text = ['1. First rule', '2) Second rule', '- Third rule', '  - Nested rule'].join('\n');

    const constraints = extractConstraints({ path: 'AGENTS.md', text });

    expect(constraints.map((constraint) => constraint.title)).toEqual([
      'First rule',
      'Second rule',
      'Third rule',
      'Nested rule',
    ]);
  });
});

describe('the generated section body', () => {
  it('names the binding, the commands, and the import count without a timestamp', () => {
    const body = renderGeneratedSection(SECTION);

    expect(body).toContain('`acme/checkout`');
    expect(body).toContain('https://api.mneia.dev');
    expect(body).toContain('3 constraints were imported from AGENTS.md.');
    expect(body).not.toContain(FENCE_BEGIN_PREFIX);
    expect(body).not.toContain(FENCE_END);
  });

  it('says plainly when there was nothing to import', () => {
    const body = renderGeneratedSection({ ...SECTION, constraintsImported: 0, sources: [] });

    expect(body).toContain('No constraints were imported');
  });

  it('tells the agent rehydration is automatic only for the harnesses that got a hook', () => {
    const body = renderGeneratedSection({ ...SECTION, sessionStartHooks: ['Codex'] });

    expect(body).toContain('Codex has a hook installed');
    expect(body).not.toContain('Claude Code');
    expect(body).not.toContain('Cursor');
  });

  it('keeps the manual rehydration instruction when no hook was installed', () => {
    const body = renderGeneratedSection({ ...SECTION, sessionStartHooks: [] });

    expect(body).toContain('No session-start hook is installed');
    expect(body).toContain('mneia brief "<task>"');
    expect(body).toContain('mneia_rehydrate');
    expect(body).not.toContain('Nothing to run by hand');
  });

  it('strips angle brackets from the binding so a slug can never forge a marker', () => {
    const body = renderGeneratedSection({
      ...SECTION,
      project: `x<!-- mneia:end -->x`,
    });

    expect(body).not.toContain(FENCE_END);
    expect(() => applyGeneratedSection('', body, 'AGENTS.md')).not.toThrow();
  });
});

describe('term definitions are not constraints', () => {
  const titlesOf = (lines: readonly string[]): readonly string[] =>
    extractConstraints({ path: 'AGENTS.md', text: lines.join('\n') }).map(
      (constraint) => constraint.title,
    );

  it('skips the definition rows that a doc bullet list is made of', () => {
    expect(
      titlesOf([
        '- **Rehydrate** — assemble the minimal high-signal context slice for the next task',
        '- **Checkpoint** — capture decisions, constraints, and open questions at a boundary',
        '- **Sentry** — production errors. Pull and triage them directly.',
        '- **Vercel** — deploys, build logs, runtime errors, rollbacks.',
        '- `pnpm build` — tsc --build across packages',
      ]),
    ).toEqual([]);
  });

  it('keeps a rule whose subject happens to be bolded, because the clause is normative', () => {
    expect(
      titlesOf([
        '- **Do not charge for the individual tier.** §14.',
        '- **A ticket is Done only when its own Done when clause is satisfied** — not when the code is written',
        '- **Secrets** — never commit them, in any file',
        '- **Never commit secrets**, .env files, or user content',
      ]).length,
    ).toBe(4);
  });

  it('keeps an ordinary bullet that carries no bold lead at all', () => {
    expect(
      titlesOf(['- Match the conventions of surrounding code before introducing new ones.']),
    ).toEqual(['Match the conventions of surrounding code before introducing new ones.']);
  });
});
