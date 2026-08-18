import { emitKeypressEvents } from 'node:readline';
import { plainTheme, type Theme } from './session-theme.js';

export interface CompletionItem {
  readonly name: string;
  readonly summary: string;
  readonly requiresArgument: boolean;
}

export interface Key {
  readonly name: string;
  readonly sequence: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
}

export interface EditorState {
  readonly line: string;
  readonly cursor: number;
  readonly matches: readonly CompletionItem[];
  readonly selected: number;
  readonly dismissed: boolean;
  readonly historyIndex: number;
  readonly draft: string;
}

export type EditorEffect =
  | { readonly kind: 'none' }
  | { readonly kind: 'submit'; readonly value: string }
  | { readonly kind: 'interrupt' }
  | { readonly kind: 'eof' }
  | { readonly kind: 'clear' };

export interface EditorStep {
  readonly state: EditorState;
  readonly effect: EditorEffect;
}

export const MENU_ROWS = 8;

const ESC = String.fromCharCode(27);
const OPTIONAL_GROUP = /\[[^\]]*\]/g;
const WORD_TAIL = /\s*\S+$/;
const DEL = String.fromCharCode(127);

export function requiresArgument(usage: string): boolean {
  return usage.replace(OPTIONAL_GROUP, '').includes('<');
}

export function matchesFor(
  line: string,
  items: readonly CompletionItem[],
): readonly CompletionItem[] {
  if (!line.startsWith('/') || /\s/.test(line)) {
    return [];
  }
  const prefix = line.slice(1).toLowerCase();
  return items.filter((item) => item.name.startsWith(prefix));
}

export function emptyState(): EditorState {
  return {
    line: '',
    cursor: 0,
    matches: [],
    selected: 0,
    dismissed: false,
    historyIndex: -1,
    draft: '',
  };
}

function withLine(
  state: EditorState,
  line: string,
  cursor: number,
  items: readonly CompletionItem[],
): EditorState {
  return {
    ...state,
    line,
    cursor: Math.max(0, Math.min(cursor, line.length)),
    matches: matchesFor(line, items),
    selected: 0,
    dismissed: false,
  };
}

export function menuVisible(state: EditorState): boolean {
  return !state.dismissed && state.matches.length > 0;
}

export function selectedItem(state: EditorState): CompletionItem | null {
  if (!menuVisible(state)) {
    return null;
  }
  return state.matches[state.selected] ?? null;
}

export function ghostFor(state: EditorState): string {
  const item = selectedItem(state);
  if (item === null || state.cursor !== state.line.length) {
    return '';
  }
  return item.name.slice(state.line.length - 1);
}

function complete(
  state: EditorState,
  item: CompletionItem,
  items: readonly CompletionItem[],
): EditorState {
  const line = `/${item.name}${item.requiresArgument ? ' ' : ''}`;
  return { ...withLine(state, line, line.length, items), matches: [], dismissed: true };
}

function recallHistory(
  state: EditorState,
  history: readonly string[],
  step: number,
  items: readonly CompletionItem[],
): EditorState {
  const index = state.historyIndex + step;
  if (index < -1 || index >= history.length) {
    return state;
  }
  const draft = state.historyIndex === -1 ? state.line : state.draft;
  const line = index === -1 ? draft : (history[index] ?? '');
  return {
    ...withLine(state, line, line.length, items),
    matches: [],
    dismissed: true,
    historyIndex: index,
    draft,
  };
}

function printable(key: Key): string {
  if (key.ctrl || key.meta || key.sequence.length === 0 || key.sequence.includes(ESC)) {
    return '';
  }
  return [...key.sequence].filter((character) => character >= ' ' && character !== DEL).join('');
}

function deleteWordBefore(state: EditorState, items: readonly CompletionItem[]): EditorState {
  const before = state.line.slice(0, state.cursor);
  const kept = before.replace(WORD_TAIL, '');
  return withLine(state, kept + state.line.slice(state.cursor), kept.length, items);
}

