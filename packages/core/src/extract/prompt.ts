import type { TrajectoryTurn } from '../trajectory/types.js';
import { DEFAULT_CONFIDENCE_FLOOR, DEFAULT_MAX_CANDIDATES } from './filter.js';
import { MAX_BODY_LENGTH, MAX_TITLE_LENGTH } from './schema.js';

export interface ExistingItemRef {
  readonly id: string;
  readonly title: string;
}

export interface ExtractionPromptInput {
  readonly turns: readonly TrajectoryTurn[];
  readonly existingItems: readonly ExistingItemRef[];
  /**
   * What the person said this session was about, from `mneia checkpoint -m`.
   *
   * The highest-signal input available and, until MNE-100, the only one thrown away: it was
   * stored on the checkpoint record and never shown to the model. A long session is split
   * across many requests, so without it each chunk guesses at the point of the session from
   * a window of a few thousand tokens.
   */
  readonly summary?: string | null | undefined;
  /**
   * Titles already proposed from earlier chunks of this same session.
   *
   * A decision opened in chunk 3 and settled in chunk 40 is invisible to both when the
   * chunks are judged as strangers. This is what lets the later chunk recognise it is
   * finishing something rather than starting it.
   */
  readonly foundSoFar?: readonly string[] | undefined;
}

export interface ExtractionPrompt {
  readonly system: string;
  readonly user: string;
}

export const EXISTING_ITEMS_HEADING = '## Already in project memory';
export const SUMMARY_HEADING = '## What this session was about';
export const FOUND_SO_FAR_HEADING = '## Already proposed from earlier in this session';
export const TRANSCRIPT_HEADING = '## Session transcript';

export const EXTRACTION_SYSTEM_PROMPT = `You extract durable project memory from a working session between people and AI coding agents.

You reply with one JSON object and nothing else — no prose, no markdown fence, no commentary:

{"candidates":[{"kind":"decision","title":"…","body":"…","rationale":"…","confidence":0.0,"loadBearing":false,"accessScope":"project","sourceRef":"…"}]}

{"candidates":[]} is a correct and common answer. Most conversation is not worth keeping.

## The five kinds

Every candidate is exactly one of these. If it fits none of them, it is not a candidate.

- "decision" — a choice that was made and settled, where an alternative was available and was not taken. "We will use Postgres and not add Redis." A proposal nobody accepted is not a decision; an unresolved argument is an open_question.
- "constraint" — a rule that later work must not violate, stated as a prohibition or a requirement. "Rehydration must stay under 300ms." "Never log user content." A constraint outlives the task that produced it.
- "open_question" — something unresolved that nobody currently owns, which will have to be answered before the work is finished. "We have not decided how to shard the event table." A question somebody answered later in the same session is not open.
- "fact" — stable state worth carrying forward that is neither a choice nor a rule. "The staging database runs Postgres 18." A fact is true independently of anyone's intent, and stays true after the session ends.
- "artifact_ref" — a pointer to something outside the transcript that later work will need to find: a pull request, a ticket key, a document, a file path, a URL. The title names what it is; the body says why it matters.

## Every decision carries its reason

A "decision" candidate MUST have a non-null "rationale" naming why the choice was made and, where the transcript says so, what was rejected and why.

"We rejected Redis" without the reason does not stop anyone proposing Redis again next week, which is the entire point of recording it. If the transcript does not contain the reason, the decision is not extractable — omit it rather than invent one or guess.

"rationale" on the other kinds is optional but valuable: for a constraint it is what breaks if the rule is broken.

## Quality is a filter on kind, not a quota on count

A checkpoint that surfaces forty pieces of conversational filler trains the reader to stop reviewing, and a reader who stops reviewing is worse than one who never saw the item. So the bar below is about *what kind of thing* is worth keeping.

It is not a reason to stay silent about real work. You are reading one window of a session that may be split across many, and a window holding six settled decisions should return six. Downstream machinery you cannot see already removes duplicates, discards anything under ${DEFAULT_CONFIDENCE_FLOOR} confidence, and decides which items a human is asked to confirm — so a real decision you withhold is not filtered, it is lost, and nothing downstream can recover it.

So:

- Reject conversational filler aggressively. Greetings, thanks, acknowledgements, "sounds good", status narration, restatements of what the agent just did, and summaries of the conversation itself are never candidates.
- Reject anything that only makes sense with the transcript in front of you. Each title must still read correctly in six weeks with no surrounding context.
- Reject work log entries. "Fixed the failing test" is not a fact; "The test suite requires a running Postgres" is.
- When you are unsure whether something is filler, leave it out. When you are sure it is a real decision, constraint, or open question but unsure whether it is already known, emit it with honest confidence — that judgement is made downstream with the whole project in view, and yours is made through one window.
- Emit at most ${DEFAULT_MAX_CANDIDATES} candidates from this window. Anything below ${DEFAULT_CONFIDENCE_FLOOR} confidence is discarded downstream, so emitting it only costs tokens.

## Fields

- "title" — one line, at most ${MAX_TITLE_LENGTH} characters, written to be read cold, long after the session. Not a topic label: state the substance. "Use Postgres for the store rather than adding Redis", not "Database discussion".
- "body" — supporting detail, at most ${MAX_BODY_LENGTH} characters, or null when the title already says everything. Never pad it.
- "rationale" — why, in the participants' own reasoning. Required on every decision, null when the transcript genuinely does not say.
- "confidence" — 0 to 1, how sure you are that this was really settled and is really worth keeping. Be honest and be harsh; confidence is not enthusiasm.
- "loadBearing" — true only when later work is actively wrong if this item is missing. A load-bearing candidate is held for a human to confirm before anything is written, so marking a merely interesting item load-bearing spends a person's attention. Most candidates are false.
- "accessScope" — one of "private", "project", "team", "workspace". Use "project" unless the transcript plainly says otherwise. Never propose "restricted"; that scope needs grants only a human can assign.
- "sourceRef" — the "ref" of the transcript turn this came from, so a reader can go back to it. Use null if you cannot attribute it to one turn.

## What you do not do

- Do not decide whether a candidate replaces, contradicts, or supersedes anything already in project memory. That arbitration is somebody else's job and it is not yours to pre-empt. Emit the candidate on its own terms.
- Do not use the "Already in project memory" list to decide what to withhold. It is context, not a prohibition: a candidate matching it is removed downstream by an exact comparison you do not have to perform, whereas one you suppress because it *looked* familiar is gone for good. When this session restates something on that list, emit it — the restatement is how a stale item gets confirmed, refined, or contradicted, and none of that can happen if it never arrives.
- Do not invent, extrapolate, or smooth over. Every candidate must be supported by what the transcript actually says.
- Do not copy secrets, credentials, tokens, or connection strings into any field.
- Do not emit any field not listed above.`;

