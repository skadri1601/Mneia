import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { renderTeamInvitation, sendTeamInvitation } = await import('./invitation-email.js');

const INPUT = {
  workspaceName: 'Acme Platform',
  inviterName: 'Dana Okafor',
  role: 'member',
  joinUrl: 'https://app.mneia.dev/join/abc123',
};

const okResponse = (body: unknown = { id: 'resend-1' }): Response =>
  new Response(JSON.stringify(body), { status: 200 });

describe('renderTeamInvitation', () => {
  it('names the inviter and the workspace in the subject, so it does not read as spam', () => {
    const email = renderTeamInvitation(INPUT);

    expect(email.subject).toBe('Dana Okafor invited you to Acme Platform on Mneia');
  });

  it('carries the join link and says the link is single use', () => {
    const email = renderTeamInvitation(INPUT);

    expect(email.text).toContain('https://app.mneia.dev/join/abc123');
    expect(email.text).toContain('single-use');
  });

  it('sets no List-Unsubscribe header, because this is transactional and not the waitlist', () => {
    const email = renderTeamInvitation(INPUT);

    expect(email.headers).toEqual({});
    expect(email.text).not.toMatch(/unsubscribe/i);
  });

  it('does not restate a promise revoked on 2026-07-28', () => {
    const email = renderTeamInvitation(INPUT);

    expect(email.text).not.toMatch(/self-host|offline|never leaves/i);
  });

  it('refuses to render without a join URL rather than sending a dead invitation', () => {
    expect(() => renderTeamInvitation({ ...INPUT, joinUrl: '  ' })).toThrow(/join URL/);
  });

  it('refuses to render without a workspace name', () => {
    expect(() => renderTeamInvitation({ ...INPUT, workspaceName: '' })).toThrow(/workspace name/);
  });
});

describe('sendTeamInvitation', () => {
  const send = (fetchImpl: typeof fetch) =>
    sendTeamInvitation({
      to: 'newcomer@acme.test',
      from: 'invites@mneia.dev',
      apiKey: 'test-key',
      idempotencyKey: 'invitation:inv-1',
      email: renderTeamInvitation(INPUT),
      fetchImpl,
    });

  it('posts the invitation to Resend with an idempotency key', async () => {
    const fetchImpl = vi.fn(async () => okResponse()) as unknown as typeof fetch;
    const result = await send(fetchImpl);

    expect(result).toEqual({ delivered: true, providerId: 'resend-1', detail: null });

    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('invitation:inv-1');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.to).toBe('newcomer@acme.test');
    expect(body.from).toBe('invites@mneia.dev');
  });

  it('reports a refusal from Resend rather than claiming delivery', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('nope', { status: 422, statusText: 'Unprocessable Entity' }),
    ) as unknown as typeof fetch;

    const result = await send(fetchImpl);

    expect(result.delivered).toBe(false);
    expect(result.detail).toContain('422');
  });

  it('reports a transport failure without throwing, so the invitation survives it', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;

    const result = await send(fetchImpl);

    expect(result.delivered).toBe(false);
    expect(result.detail).toContain('socket hang up');
    expect(result.detail).toContain('may still have been accepted');
  });

  it('still reports delivery when Resend answers without an id', async () => {
    const fetchImpl = vi.fn(async () => okResponse({})) as unknown as typeof fetch;

    const result = await send(fetchImpl);

    expect(result).toEqual({ delivered: true, providerId: null, detail: null });
  });
});
