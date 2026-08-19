import type { Actor, ContextItem, Project, Uuid } from '../domain/types.js';
import type { ItemKind } from '../store/schema.js';

export interface RenderHandoffInput {
  readonly project: Project;
  readonly from: Actor;
  readonly to: Actor | null;
  readonly createdAt: Date;
  readonly nextAction: string;
  readonly items: readonly ContextItem[];
  readonly actors: ReadonlyMap<Uuid, Actor>;
  readonly supersededSince: Date;
}

interface HandoffSection {
  readonly heading: string;
  readonly empty: string;
  readonly includes: (item: ContextItem, input: RenderHandoffInput) => boolean;
  readonly render: (item: ContextItem, input: RenderHandoffInput) => string;
}

const META_SEPARATOR = ' · ';
const BODY_INDENT = '  ';
const OPEN_RECIPIENT = 'open';

const LINE_BREAKS = /\r\n|\r/g;
const WHITESPACE_RUN = /\s+/g;
const ORDERED_LIST_START = /^(\d{1,9})([.)])/;
const BLOCK_MARKER_START = /^[#>*+=|~`_<-]/;

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

const utcDay = (value: Date): string =>
  `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1, 2)}-${pad(value.getUTCDate(), 2)}`;

const utcMinute = (value: Date): string =>
  `${utcDay(value)} ${pad(value.getUTCHours(), 2)}:${pad(value.getUTCMinutes(), 2)} UTC`;

const inlineText = (value: string): string => value.replace(WHITESPACE_RUN, ' ').trim();

function assertValidDate(value: Date, what: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new TypeError(`${what} must be a valid Date; received an Invalid Date`);
  }
}

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

function actorFor(item: ContextItem, input: RenderHandoffInput): Actor {
  const actor = input.actors.get(item.assertedBy);
  if (actor === undefined) {
    throw new TypeError(
      `renderHandoff expected actors to carry every asserting actor; context_item ${item.id} was asserted by ${item.assertedBy} and no actor was supplied — resolve the item's actors from the store before rendering`,
    );
  }
  return actor;
}

export function provenanceLine(item: ContextItem, input: RenderHandoffInput): string {
  const actor = actorFor(item, input);
  const confirmation =
    actor.kind === 'human'
      ? item.humanConfirmed
        ? `confirmed ${utcDay(item.assertedAt)}`
        : `asserted ${utcDay(item.assertedAt)}`
      : item.humanConfirmed
        ? `human-confirmed ${utcDay(item.assertedAt)}`
        : 'unconfirmed';

  return `[${[actor.kind, inlineText(actor.displayName), confirmation].join(META_SEPARATOR)}]`;
}

const isLive = (item: ContextItem): boolean =>
  item.status === 'active' || item.status === 'disputed';

const liveKind =
  (kind: ItemKind) =>
  (item: ContextItem): boolean =>
    isLive(item) && item.kind === kind;

function renderItem(item: ContextItem, input: RenderHandoffInput): string {
  const head = ['-', provenanceLine(item, input), inlineText(item.title)].join(' ');
  return [head, ...bodyLinesFor(item)].join('\n');
}

function renderSuperseded(item: ContextItem, input: RenderHandoffInput): string {
  const when = item.validTo === null ? null : utcDay(item.validTo);
  const tail = [
    when === null ? 'superseded' : `superseded ${when}`,
    item.supersedeReason === null ? null : inlineText(item.supersedeReason),
  ]
    .filter((part): part is string => part !== null)
    .join(', ');

  return `- ~~${inlineText(item.title)}~~ ${tail}. ${provenanceLine(item, input)}`;
}

const supersededRecently = (item: ContextItem, input: RenderHandoffInput): boolean => {
  if (isLive(item)) {
    return false;
  }
  return item.validTo === null || item.validTo.getTime() >= input.supersededSince.getTime();
};

const SECTIONS: readonly HandoffSection[] = [
  {
    heading: 'Next action',
    empty: '',
    includes: () => false,
    render: () => '',
  },
  {
    heading: 'State',
    empty: 'Nothing recorded about the current state.',
    includes: liveKind('fact'),
    render: renderItem,
  },
  {
    heading: 'Constraints (do not violate)',
    empty: 'No active constraints.',
    includes: liveKind('constraint'),
    render: renderItem,
  },
  {
    heading: 'Decisions and why',
    empty: 'No decisions recorded.',
    includes: liveKind('decision'),
    render: renderItem,
  },
  {
    heading: 'Open questions',
    empty: 'None open.',
    includes: liveKind('open_question'),
    render: renderItem,
  },
  {
    heading: 'Superseded recently (do not re-propose)',
    empty: 'Nothing superseded in this window.',
    includes: supersededRecently,
    render: renderSuperseded,
  },
  {
    heading: 'Artifacts',
    empty: 'None linked.',
    includes: liveKind('artifact_ref'),
    render: renderItem,
  },
];

export const HANDOFF_SECTION_HEADINGS: readonly string[] = SECTIONS.map(
  (section) => section.heading,
);

function renderHeader(input: RenderHandoffInput): string {
  const from = `${inlineText(input.from.displayName)} (${input.from.kind})`;
  const to =
    input.to === null ? OPEN_RECIPIENT : `${inlineText(input.to.displayName)} (${input.to.kind})`;

  return [
    `# Handoff: ${inlineText(input.project.slug)}`,
    `From: ${from}${META_SEPARATOR}${utcMinute(input.createdAt)}`,
    `To: ${to}`,
  ].join('\n');
}

export function renderHandoff(input: RenderHandoffInput): string {
  assertValidDate(input.createdAt, 'renderHandoff createdAt');
  assertValidDate(input.supersededSince, 'renderHandoff supersededSince');

  const nextAction = inlineText(input.nextAction);
  if (nextAction === '') {
    throw new TypeError(
      'renderHandoff nextAction must name one concrete thing to do next; received an empty string — a handoff with no next action transfers nothing (§10.3)',
    );
  }

  for (const item of input.items) {
    assertValidDate(item.assertedAt, `context_item ${item.id} assertedAt`);
    if (item.validTo !== null) {
      assertValidDate(item.validTo, `context_item ${item.id} validTo`);
    }
  }

  const blocks = [renderHeader(input)];

  for (const section of SECTIONS) {
    if (section.heading === 'Next action') {
      blocks.push([`## ${section.heading}`, nextAction].join('\n'));
      continue;
    }

    const matched = input.items.filter((item) => section.includes(item, input));
    const body =
      matched.length === 0 ? [section.empty] : matched.map((item) => section.render(item, input));

    blocks.push([`## ${section.heading}`, ...body].join('\n'));
  }

  return `${blocks.join('\n\n')}\n`;
}
