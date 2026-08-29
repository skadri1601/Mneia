import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Slice } from '@mneia/core';
import { CliError, type CommandDefinition, type CommandInvocation, EXIT_OK } from '../command.js';
import { HOOK_CLIENTS, HOOK_DEADLINE_SECONDS, type HookClient } from '../hooks-config.js';
import { httpBriefApi } from '../http-api.js';
import type { BriefApi, ProjectConfigLoader } from './brief.js';
import { DEFAULT_TOKEN_BUDGET } from './brief.js';

const run = promisify(execFile);

export type StdinReader = () => Promise<string>;

/**
 * Captures the session that has just ended. Injected so the stop path is testable without
 * driving a real extraction, and so this file does not depend on the checkpoint command's
 * shape beyond "run it for this directory".
 */
export interface CheckpointRequest {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The harness, which is also the trajectory source it writes. */
  readonly client: HookClient;
  /**
   * The session that just ended, when the harness named one.
   *
   * Targeting matters: without it `mneia checkpoint` falls back to sweeping every recently
   * active session in the directory, so one agent finishing a turn would checkpoint the
   * transcripts of every other agent working the same repository - and pay for each.
   */
  readonly sessionRef: string | null;
}

export type CheckpointRunner = (request: CheckpointRequest) => Promise<void>;

export interface HookDeps {
  readonly api: BriefApi;
  readonly loadConfig: ProjectConfigLoader;
  readonly readStdin: StdinReader;
  readonly branchOf?: ((cwd: string) => Promise<string>) | undefined;
  readonly checkpoint?: CheckpointRunner | undefined;
}

const USAGE = 'mneia hook <session-start|stop> --client <claude-code|codex|cursor>';

/**
 * The payload a harness writes to the hook's stdin.
 *
 * Only the working directory is read, and the three clients disagree on where it lives:
 * Claude Code and Codex send `cwd`, Cursor sends `workspace_roots`. Everything else in the
 * payload - session ids, model names, prompt text - is deliberately ignored, because a
 * hook that reads more than it needs breaks when a client adds a field.
 */
interface HookPayload {
  readonly cwd?: unknown;
  readonly workspace_roots?: unknown;
  /**
   * Claude Code sets this when the turn it is ending was itself continued by a Stop hook.
   *
   * Checkpointing again there would checkpoint the checkpoint, and each one costs a paid
   * extraction, so this is the difference between a hook and a billing loop.
   */
  readonly stop_hook_active?: unknown;
  readonly session_id?: unknown;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function cwdFrom(payload: HookPayload | null, fallback: string): string {
  const direct = payload?.cwd;
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct;
  }
  const roots = payload?.workspace_roots;
  if (Array.isArray(roots)) {
    const first = roots.find((root) => typeof root === 'string' && root.trim().length > 0);
    if (typeof first === 'string') {
      return first;
    }
  }
  return fallback;
}

function readClient(flags: CommandInvocation['flags']): HookClient {
  const raw = flags.client;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new CliError(
      'usage',
      '--client names which harness is calling, and decides the envelope written back to it',
      `usage: ${USAGE}`,
    );
  }
  const client = raw.trim();
  if (!HOOK_CLIENTS.includes(client as HookClient)) {
    throw new CliError(
      'usage',
      `expected --client to be one of ${HOOK_CLIENTS.join(', ')}; received ${client}`,
      `usage: ${USAGE}`,
    );
  }
  return client as HookClient;
}

async function currentBranch(cwd: string): Promise<string> {
  try {
    const { stdout } = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    const branch = stdout.trim();
    return branch === 'HEAD' ? '' : branch;
  } catch {
    return '';
  }
}

/**
 * What the slice is asked to be relevant to, when nobody has stated a task.
 *
 * A session-start hook fires before the person has said what they are doing, so the branch
 * name is the only signal available - and on a repo following a ticket-per-branch
 * convention it is a good one. Ranking is semantic, so a vague task returns a general
 * slice rather than a wrong one.
 */
export function taskFor(branch: string): string {
  return branch.length > 0
    ? `continuing work on branch ${branch}`
    : 'starting a session in this repository';
}

/**
 * Wraps the slice in the envelope the calling harness understands.
 *
 * Claude Code and Codex share a shape verbatim; Cursor takes a flat, snake_cased field.
 * Anything not matching a client's schema is dropped silently by that client, which is why
 * this is keyed on an explicit flag rather than sniffed from the payload.
 */
export function envelopeFor(client: HookClient, context: string): string {
  if (client === 'cursor') {
    return JSON.stringify({ additional_context: context });
  }
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
  });
}

/**
 * Frames the slice core already rendered, for injection into a session that has not started.
 *
 * Deliberately not a second renderer: the body is `slice.renderedMarkdown` verbatim, and
 * everything around it is the provenance an injected block needs and an on-demand `mneia
 * brief` does not - what task it was assembled for, and that it came from project memory
 * rather than from the person about to type.
 */
export function renderInjectedContext(slice: Slice, task: string): string {
  const body = slice.renderedMarkdown.trim();
  if (body.length === 0 || slice.items.length === 0) {
    return [
      '## Project memory — empty',
      '',
      'Nothing is recorded for this project yet. Record decisions and constraints as they',
      'are made, with mneia_assert or `mneia checkpoint`, so the next session inherits them.',
    ].join('\n');
  }

  return [
    '## Project memory (loaded at session start)',
    '',
    `Task "${task}" · ${slice.items.length} items · ${slice.tokensUsed}/${slice.tokenBudget} tokens.`,
    '',
    body,
    '',
    '---',
    '',
    'This is what the project already decided. Rehydrate again when the task changes, and',
    'record new decisions as they are made rather than at the end.',
    '',
    `Slice id: ${slice.id}`,
  ].join('\n');
}

