import { describe, expect, it } from 'vitest';
import {
  type CompletionItem,
  type EditorState,
  emptyState,
  ghostFor,
  type Key,
  matchesFor,
  menuVisible,
  menuWindow,
  type ReduceDeps,
  reduce,
  render,
  requiresArgument,
  selectedItem,
} from './session-editor.js';

const ITEMS: readonly CompletionItem[] = [
  { name: 'brief', summary: 'Print the rehydrated context slice.', requiresArgument: true },
  { name: 'checkpoint', summary: 'Record what this session decided.', requiresArgument: false },
  { name: 'clear', summary: 'Clear the screen.', requiresArgument: false },
  { name: 'status', summary: 'Show what is stale or disputed.', requiresArgument: false },
  { name: 'stop', summary: 'Not a real command, here to force a tie.', requiresArgument: false },
];

const key = (name: string, extra: Partial<Key> = {}): Key => ({
  name,
  sequence: extra.sequence ?? name,
  ctrl: extra.ctrl ?? false,
  meta: extra.meta ?? false,
});

const typed = (text: string): Key => key(text, { sequence: text });

const deps = (history: readonly string[] = []): ReduceDeps => ({ items: ITEMS, history });

function type(text: string, history: readonly string[] = []): EditorState {
  let state = emptyState();
  for (const character of text) {
    state = reduce(state, typed(character), deps(history)).state;
  }
  return state;
}

describe('requiresArgument', () => {
  it('sees a required positional', () => {
    expect(requiresArgument('mneia brief "<task>" [--budget <tokens>] [--json]')).toBe(true);
  });

  it('does not mistake an optional flag value for a required argument', () => {
    expect(requiresArgument('mneia log [--limit <count>] [--json]')).toBe(false);
  });

  it('sees nothing required in a bare command', () => {
    expect(requiresArgument('mneia status [--json]')).toBe(false);
  });
});

describe('matchesFor', () => {
  it('offers every command for a bare slash', () => {
    expect(matchesFor('/', ITEMS)).toHaveLength(ITEMS.length);
  });

  it('narrows on each further character', () => {
    expect(matchesFor('/s', ITEMS).map((item) => item.name)).toEqual(['status', 'stop']);
    expect(matchesFor('/st', ITEMS).map((item) => item.name)).toEqual(['status', 'stop']);
    expect(matchesFor('/sta', ITEMS).map((item) => item.name)).toEqual(['status']);
  });

  it('offers nothing for plain text, which is a task not a command', () => {
    expect(matchesFor('fix the login redirect', ITEMS)).toEqual([]);
  });

  it('stops offering once the command name is finished', () => {
    expect(matchesFor('/status ', ITEMS)).toEqual([]);
  });

  it('ignores case', () => {
    expect(matchesFor('/ST', ITEMS).map((item) => item.name)).toEqual(['status', 'stop']);
  });
});

describe('typing', () => {
  it('opens the menu on the slash and narrows it keystroke by keystroke', () => {
    expect(matchesFor(type('/').line, ITEMS)).toHaveLength(ITEMS.length);
    expect(type('/').matches).toHaveLength(ITEMS.length);
    expect(type('/s').matches.map((item) => item.name)).toEqual(['status', 'stop']);
    expect(type('/st').matches.map((item) => item.name)).toEqual(['status', 'stop']);
    expect(type('/sta').matches.map((item) => item.name)).toEqual(['status']);
  });

  it('keeps the menu shut for a plain task', () => {
    expect(menuVisible(type('fix the login'))).toBe(false);
  });

  it('reopens the menu when a backspace makes the line a prefix again', () => {
    const state = reduce(type('/status '), key('backspace'), deps()).state;
    expect(menuVisible(state)).toBe(true);
    expect(state.matches.map((item) => item.name)).toEqual(['status']);
  });

  it('shows the rest of the selected name as ghost text, so Tab is discoverable', () => {
    expect(ghostFor(type('/sta'))).toBe('tus');
  });

  it('shows no ghost text when the cursor is not at the end', () => {
    const state = reduce(type('/sta'), key('left'), deps()).state;
    expect(ghostFor(state)).toBe('');
  });
});

