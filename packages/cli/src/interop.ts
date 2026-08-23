import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { CliError } from './command.js';

export const FENCE_BEGIN = '<!-- mneia:begin -->';
export const FENCE_END = '<!-- mneia:end -->';

export const FENCE_BEGIN_PREFIX = '<!-- mneia:begin';

const DIGEST_LENGTH = 16;
const FENCE_BEGIN_PATTERN = new RegExp(
  `${FENCE_BEGIN_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: sha=([0-9a-f]{${DIGEST_LENGTH}}))? -->`,
);

export function digestOf(body: string): string {
  return createHash('sha256').update(body.trim(), 'utf8').digest('hex').slice(0, DIGEST_LENGTH);
}

export function fenceBeginFor(body: string): string {
  return `${FENCE_BEGIN_PREFIX} sha=${digestOf(body)} -->`;
}

export const AGENTS_FILE = 'AGENTS.md';
export const CLAUDE_FILE = 'CLAUDE.md';
export const CURSOR_RULES_PATH = '.cursor/rules';

export const INTEROP_SOURCE_PATHS = [AGENTS_FILE, CLAUDE_FILE, CURSOR_RULES_PATH] as const;

export const MAX_TITLE_LENGTH = 200;
export const MAX_IMPORTED_CONSTRAINTS = 200;

