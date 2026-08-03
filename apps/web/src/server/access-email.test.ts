import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { renderAccessGranted, sendAccessGranted, siteOrigin } from './access-email.js';

const token = '22222222-2222-4222-8222-222222222222';
const origin = 'https://mneia.dev';

describe('renderAccessGranted', () => {
  it('carries the invitation link', () => {
    const email = renderAccessGranted({
      invitationUrl: 'https://accounts.mneia.dev/accept?ticket=abc',
      unsubscribeToken: token,
      origin,
    });

    expect(email.text).toContain('https://accounts.mneia.dev/accept?ticket=abc');
    expect(email.subject).toBe('Your Mneia access is open');
  });

  it('refuses to render without a link, rather than emailing a dead end', () => {
    expect(() =>
      renderAccessGranted({ invitationUrl: '  ', unsubscribeToken: token, origin }),
    ).toThrow(/invitation URL/i);
  });

  it('attaches one-click unsubscribe headers, as the waitlist promise requires', () => {
    const email = renderAccessGranted({
      invitationUrl: 'https://example.test/accept',
      unsubscribeToken: token,
      origin,
    });

    expect(email.headers['List-Unsubscribe']).toBe(
      `<${origin}/api/waitlist/unsubscribe?token=${token}>`,
    );
    expect(email.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(email.text).toContain(`${origin}/unsubscribe?token=${token}`);
  });

  it('says this is the last waitlist email, closing the loop the confirmation opened', () => {
    const email = renderAccessGranted({
      invitationUrl: 'https://example.test/accept',
      unsubscribeToken: token,
      origin,
    });

    expect(email.text).toContain('This is the last email you will get from the waitlist');
  });
});

describe('siteOrigin', () => {
  it('strips trailing slashes and falls back to the marketing site', () => {
    expect(siteOrigin('https://mneia.dev//')).toBe('https://mneia.dev');
    expect(siteOrigin(undefined)).toBe('https://mneia.dev');
  });
});

describe('sendAccessGranted', () => {
  const email = { subject: 's', text: 't', headers: {} };
  const base = { to: 'ada@example.com', from: 'Mneia <hello@mneia.dev>', apiKey: 'key', email };

  it('reports delivery and the provider id', async () => {
    const result = await sendAccessGranted({
      ...base,
      idempotencyKey: 'access-granted:1',
      fetchImpl: async () => new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 }),
    });

    expect(result).toEqual({ delivered: true, providerId: 'resend-1', detail: null });
  });

  it('reports a rejection rather than throwing, so the claim can be settled', async () => {
    const result = await sendAccessGranted({
      ...base,
      idempotencyKey: 'access-granted:1',
      fetchImpl: async () => new Response('nope', { status: 422, statusText: 'Unprocessable' }),
    });

    expect(result.delivered).toBe(false);
    expect(result.detail).toContain('422');
  });

  it('treats a transport failure as unresolved, never as delivered', async () => {
    const result = await sendAccessGranted({
      ...base,
      idempotencyKey: 'access-granted:1',
      fetchImpl: async () => {
        throw new Error('socket hang up');
      },
    });

    expect(result.delivered).toBe(false);
    expect(result.detail).toContain('may still have been accepted');
  });

  it('sends an idempotency key so a retry cannot duplicate the message', async () => {
    let seen: string | null = null;

    await sendAccessGranted({
      ...base,
      idempotencyKey: 'access-granted:signup-1',
      fetchImpl: async (_url, init) => {
        const headers = new Headers(init?.headers);
        seen = headers.get('Idempotency-Key');
        return new Response('{}', { status: 200 });
      },
    });

    expect(seen).toBe('access-granted:signup-1');
  });
});