describe('completion', () => {
  it('completes to the selected command on Tab', () => {
    const state = reduce(type('/sta'), key('tab'), deps()).state;
    expect(state.line).toBe('/status');
    expect(menuVisible(state)).toBe(false);
  });

  it('leaves a trailing space when the command needs an argument', () => {
    const state = reduce(type('/br'), key('tab'), deps()).state;
    expect(state.line).toBe('/brief ');
  });

  it('completes on the right arrow when there is ghost text to accept', () => {
    expect(reduce(type('/sta'), key('right'), deps()).state.line).toBe('/status');
  });

  it('does nothing on Tab when no menu is open', () => {
    const state = type('fix the login');
    expect(reduce(state, key('tab'), deps()).state.line).toBe('fix the login');
  });

  it('runs a no-argument command on Enter while the menu is open', () => {
    const step = reduce(type('/sta'), key('return'), deps());
    expect(step.effect).toEqual({ kind: 'submit', value: '/status' });
  });

  it('completes but waits on Enter when the command still needs an argument', () => {
    const step = reduce(type('/br'), key('return'), deps());
    expect(step.effect).toEqual({ kind: 'none' });
    expect(step.state.line).toBe('/brief ');
  });

  it('submits a fully typed command rather than completing it again', () => {
    const step = reduce(type('/status'), key('return'), deps());
    expect(step.effect).toEqual({ kind: 'submit', value: '/status' });
  });

  it('submits a plain task untouched', () => {
    const step = reduce(type('fix the login redirect'), key('return'), deps());
    expect(step.effect).toEqual({ kind: 'submit', value: 'fix the login redirect' });
  });
});

describe('menu navigation', () => {
  it('moves the selection down and wraps at the end', () => {
    let state = type('/s');
    expect(selectedItem(state)?.name).toBe('status');
    state = reduce(state, key('down'), deps()).state;
    expect(selectedItem(state)?.name).toBe('stop');
    state = reduce(state, key('down'), deps()).state;
    expect(selectedItem(state)?.name).toBe('status');
  });

  it('moves the selection up and wraps at the start', () => {
    const state = reduce(type('/s'), key('up'), deps()).state;
    expect(selectedItem(state)?.name).toBe('stop');
  });

  it('completes to whichever entry is selected, not the first', () => {
    const moved = reduce(type('/s'), key('down'), deps()).state;
    expect(reduce(moved, key('tab'), deps()).state.line).toBe('/stop');
  });

  it('dismisses the menu on Escape and leaves the typed line alone', () => {
    const state = reduce(type('/s'), key('escape'), deps()).state;
    expect(menuVisible(state)).toBe(false);
    expect(state.line).toBe('/s');
  });

  it('reopens a dismissed menu once the line changes again', () => {
    const dismissed = reduce(type('/s'), key('escape'), deps()).state;
    expect(menuVisible(reduce(dismissed, typed('t'), deps()).state)).toBe(true);
  });
});

describe('history', () => {
  const HISTORY = ['/status', 'fix the login redirect'];

  it('recalls the previous line on the up arrow', () => {
    const state = reduce(emptyState(), key('up'), deps(HISTORY)).state;
    expect(state.line).toBe('/status');
  });

  it('walks further back on a second up arrow', () => {
    let state = reduce(emptyState(), key('up'), deps(HISTORY)).state;
    state = reduce(state, key('up'), deps(HISTORY)).state;
    expect(state.line).toBe('fix the login redirect');
  });

  it('stops at the oldest line rather than clearing the input', () => {
    let state = emptyState();
    for (let index = 0; index < 5; index += 1) {
      state = reduce(state, key('up'), deps(HISTORY)).state;
    }
    expect(state.line).toBe('fix the login redirect');
  });

  it('restores the half-typed draft on the way back down', () => {
    let state = type('half typed');
    state = reduce(state, key('up'), deps(HISTORY)).state;
    expect(state.line).toBe('/status');
    state = reduce(state, key('down'), deps(HISTORY)).state;
    expect(state.line).toBe('half typed');
  });

  it('leaves history alone while the menu is open, because the arrows belong to it', () => {
    const state = reduce(type('/s'), key('up'), deps(HISTORY)).state;
    expect(state.line).toBe('/s');
  });

  it('keeps walking history when the recalled line is itself a command', () => {
    const first = reduce(emptyState(), key('up'), deps(HISTORY)).state;
    expect(first.line).toBe('/status');
    expect(menuVisible(first)).toBe(false);
    expect(reduce(first, key('up'), deps(HISTORY)).state.line).toBe('fix the login redirect');
  });
});

