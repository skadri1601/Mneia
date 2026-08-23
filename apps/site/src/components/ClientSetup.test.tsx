// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_SETUPS, setupPrompt } from '@/content/client-setup';
import { ClientSetup } from './ClientSetup';

let container: HTMLDivElement;
let root: Root;
let writeText: ReturnType<typeof vi.fn>;

const buttonNamed = (name: string): HTMLButtonElement => {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`button not found: ${name}`);
  return button;
};

const click = async (element: HTMLElement): Promise<void> => {
  await act(async () => element.click());
};

const clientAt = (index: number) => {
  const client = CLIENT_SETUPS[index];
  if (client === undefined) throw new Error(`client setup not found at index ${index}`);
  return client;
};

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ClientSetup clients={CLIENT_SETUPS} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('ClientSetup', () => {
  it('starts on Codex and renders one selected tab and panel', () => {
    expect(buttonNamed('Codex').getAttribute('aria-selected')).toBe('true');
    expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
    expect(container.textContent).toContain('Codex CLI and desktop');
  });

  it('copies only the complete prompt for the selected client', async () => {
    await click(buttonNamed('Gemini CLI'));
    await click(buttonNamed('Copy setup prompt'));

    expect(writeText).toHaveBeenCalledWith(setupPrompt(clientAt(4)));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Gemini CLI setup prompt copied',
    );
  });

  it('keeps automatic and manual copy targets separate', async () => {
    await click(buttonNamed('Copy command'));
    expect(writeText).toHaveBeenLastCalledWith('mneia mcp install --client codex --yes');

    await click(buttonNamed('Copy manual config'));
    expect(writeText).toHaveBeenLastCalledWith(clientAt(0).manualConfig.join('\n'));
  });

  it('moves between tabs with arrow keys', async () => {
    const codex = buttonNamed('Codex');
    await act(async () => {
      codex.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });

    expect(buttonNamed('Claude Code').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(buttonNamed('Claude Code'));
  });

  it('reports a rejected clipboard write without claiming success', async () => {
    writeText.mockRejectedValueOnce(new Error('clipboard denied'));
    await click(buttonNamed('Copy setup prompt'));

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Could not copy the Codex setup prompt',
    );
    expect(buttonNamed('Copy setup prompt').textContent).toBe('Copy setup prompt');
  });
});
