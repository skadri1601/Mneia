import { describe, expect, it } from 'vitest';
import { describeProjectLimit, planLimits, projectLimit } from './limits.js';

describe('planLimits', () => {
  it('caps solo at one project and leaves the paid plans uncapped', () => {
    expect(planLimits('solo').projects).toBe(1);
    expect(planLimits('team').projects).toBeNull();
    expect(planLimits('enterprise').projects).toBeNull();
  });
});

describe('projectLimit', () => {
  it('allows the first solo project', () => {
    expect(projectLimit('solo', 0)).toEqual({ allowed: true });
  });

  it('refuses a second solo project, reporting the limit and what was found', () => {
    expect(projectLimit('solo', 1)).toEqual({ allowed: false, limit: 1, current: 1 });
  });

  it('still refuses when a workspace is somehow already over the limit', () => {
    expect(projectLimit('solo', 4)).toEqual({ allowed: false, limit: 1, current: 4 });
  });

  it('never refuses a paid plan, however many projects it has', () => {
    expect(projectLimit('team', 0)).toEqual({ allowed: true });
    expect(projectLimit('team', 500)).toEqual({ allowed: true });
    expect(projectLimit('enterprise', 5_000)).toEqual({ allowed: true });
  });
});

describe('describeProjectLimit', () => {
  const refused = { allowed: false, limit: 1, current: 1 } as const;

  it('names what was expected, what was found, and both ways out', () => {
    const message = describeProjectLimit(refused, 'api', ['checkout']);

    expect(message).toContain('the solo plan includes 1 project');
    expect(message).toContain('this workspace already has 1 project');
    expect(message).toContain('"checkout"');
    expect(message).toContain('no project named "api" was created');
    expect(message).toContain('archive a project you have finished with');
    expect(message).toContain('team plan');
  });

  it('does not read like a paywall on solo use, per standing rule 7', () => {
    const message = describeProjectLimit(refused, 'api', ['checkout']);

    for (const word of ['upgrade', 'pay', 'purchase', 'buy', 'billing', 'trial', '$']) {
      expect(message.toLowerCase()).not.toContain(word);
    }
  });

  it('never restates self-hostability, revoked on 2026-07-28 by §11.1', () => {
    const message = describeProjectLimit(refused, 'api', ['checkout']);

    for (const phrase of ['self-host', 'self host', 'offline', 'your machine', 'unlimited by']) {
      expect(message.toLowerCase()).not.toContain(phrase);
    }
  });

  it('reads correctly when the existing projects are not known', () => {
    const message = describeProjectLimit(refused, 'api', []);

    expect(message).toContain('this workspace already has 1 project,');
    expect(message).not.toContain('()');
  });

  it('pluralises an over-limit workspace rather than saying "1 projects"', () => {
    const message = describeProjectLimit({ allowed: false, limit: 1, current: 3 }, 'api', [
      'checkout',
      'ledger',
      'search',
    ]);

    expect(message).toContain('already has 3 projects');
    expect(message).toContain('includes 1 project ');
  });
});