const MIN_CONSTRAINT_LENGTH = 4;
const CURSOR_RULE_EXTENSIONS: ReadonlySet<string> = new Set(['.md', '.mdc']);
const BULLET = /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s+(.*)$/;
const CODE_FENCE = /^ {0,3}(```|~~~)/;
const FRONTMATTER_DELIMITER = /^---\s*$/;
const HAS_WORD_CHARACTER = /[A-Za-z0-9]/;
const TERM_DEFINITION = /^(?:\*\*([^*]+)\*\*|`([^`]+)`)\s*[—–:-]\s+\S/;
const NORMATIVE =
  /(?:\b(?:never|must|always|cannot|shall|required|forbidden|only)\b|\bdo not\b|\bdon't\b|\bmay not\b)/i;
const SENTENCE_END = /[.!?]$/;
const MAX_TERM_WORDS = 4;

export interface InteropSource {
  readonly path: string;
  readonly text: string;
}

export interface ImportedConstraint {
  readonly title: string;
  readonly body: string | null;
  readonly sourceRef: string;
}

export interface InteropImport {
  readonly sources: readonly string[];
  readonly constraints: readonly ImportedConstraint[];
}

export interface GeneratedSectionInput {
  readonly workspace: string;
  readonly project: string;
  readonly endpoint: string;
  readonly constraintsImported: number;
  readonly sources: readonly string[];
}

export type WriteBackResult = 'created' | 'updated' | 'unchanged';

function isNotFound(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (cause as { code?: unknown }).code === 'ENOENT'
  );
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function unreadable(path: string, cause: unknown): CliError {
  return new CliError(
    'failed',
    `could not read ${path}: ${describeCause(cause)}`,
    'check the file permissions, then run mneia init again',
  );
}

export async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (cause) {
    if (isNotFound(cause)) {
      return null;
    }
    throw unreadable(path, cause);
  }
}

async function readCursorRules(repoRoot: string): Promise<InteropSource[]> {
  const root = join(repoRoot, '.cursor', 'rules');

  let info: Stats;
  try {
    info = await stat(root);
  } catch (cause) {
    if (isNotFound(cause)) {
      return [];
    }
    throw unreadable(root, cause);
  }

  if (info.isFile()) {
    const text = await readTextFile(root);
    return text === null ? [] : [{ path: CURSOR_RULES_PATH, text }];
  }
  if (!info.isDirectory()) {
    return [];
  }

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (cause) {
    throw unreadable(root, cause);
  }

  const names = entries
    .filter((name) => CURSOR_RULE_EXTENSIONS.has(extname(name).toLowerCase()))
    .sort();

  const sources: InteropSource[] = [];
  for (const name of names) {
    const text = await readTextFile(join(root, name));
    if (text !== null) {
      sources.push({ path: `${CURSOR_RULES_PATH}/${name}`, text });
    }
  }
  return sources;
}

export async function readInteropSources(repoRoot: string): Promise<readonly InteropSource[]> {
  const sources: InteropSource[] = [];

  for (const name of [AGENTS_FILE, CLAUDE_FILE]) {
    const text = await readTextFile(join(repoRoot, name));
    if (text !== null) {
      sources.push({ path: name, text });
    }
  }

  sources.push(...(await readCursorRules(repoRoot)));
  return sources;
}

const WHITESPACE_RUN = /\s+/;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateTitle(value: string): string {
  const clipped = value.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = clipped.lastIndexOf(' ');
  const cut = lastSpace > MAX_TITLE_LENGTH / 2 ? clipped.slice(0, lastSpace) : clipped;
  return `${cut.trimEnd()}…`;
}

interface PendingItem {
  readonly lines: string[];
  readonly line: number;
  readonly indent: number;
}

export function isTermDefinition(text: string): boolean {
  const match = TERM_DEFINITION.exec(text.trimStart());
  if (match === null) {
    return false;
  }

  const term = (match[1] ?? match[2] ?? '').trim();
  if (term === '' || SENTENCE_END.test(term)) {
    return false;
  }
  if (term.split(WHITESPACE_RUN).length > MAX_TERM_WORDS) {
    return false;
  }

  return !NORMATIVE.test(text);
}

function toConstraint(pending: PendingItem, path: string): ImportedConstraint | null {
  const text = pending.lines.join('\n').trim();
  if (text.length < MIN_CONSTRAINT_LENGTH || !HAS_WORD_CHARACTER.test(text)) {
    return null;
  }
  if (isTermDefinition(text)) {
    return null;
  }

  const whole = normalizeWhitespace(text);
  if (whole.length === 0) {
    return null;
  }

  const title = whole.length > MAX_TITLE_LENGTH ? truncateTitle(whole) : whole;
  return { title, body: whole === title ? null : whole, sourceRef: `${path}:${pending.line}` };
}

function skipFrontmatter(lines: readonly string[]): number {
  if (!FRONTMATTER_DELIMITER.test(lines[0] ?? '')) {
    return 0;
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (FRONTMATTER_DELIMITER.test(lines[index] ?? '')) {
      return index + 1;
    }
  }
  return 0;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

interface ScanState {
  codeToken: string | null;
  inGenerated: boolean;
}

function isIgnoredLine(line: string, state: ScanState): boolean {
  if (state.inGenerated) {
    state.inGenerated = !line.includes(FENCE_END);
    return true;
  }
  if (line.includes(FENCE_BEGIN_PREFIX)) {
    state.inGenerated = !line.includes(FENCE_END);
    return true;
  }

  const fence = CODE_FENCE.exec(line);
  if (fence === null) {
    return state.codeToken !== null;
  }

  const token = fence[1] ?? '';
  if (state.codeToken === null) {
    state.codeToken = token;
  } else if (state.codeToken === token) {
    state.codeToken = null;
  }
  return true;
}

function collectListItems(lines: readonly string[]): readonly PendingItem[] {
  const state: ScanState = { codeToken: null, inGenerated: false };
  const items: PendingItem[] = [];
  let pending: PendingItem | null = null;

  const close = (): void => {
    if (pending !== null) {
      items.push(pending);
      pending = null;
    }
  };

  for (let index = skipFrontmatter(lines); index < lines.length; index += 1) {
    const line = lines[index] ?? '';

    if (isIgnoredLine(line, state)) {
      close();
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet !== null) {
      close();
      pending = { lines: [(bullet[1] ?? '').trim()], line: index + 1, indent: indentOf(line) };
      continue;
    }

    if (pending !== null && line.trim().length > 0 && indentOf(line) > pending.indent) {
      pending.lines.push(line.trim());
      continue;
    }

    close();
  }

  close();
  return items;
}

export function extractConstraints(source: InteropSource): readonly ImportedConstraint[] {
  const constraints: ImportedConstraint[] = [];

  for (const item of collectListItems(source.text.split('\n'))) {
    const constraint = toConstraint(item, source.path);
    if (constraint !== null) {
      constraints.push(constraint);
    }
  }

  return constraints;
}

export async function importConstraints(repoRoot: string): Promise<InteropImport> {
  const sources = await readInteropSources(repoRoot);
  const constraints: ImportedConstraint[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    for (const constraint of extractConstraints(source)) {
      if (constraints.length >= MAX_IMPORTED_CONSTRAINTS) {
        break;
      }
      const key = constraint.title.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      constraints.push(constraint);
    }
    if (constraints.length >= MAX_IMPORTED_CONSTRAINTS) {
      break;
    }
  }

  return { sources: sources.map((source) => source.path), constraints };
}

function sanitizeInline(value: string): string {
  return normalizeWhitespace(value.replace(/[<>]/g, ''));
}

function describeImport(count: number, sources: readonly string[]): string {
  if (sources.length === 0) {
    return `No constraints were imported: this repository has no ${INTEROP_SOURCE_PATHS.join(', ')} to read.`;
  }
  const list = sources.join(', ');
  if (count === 0) {
    return `No constraints were imported from ${list}.`;
  }
  if (count === 1) {
    return `1 constraint was imported from ${list}.`;
  }
  return `${count} constraints were imported from ${list}.`;
}

export function renderGeneratedSection(input: GeneratedSectionInput): string {
  const workspace = sanitizeInline(input.workspace);
  const project = sanitizeInline(input.project);
  const endpoint = sanitizeInline(input.endpoint);

  return [
    'Generated by `mneia init`. Everything between the mneia markers is rewritten on every run;',
    'edit outside them.',
    '',
    '## Project memory',
    '',
    `This repository is bound to the Mneia project \`${workspace}/${project}\` on ${endpoint}.`,
    '',
    '- `mneia brief "<task>"` prints the context slice for the task you are about to start',
    '- `mneia checkpoint` records decisions, constraints, and open questions at a task boundary',
    '- `mneia log` prints the decision timeline for this project',
    '- `mneia status` prints what is stale, disputed, or unanswered',
    '',
    describeImport(input.constraintsImported, input.sources),
  ].join('\n');
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function corruptedFence(path: string, detail: string): CliError {
  return new CliError(
    'failed',
    `${path} has a damaged Mneia generated section: ${detail} — refusing to guess where it ends`,
    `restore the ${FENCE_BEGIN} / ${FENCE_END} pair by hand, or delete the whole generated block, then run mneia init again`,
  );
}

export function assertFenceIntact(text: string, path: string): void {
  const begins = countOccurrences(text, FENCE_BEGIN_PREFIX);
  const ends = countOccurrences(text, FENCE_END);

  if (begins === 0 && ends === 0) {
    return;
  }
  if (begins > 1 || ends > 1) {
    throw corruptedFence(
      path,
      `found ${begins} begin markers and ${ends} end markers, expected one of each`,
    );
  }
  if (ends === 0) {
    throw corruptedFence(path, `the ${FENCE_BEGIN} marker has no matching ${FENCE_END}`);
  }
  if (begins === 0) {
    throw corruptedFence(path, `the ${FENCE_END} marker has no matching ${FENCE_BEGIN}`);
  }
  if (text.indexOf(FENCE_END) < text.indexOf(FENCE_BEGIN_PREFIX)) {
    throw corruptedFence(path, 'the end marker comes before the begin marker');
  }
  if (FENCE_BEGIN_PATTERN.exec(text) === null) {
    throw corruptedFence(
      path,
      `the begin marker is not ${FENCE_BEGIN} and does not carry a readable sha= stamp`,
    );
  }
}

interface FenceLocation {
  readonly beginStart: number;
  readonly beginEnd: number;
  readonly endStart: number;
  readonly digest: string | null;
  readonly body: string;
}

function locateFence(text: string): FenceLocation | null {
  const match = FENCE_BEGIN_PATTERN.exec(text);
  const endStart = text.indexOf(FENCE_END);
  if (match === null || endStart < 0) {
    return null;
  }
  const beginEnd = match.index + match[0].length;
  return {
    beginStart: match.index,
    beginEnd,
    endStart,
    digest: match[1] ?? null,
    body: text.slice(beginEnd, endStart).trim(),
  };
}

export function assertGeneratedSectionUnedited(text: string, path: string): void {
  assertFenceIntact(text, path);

  const fence = locateFence(text);
  if (fence === null || fence.digest === null) {
    return;
  }
  if (digestOf(fence.body) === fence.digest) {
    return;
  }

  throw new CliError(
    'failed',
    `${path} has hand edits inside the Mneia generated section, and the next write would discard them`,
    `move what you want to keep outside the ${FENCE_BEGIN_PREFIX} ... ${FENCE_END} markers, or run mneia init --force to discard them`,
  );
}

function separatorFor(existing: string): string {
  if (existing.endsWith('\n\n')) {
    return '';
  }
  return existing.endsWith('\n') ? '\n' : '\n\n';
}

export function applyGeneratedSection(existing: string, body: string, path: string): string {
  if (body.includes(FENCE_BEGIN_PREFIX) || body.includes(FENCE_END)) {
    throw new CliError(
      'failed',
      'refusing to write a generated section whose body contains a Mneia fence marker',
      'this is a bug in mneia; report it rather than editing the section by hand',
    );
  }

  assertFenceIntact(existing, path);

  const trimmed = body.trim();
  const fenced = `${fenceBeginFor(trimmed)}\n${trimmed}\n${FENCE_END}`;
  const fence = locateFence(existing);

  if (fence === null) {
    return existing.length === 0
      ? `${fenced}\n`
      : `${existing}${separatorFor(existing)}${fenced}\n`;
  }

  return `${existing.slice(0, fence.beginStart)}${fenced}${existing.slice(fence.endStart + FENCE_END.length)}`;
}

export async function writeGeneratedSection(path: string, body: string): Promise<WriteBackResult> {
  const existing = await readTextFile(path);
  const next = applyGeneratedSection(existing ?? '', body, path);

  if (existing === next) {
    return 'unchanged';
  }

  try {
    await writeFile(path, next, 'utf8');
  } catch (cause) {
    throw new CliError(
      'failed',
      `could not write ${path}: ${describeCause(cause)}`,
      'check the file permissions on the repository root, then run mneia init again',
    );
  }

  return existing === null ? 'created' : 'updated';
}