function renderExistingItems(items: readonly ExistingItemRef[]): string {
  if (items.length === 0) {
    return `${EXISTING_ITEMS_HEADING}\n\nNothing is recorded for this project yet. Everything worth keeping is new.`;
  }

  // Titles only. The id is never referenced back: no candidate field names an existing
  // item, and the instruction below tells the model not to judge replacement, so a
  // rendered UUID cost about 20 tokens each and nothing ever read one.
  const lines = items.map((item) => `- ${item.title}`);
  return [
    EXISTING_ITEMS_HEADING,
    '',
    'These are already recorded, and are here so you can tell what is new. They are not a list of things to avoid: an exact-match pass downstream removes anything that merely repeats one of them, and it cannot recover what you decline to emit. If this session settles, changes, or contradicts one of these, emit it.',
    '',
    ...lines,
  ].join('\n');
}

function renderSummary(summary: string | null | undefined): string | null {
  const stated = summary?.trim() ?? '';
  if (stated === '') {
    return null;
  }
  return [
    SUMMARY_HEADING,
    '',
    'Written by the person who ran this session. It is what they thought mattered, so treat it as the thesis this window is one part of — but extract only what the transcript below actually supports.',
    '',
    stated,
  ].join('\n');
}

function renderFoundSoFar(found: readonly string[] | undefined): string | null {
  if (found === undefined || found.length === 0) {
    return null;
  }
  return [
    FOUND_SO_FAR_HEADING,
    '',
    'Earlier windows of this same session already proposed these. Do not repeat one unchanged; do emit the finished version when this window is where it was settled, and say so in the rationale.',
    '',
    ...found.map((title) => `- ${title}`),
  ].join('\n');
}

export function renderTurn(turn: TrajectoryTurn): string {
  const tool = turn.toolName === null ? '' : ` tool="${turn.toolName}"`;
  return `<turn ref="${turn.ref}" role="${turn.role}" kind="${turn.kind}"${tool}>\n${turn.text}\n</turn>`;
}

function renderTranscript(turns: readonly TrajectoryTurn[]): string {
  if (turns.length === 0) {
    return `${TRANSCRIPT_HEADING}\n\nThe session has no turns. Return {"candidates":[]}.`;
  }

  return [
    TRANSCRIPT_HEADING,
    '',
    'Turns are in order. Attribute each candidate to a turn with "sourceRef".',
    '',
    ...turns.map(renderTurn),
  ].join('\n');
}

export function buildExtractionPrompt(input: ExtractionPromptInput): ExtractionPrompt {
  // Existing items stay first and the transcript stays last. The provider caches on a byte
  // -stable prefix keyed per project, and that block is the only part identical across every
  // checkpoint in a project — moving the per-session sections ahead of it would cost the
  // cache discount on every request.
  const sections = [
    renderExistingItems(input.existingItems),
    renderSummary(input.summary),
    renderFoundSoFar(input.foundSoFar),
    renderTranscript(input.turns),
  ].filter((section): section is string => section !== null);

  return {
    system: EXTRACTION_SYSTEM_PROMPT,
    user: sections.join('\n\n'),
  };
}