function submitOrComplete(state: EditorState, items: readonly CompletionItem[]): EditorStep | null {
  const item = selectedItem(state);
  if (item === null) {
    return null;
  }
  if (state.line.slice(1).toLowerCase() === item.name) {
    return null;
  }
  const completed = complete(state, item, items);
  if (item.requiresArgument) {
    return { state: completed, effect: { kind: 'none' } };
  }
  return { state: completed, effect: { kind: 'submit', value: completed.line } };
}

export interface ReduceDeps {
  readonly items: readonly CompletionItem[];
  readonly history: readonly string[];
}

function reduceControl(state: EditorState, key: Key, deps: ReduceDeps): EditorStep | null {
  const { items } = deps;

  if (key.ctrl && key.name === 'c') {
    return { state: emptyState(), effect: { kind: 'interrupt' } };
  }
  if (key.ctrl && key.name === 'd') {
    if (state.line.length === 0) {
      return { state, effect: { kind: 'eof' } };
    }
    return {
      state: withLine(
        state,
        state.line.slice(0, state.cursor) + state.line.slice(state.cursor + 1),
        state.cursor,
        items,
      ),
      effect: { kind: 'none' },
    };
  }
  if (key.ctrl && key.name === 'l') {
    return { state, effect: { kind: 'clear' } };
  }
  if (key.ctrl && key.name === 'u') {
    return {
      state: withLine(state, state.line.slice(state.cursor), 0, items),
      effect: { kind: 'none' },
    };
  }
  if (key.ctrl && key.name === 'k') {
    return {
      state: withLine(state, state.line.slice(0, state.cursor), state.cursor, items),
      effect: { kind: 'none' },
    };
  }
  if (key.ctrl && key.name === 'w') {
    return { state: deleteWordBefore(state, items), effect: { kind: 'none' } };
  }
  return null;
}

function reduceVertical(state: EditorState, key: Key, deps: ReduceDeps): EditorStep | null {
  const { items, history } = deps;
  const step = key.name === 'up' ? 1 : -1;

  if (menuVisible(state)) {
    const total = state.matches.length;
    const selected = (state.selected + total - step) % total;
    return { state: { ...state, selected }, effect: { kind: 'none' } };
  }

  return { state: recallHistory(state, history, step, items), effect: { kind: 'none' } };
}

function reduceNavigation(state: EditorState, key: Key, deps: ReduceDeps): EditorStep | null {
  const { items } = deps;

  if (key.name === 'up' || key.name === 'down') {
    return reduceVertical(state, key, deps);
  }
  if (key.name === 'left') {
    return { state: { ...state, cursor: Math.max(0, state.cursor - 1) }, effect: { kind: 'none' } };
  }
  if (key.name === 'right') {
    const item = ghostFor(state).length > 0 ? selectedItem(state) : null;
    if (item !== null) {
      return { state: complete(state, item, items), effect: { kind: 'none' } };
    }
    return {
      state: { ...state, cursor: Math.min(state.line.length, state.cursor + 1) },
      effect: { kind: 'none' },
    };
  }
  if (key.name === 'home' || (key.ctrl && key.name === 'a')) {
    return { state: { ...state, cursor: 0 }, effect: { kind: 'none' } };
  }
  if (key.name === 'end' || (key.ctrl && key.name === 'e')) {
    return { state: { ...state, cursor: state.line.length }, effect: { kind: 'none' } };
  }
  return null;
}