describe('editing keys', () => {
  it('deletes the character before the cursor', () => {
    expect(reduce(type('status'), key('backspace'), deps()).state.line).toBe('statu');
  });

  it('does nothing on backspace at the start of the line', () => {
    expect(reduce(emptyState(), key('backspace'), deps()).state.line).toBe('');
  });

  it('clears to the start of the line on Ctrl+U', () => {
    expect(reduce(type('a task'), key('u', { ctrl: true }), deps()).state.line).toBe('');
  });

  it('deletes the word before the cursor on Ctrl+W', () => {
    expect(reduce(type('fix the login'), key('w', { ctrl: true }), deps()).state.line).toBe(
      'fix the',
    );
  });

  it('moves to the start on Ctrl+A and the end on Ctrl+E', () => {
    const start = reduce(type('a task'), key('a', { ctrl: true }), deps()).state;
    expect(start.cursor).toBe(0);
    expect(reduce(start, key('e', { ctrl: true }), deps()).state.cursor).toBe(6);
  });

  it('inserts at the cursor rather than always appending', () => {
    let state = type('sttus');
    state = reduce(state, key('left'), deps()).state;
    state = reduce(state, key('left'), deps()).state;
    state = reduce(state, key('left'), deps()).state;
    expect(reduce(state, typed('a'), deps()).state.line).toBe('status');
  });

  it('inserts a pasted run of characters in one go', () => {
    expect(reduce(emptyState(), typed('fix the login'), deps()).state.line).toBe('fix the login');
  });

  it('asks to clear the screen on Ctrl+L without losing the typed line', () => {
    const step = reduce(type('half typed'), key('l', { ctrl: true }), deps());
    expect(step.effect).toEqual({ kind: 'clear' });
    expect(step.state.line).toBe('half typed');
  });

  it('interrupts on Ctrl+C', () => {
    expect(reduce(type('half typed'), key('c', { ctrl: true }), deps()).effect).toEqual({
      kind: 'interrupt',
    });
  });

  it('ends the session on Ctrl+D only when the line is empty', () => {
    expect(reduce(emptyState(), key('d', { ctrl: true }), deps()).effect).toEqual({ kind: 'eof' });
    expect(reduce(type('a'), key('d', { ctrl: true }), deps()).effect).toEqual({ kind: 'none' });
  });
});

describe('render', () => {
  const options = { prompt: '> ', columns: 80 };

  it('draws the typed line after the prompt', () => {
    const view = render(type('/sta'), options);
    expect(view.rows[0]).toBe('> /status');
  });

  it('draws one menu row per match', () => {
    const view = render(type('/s'), options);
    expect(view.rows).toHaveLength(3);
    expect(view.rows[1]).toContain('/status');
    expect(view.rows[2]).toContain('/stop');
  });

  it('marks the selected row so the eye can find it', () => {
    const view = render(type('/s'), options);
    expect(view.rows[1]?.startsWith('❯')).toBe(true);
    expect(view.rows[2]?.startsWith('  ')).toBe(true);
  });

  it('carries each summary beside its command', () => {
    expect(render(type('/s'), options).rows[1]).toContain('Show what is stale');
  });

  it('draws no menu when none is open', () => {
    expect(render(type('fix the login'), options).rows).toHaveLength(1);
  });

  it('puts the cursor after the prompt and the typed text', () => {
    const view = render(type('/sta'), options);
    expect(view.cursorRow).toBe(0);
    expect(view.cursorColumn).toBe(6);
  });

  it('wraps the cursor onto the next row on a narrow terminal', () => {
    const view = render(type('/status'), { prompt: '> ', columns: 20 });
    expect(view.cursorRow).toBe(0);
    expect(render(type('a'.repeat(40)), { prompt: '> ', columns: 20 })).toMatchObject({
      cursorRow: 2,
      cursorColumn: 2,
    });
  });

  it('carries every fact as text, so meaning never depends on colour', () => {
    const painted = render(type('/s'), {
      ...options,
      theme: {
        accent: (s) => `<a>${s}</a>`,
        bold: (s) => `<b>${s}</b>`,
        dim: (s) => `<d>${s}</d>`,
        inverse: (s) => `<i>${s}</i>`,
      },
    });
    const stripped = painted.rows.map((row) => row.replace(/<\/?[abdi]>/g, ''));
    expect(stripped).toEqual(render(type('/s'), options).rows);
  });
});

describe('menuWindow', () => {
  it('shows everything from the top when the list fits', () => {
    expect(menuWindow(3, 5, 8)).toBe(0);
  });

  it('scrolls to keep a selection below the fold visible', () => {
    expect(menuWindow(9, 20, 8)).toBe(5);
  });

  it('stops scrolling at the end of the list', () => {
    expect(menuWindow(19, 20, 8)).toBe(12);
  });
});
