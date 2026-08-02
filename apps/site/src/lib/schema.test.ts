import { describe, expect, test } from 'vitest';
import { organizationSchema, softwareApplicationSchema, websiteSchema } from './schema';

describe('discoverability schemas', () => {
  test('publishes one consistent MNEIA organization identity', () => {
    const organization = organizationSchema();
    const website = websiteSchema();
    const software = softwareApplicationSchema();

    expect(organization.name).toBe('MNEIA');
    expect(organization.logo).toBe('https://mneia.dev/icon.svg');
    expect(website.name).toBe('MNEIA');
    expect(software.name).toBe('MNEIA');
    expect(software.description).toMatch(/shared project memory/i);
  });
});