function reduceEditing(state: EditorState, key: Key, deps: ReduceDeps): EditorStep | null {
  const { items } = deps;

  if (key.name === 'escape') {
    return { state: { ...state, dismissed: true }, effect: { kind: 'none' } };
  }

  if (key.name === 'tab') {
    const item = selectedItem(state);
    return {
      state: item === null ? state : complete(state, item, items),
      effect: { kind: 'none' },
    };
  }

  if (key.name === 'return' || key.name === 'enter') {
    return (
      submitOrComplete(state, items) ?? {
        state: emptyState(),
        effect: { kind: 'submit', value: state.line },
      }
    );
  }

  if (key.name === 'backspace') {
    if (state.cursor === 0) {
      return { state, effect: { kind: 'none' } };
    }
    return {
      state: withLine(
        state,
        state.line.slice(0, state.cursor - 1) + state.line.slice(state.cursor),
        state.cursor - 1,
        items,
      ),
      effect: { kind: 'none' },
    };
  }

  if (key.name === 'delete') {
    return {
      state: withLine(
        state,
        state.line.slice(0, state.cursor) + state.line.slice(state.cursor + 1),
        state.cursor,
        items,
      ),
      effect: { kind: 'none' },
    };
  }

  return null;
}

export function reduce(state: EditorState, key: Key, deps: ReduceDeps): EditorStep {
  const { items } = deps;

  const control = reduceControl(state, key, deps);
  if (control !== null) {
    return control;
  }

  const editing = reduceEditing(state, key, deps);
  if (editing !== null) {
    return editing;
  }

  const navigation = reduceNavigation(state, key, deps);
  if (navigation !== null) {
    return navigation;
  }

  const text = printable(key);
  if (text.length === 0) {
    return { state, effect: { kind: 'none' } };
  }

  return {
    state: withLine(
      state,
      state.line.slice(0, state.cursor) + text + state.line.slice(state.cursor),
      state.cursor + text.length,
      items,
    ),
    effect: { kind: 'none' },
  };
}

export interface RenderOptions {
  readonly prompt: string;
  readonly columns: number;
  readonly theme?: Theme;
  readonly menu?: boolean;
}

export interface Rendered {
  readonly rows: readonly string[];
  readonly cursorRow: number;
  readonly cursorColumn: number;
}

export function menuWindow(selected: number, total: number, size: number = MENU_ROWS): number {
  if (total <= size) {
    return 0;
  }
  return Math.max(0, Math.min(selected - Math.floor(size / 2), total - size));
}

function menuRow(
  item: CompletionItem,
  active: boolean,
  width: number,
  columns: number,
  theme: Theme,
): string {
  const marker = active ? '❯ ' : '  ';
  const name = `/${item.name}`.padEnd(width);
  const room = columns - marker.length - width - 3;
  const summary = room > 1 ? item.summary.slice(0, room) : '';
  const painted = active ? theme.accent(theme.bold(name)) : theme.dim(name);
  const tail = summary.length === 0 ? '' : `   ${theme.dim(summary)}`;
  return `${active ? theme.accent(marker) : marker}${painted}${tail}`;
}

export function render(state: EditorState, options: RenderOptions): Rendered {
  const theme = options.theme ?? plainTheme;
  const columns = Math.max(20, options.columns);
  const showMenu = options.menu !== false && menuVisible(state);
  const ghost = showMenu ? ghostFor(state) : '';

  const rows = [`${theme.accent(options.prompt)}${state.line}${theme.dim(ghost)}`];

  if (showMenu) {
    const start = menuWindow(state.selected, state.matches.length);
    const visible = state.matches.slice(start, start + MENU_ROWS);
    const width = visible.reduce((longest, item) => Math.max(longest, item.name.length + 1), 0);
    for (const [offset, item] of visible.entries()) {
      rows.push(menuRow(item, start + offset === state.selected, width, columns, theme));
    }
    if (state.matches.length > visible.length) {
      rows.push(theme.dim(`  ${state.matches.length - visible.length} more`));
    }
  }

  const before = options.prompt.length + state.cursor;

  return {
    rows,
    cursorRow: Math.floor(before / columns),
    cursorColumn: before % columns,
  };
}

export interface Painter {
  paint(rendered: Rendered, inputRows: number): void;
  commit(rendered: Rendered, inputRows: number): void;
  reset(): void;
}

