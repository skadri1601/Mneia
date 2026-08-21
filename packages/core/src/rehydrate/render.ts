import { sanitizeActorName, UNATTRIBUTED_ACTOR } from '../domain/attribution.js';
import type { ContextItem, Uuid } from '../domain/types.js';
import type { ItemKind } from '../store/schema.js';
import type { PackedSlice } from './types.js';

export interface RenderSliceInput {
  readonly task: string;
  readonly packed: PackedSlice;
  readonly generatedAt: Date;
}

interface SliceSection {
  readonly heading: string;
  readonly includes: (item: ContextItem) => boolean;
}

export const SHORT_ITEM_ID_MIN_LENGTH = 8;

const BODY_INDENT = '  ';
const META_SEPARATOR = ' · ';
const DISPUTED_MARKER = '**DISPUTED — unresolved, do not rely on this**';
const LOAD_BEARING_MARKER = '**LOAD-BEARING**';
const CITATION_HINT = 'Cite an item as `#id` when you use it.';

const LINE_BREAKS = /\r\n|\r/g;
const WHITESPACE_RUN = /\s+/g;
const HYPHENS = /-/g;
const ORDERED_LIST_START = /^(\d{1,9})([.)])/;
const BLOCK_MARKER_START = /^[#>*+=|~`_<-]/;

const isLive = (item: ContextItem): boolean =>
  item.status === 'active' || item.status === 'disputed';

const liveKind =
  (kind: ItemKind) =>
  (item: ContextItem): boolean =>
    isLive(item) && item.kind === kind;

const SECTIONS: readonly SliceSection[] = [
  { heading: 'Constraints (do not violate)', includes: liveKind('constraint') },
  { heading: 'Decisions and why', includes: liveKind('decision') },
  { heading: 'Open questions', includes: liveKind('open_question') },
  { heading: 'Facts', includes: liveKind('fact') },
  { heading: 'Superseded recently (do not re-propose)', includes: (item) => !isLive(item) },
  { heading: 'Artifacts', includes: liveKind('artifact_ref') },
];

export const SLICE_SECTION_HEADINGS: readonly string[] = SECTIONS.map((section) => section.heading);

export function shortenItemIds(ids: readonly Uuid[]): ReadonlyMap<Uuid, string> {
  const unique = [...new Set(ids)];
  const compact = new Map(unique.map((id) => [id, id.replace(HYPHENS, '')]));
  const longest = unique.reduce((max, id) => Math.max(max, (compact.get(id) ?? id).length), 0);

  for (let length = SHORT_ITEM_ID_MIN_LENGTH; length <= longest; length += 1) {
    const shortened = new Map<Uuid, string>();
    const taken = new Set<string>();

    for (const id of unique) {
      const short = (compact.get(id) ?? id).slice(0, length);
      if (taken.has(short)) {
        break;
      }
      taken.add(short);
      shortened.set(id, short);
    }

    if (shortened.size === unique.length) {
      return shortened;
    }
  }

  return compact;
}

function assertValidDate(value: Date, what: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new TypeError(`${what} must be a valid Date; received an Invalid Date`);
  }
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

const utcDay = (value: Date): string =>
  `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1, 2)}-${pad(value.getUTCDate(), 2)}`;

const utcMinute = (value: Date): string =>
  `${utcDay(value)} ${pad(value.getUTCHours(), 2)}:${pad(value.getUTCMinutes(), 2)} UTC`;

const inlineText = (value: string): string => value.replace(WHITESPACE_RUN, ' ').trim();

function escapeLineStart(line: string): string {
  if (ORDERED_LIST_START.test(line)) {
    return line.replace(ORDERED_LIST_START, '$1\\$2');
  }
  return BLOCK_MARKER_START.test(line) ? `\\${line}` : line;
}

const bodyLinesFor = (item: ContextItem): readonly string[] =>
  (item.body ?? '')
    .replace(LINE_BREAKS, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => `${BODY_INDENT}${escapeLineStart(line)}`);

function markersFor(item: ContextItem): readonly string[] {
  const markers: string[] = [];

  if (item.status === 'disputed') {
    markers.push(DISPUTED_MARKER);
  }
  if (item.loadBearing && isLive(item)) {
    markers.push(LOAD_BEARING_MARKER);
  }

  return markers;
}

function attributionFor(item: ContextItem): readonly string[] {
  const { provenance } = item;

  if (provenance === undefined) {
    return [UNATTRIBUTED_ACTOR, item.humanConfirmed ? 'human-confirmed' : 'unconfirmed'];
  }

  if (provenance.actorKind === 'human') {
    return [
      provenance.actorKind,
      sanitizeActorName(provenance.actorDisplayName),
      item.humanConfirmed ? 'confirmed' : 'asserted',
    ];
  }

  return [
    provenance.actorKind,
    sanitizeActorName(provenance.actorDisplayName),
    item.humanConfirmed ? 'human-confirmed' : 'unconfirmed',
  ];
}

function metaFor(item: ContextItem, shortIds: ReadonlyMap<Uuid, string>): string {
  const parts = [
    `#${shortIds.get(item.id) ?? item.id}`,
    utcDay(item.assertedAt),
    ...attributionFor(item),
  ];

  if (item.status === 'superseded' || item.status === 'retired') {
    parts.push(item.status);
  }

  return `[${parts.join(META_SEPARATOR)}]`;
}

function renderItem(item: ContextItem, shortIds: ReadonlyMap<Uuid, string>): string {
  const head = ['-', ...markersFor(item), metaFor(item, shortIds), inlineText(item.title)]
    .filter((part) => part !== '')
    .join(' ');

  return [head, ...bodyLinesFor(item)].join('\n');
}

function renderHeader(input: RenderSliceInput, itemCount: number): string {
  const task = inlineText(input.task);
  const meta = [
    `Generated ${utcMinute(input.generatedAt)}`,
    itemCount === 1 ? '1 item' : `${itemCount} items`,
    `${input.packed.tokensUsed}/${input.packed.tokenBudget} tokens`,
  ];

  const dropped = input.packed.droppedItemIds.length;
  if (dropped > 0) {
    meta.push(dropped === 1 ? '1 more not shown' : `${dropped} more not shown`);
  }

  const lines = [
    task === '' ? '# Context slice' : `# Context slice: ${task}`,
    meta.join(META_SEPARATOR),
  ];
  if (itemCount > 0) {
    lines.push(CITATION_HINT);
  }

  return lines.join('\n');
}

export function renderSlice(input: RenderSliceInput): string {
  assertValidDate(input.generatedAt, 'renderSlice generatedAt');

  const items = input.packed.items.map((scored) => scored.item);
  for (const item of items) {
    assertValidDate(item.assertedAt, `context_item ${item.id} assertedAt`);
  }

  const shortIds = shortenItemIds(items.map((item) => item.id));
  const blocks = [renderHeader(input, items.length)];

  for (const section of SECTIONS) {
    const matched = items.filter((item) => section.includes(item));
    if (matched.length === 0) {
      continue;
    }
    blocks.push(
      [`## ${section.heading}`, ...matched.map((item) => renderItem(item, shortIds))].join('\n'),
    );
  }

  return `${blocks.join('\n\n')}\n`;
}
