import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { clientFromUserAgent } from './runtime.js';

// Stateless Streamable HTTP answers every request with a fresh server, so the clientInfo sent on
// initialize never reaches the tools/call that follows. The User-Agent is the only identity that
// travels on each request, and an unattributed write is a session row docs/CLIENTS.md cannot cite.
describe('clientFromUserAgent', () => {
  it('splits the conventional name/version form', () => {
    expect(clientFromUserAgent('mneia-mcp/0.12.0')).toEqual({
      name: 'mneia-mcp',
      version: '0.12.0',
    });
  });

  it('keeps a path-like client name intact and takes only the last slash as the separator', () => {
    expect(clientFromUserAgent('modelcontextprotocol/sdk/1.30.0')).toEqual({
      name: 'modelcontextprotocol/sdk',
      version: '1.30.0',
    });
  });

  it('ignores everything after the first token, which is where comments live', () => {
    expect(clientFromUserAgent('claude-code/2.1.239 (macOS; arm64)')).toEqual({
      name: 'claude-code',
      version: '2.1.239',
    });
  });

  it('keeps an unversioned agent whole rather than inventing a split', () => {
    expect(clientFromUserAgent('Cursor')).toEqual({ name: 'Cursor', version: 'unknown' });
  });

  it('does not treat a trailing slash as a version', () => {
    expect(clientFromUserAgent('weird/')).toEqual({ name: 'weird/', version: 'unknown' });
  });

  it('does not treat a leading slash as a name', () => {
    expect(clientFromUserAgent('/1.2.3')).toEqual({ name: '/1.2.3', version: 'unknown' });
  });

  it('returns nothing when the header is absent or blank, so the caller keeps MCP clientInfo', () => {
    expect(clientFromUserAgent(null)).toBeUndefined();
    expect(clientFromUserAgent('   ')).toBeUndefined();
  });

  it('bounds the name so a hostile User-Agent cannot write an unbounded client_name', () => {
    const parsed = clientFromUserAgent('x'.repeat(500));
    expect(parsed?.name).toHaveLength(120);
  });
});