export function createPainter(output: NodeJS.WriteStream): Painter {
  let at = 0;

  const write = (rendered: Rendered, inputRows: number, place: boolean): void => {
    const total = inputRows + rendered.rows.length - 1;
    const up = at > 0 ? `${ESC}[${at}A` : '';
    const body = `${up}\r${ESC}[0J${rendered.rows.join('\n')}`;
    const back = total - 1 - rendered.cursorRow;
    const right = rendered.cursorColumn > 0 ? `${ESC}[${rendered.cursorColumn}C` : '';
    const tail = place ? `${back > 0 ? `${ESC}[${back}A` : ''}\r${right}` : '\n';

    output.write(`${body}${tail}`);
    at = place ? rendered.cursorRow : 0;
  };

  return {
    paint: (rendered, inputRows) => {
      write(rendered, inputRows, true);
    },
    commit: (rendered, inputRows) => {
      write(rendered, inputRows, false);
    },
    reset: () => {
      at = 0;
    },
  };
}

export function inputRowsFor(state: EditorState, options: RenderOptions): number {
  const columns = Math.max(20, options.columns);
  const showMenu = options.menu !== false && menuVisible(state);
  const ghost = showMenu ? ghostFor(state) : '';
  return Math.floor((options.prompt.length + state.line.length + ghost.length) / columns) + 1;
}

export type LineEvent =
  | { readonly kind: 'line'; readonly value: string }
  | { readonly kind: 'interrupt' }
  | { readonly kind: 'eof' };

export interface ReaderDeps {
  readonly input: NodeJS.ReadStream;
  readonly output: NodeJS.WriteStream;
  readonly items: readonly CompletionItem[];
  readonly prompt: string;
  readonly theme?: Theme;
  readonly clearScreen: () => void;
}

function endingFor(effect: EditorEffect): LineEvent | null {
  if (effect.kind === 'submit') {
    return { kind: 'line', value: effect.value };
  }
  if (effect.kind === 'interrupt') {
    return { kind: 'interrupt' };
  }
  if (effect.kind === 'eof') {
    return { kind: 'eof' };
  }
  return null;
}

export function createLineReader(
  deps: ReaderDeps,
): (history: readonly string[]) => Promise<LineEvent> {
  const { input, output, items } = deps;

  return (history) =>
    new Promise<LineEvent>((resolve) => {
      emitKeypressEvents(input);
      const wasRaw = input.isRaw === true;
      if (input.setRawMode !== undefined) {
        input.setRawMode(true);
      }
      input.resume();

      const painter = createPainter(output);
      let state = emptyState();

      const options = (): RenderOptions => ({
        prompt: deps.prompt,
        columns: output.columns ?? 80,
        ...(deps.theme === undefined ? {} : { theme: deps.theme }),
      });

      const draw = (): void => {
        const view = options();
        painter.paint(render(state, view), inputRowsFor(state, view));
      };

      const finish = (event: LineEvent): void => {
        const view = { ...options(), menu: false };
        painter.commit(render(state, view), inputRowsFor(state, view));
        input.off('keypress', onKeypress);
        if (input.setRawMode !== undefined) {
          input.setRawMode(wasRaw);
        }
        input.pause();
        resolve(event);
      };

      const onKeypress = (sequence: string, meta: Partial<Key> | undefined): void => {
        const key: Key = {
          name: meta?.name ?? '',
          sequence: meta?.sequence ?? sequence ?? '',
          ctrl: meta?.ctrl === true,
          meta: meta?.meta === true,
        };

        const step = reduce(state, key, { items, history });
        state = step.state;

        const ending = endingFor(step.effect);
        if (ending !== null) {
          finish(ending);
          return;
        }

        if (step.effect.kind === 'clear') {
          deps.clearScreen();
          painter.reset();
        }

        draw();
      };

      input.on('keypress', onKeypress);
      draw();
    });
}