/**
 * What is injected when the slice could not be fetched.
 *
 * Saying nothing would be worse than saying this. The agent cannot tell an empty project
 * from an unreachable one, so a silent failure reads as "there are no constraints" and the
 * session proceeds confidently against rules it was never shown.
 */
export function unavailableNote(reason: string): string {
  return [
    '## Project memory — unavailable',
    '',
    `Session-start rehydration did not run: ${reason}`,
    '',
    'Work normally, but do not assume the constraints and decisions already recorded are in',
    'front of you. `mneia brief "<task>"` retries on demand.',
  ].join('\n');
}

const describe = (error: unknown): string => {
  if (error instanceof CliError) return error.message;
  return error instanceof Error ? error.message : String(error);
};

async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `the slice did not arrive within ${HOOK_DEADLINE_SECONDS}s, which is the budget a session start is allowed to spend waiting`,
              ),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createHookCommand(deps: HookDeps): CommandDefinition {
  const branchOf = deps.branchOf ?? currentBranch;
  const checkpointWith = deps.checkpoint ?? defaultCheckpoint;

  return {
    name: 'hook',
    summary: 'Run as a harness lifecycle hook. Invoked by the agent, not by hand.',
    usage: USAGE,
    async run(invocation: CommandInvocation): Promise<number> {
      const [event, ...extra] = invocation.args;
      if ((event !== 'session-start' && event !== 'stop') || extra.length > 0) {
        throw new CliError(
          'usage',
          `mneia hook expects exactly one event, session-start or stop; received ${event === undefined ? 'none' : [event, ...extra].join(' ')}`,
          USAGE,
        );
      }
      const client = readClient(invocation.flags);

      if (event === 'stop') {
        // Writes nothing to stdout. Claude Code reads a Stop hook's stdout as a directive,
        // so a slice printed here would be injected as if the agent had said it.
        try {
          const raw = await deps.readStdin().catch(() => '');
          const payload = asRecord(safeParse(raw)) as HookPayload | null;
          if (payload?.stop_hook_active === true) {
            return EXIT_OK;
          }
          const sessionId = payload?.session_id;
          await checkpointWith({
            cwd: cwdFrom(payload, invocation.io.cwd),
            env: invocation.io.env,
            client,
            sessionRef:
              typeof sessionId === 'string' && sessionId.trim().length > 0
                ? sessionId.trim()
                : null,
          });
        } catch (error) {
          // Same contract as session-start: never fail the harness. A checkpoint that could
          // not run is a lost capture, but a hook that exits non-zero is a broken session.
          invocation.io.stderr(`mneia: checkpoint on stop did not run - ${describe(error)}`);
        }
        return EXIT_OK;
      }

      // Everything past this point exits 0 and writes an envelope, whatever happens. A hook
      // that fails loudly blocks the session it was meant to improve, and a session-start
      // hook that can crash is one npm outage away from making the product unusable.
      let context: string;
      try {
        const raw = await deps.readStdin().catch(() => '');
        const payload = asRecord(safeParse(raw)) as HookPayload | null;
        const cwd = cwdFrom(payload, invocation.io.cwd);
        const config = await deps.loadConfig(cwd, invocation.io.env);
        const task = taskFor(await branchOf(cwd));
        const slice = await withDeadline(
          deps.api.rehydrate({ config, task, tokenBudget: DEFAULT_TOKEN_BUDGET }),
          HOOK_DEADLINE_SECONDS * 1000,
        );
        context = renderInjectedContext(slice, task);
      } catch (error) {
        context = unavailableNote(describe(error));
      }

      invocation.io.stdout(envelopeFor(client, context));
      return EXIT_OK;
    },
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const defaultReadStdin: StdinReader = async () => {
  if (process.stdin.isTTY === true) {
    return '';
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
};

const defaultLoadConfig: ProjectConfigLoader = async (cwd, env) => {
  const { requireProjectConfig } = await import('../config.js');
  return requireProjectConfig(cwd, env);
};

/**
 * Runs the shipped checkpoint command in-process for the hook's directory.
 *
 * In-process rather than spawning `mneia checkpoint`, because the hook cannot know which
 * binary it is: under npx there is no `mneia` on PATH once resolution ends, which is the
 * same failure the persisted hook command already has to work around.
 */
const defaultCheckpoint: CheckpointRunner = async ({ cwd, env, client, sessionRef }) => {
  const { checkpointCommand } = await import('./checkpoint.js');
  // A turn ending is a task boundary; there is no stop-specific trigger and adding one
  // would be a schema change to CHECKPOINT_TRIGGERS for no gain in meaning.
  const flags: Record<string, string | boolean> = { trigger: 'task_boundary' };
  if (sessionRef !== null) {
    flags.session = sessionRef;
    flags.source = client;
  }
  await checkpointCommand.run({
    args: [],
    flags,
    json: true,
    io: {
      cwd,
      env,
      // The harness shows a Stop hook's stderr and injects its stdout. Neither is wanted
      // for a capture nobody asked to watch, so both are dropped here and the outcome is
      // read from the store instead.
      stdout: () => {},
      stderr: () => {},
    },
  });
};

export const hookCommand: CommandDefinition = createHookCommand({
  api: httpBriefApi,
  loadConfig: defaultLoadConfig,
  readStdin: defaultReadStdin,
});
