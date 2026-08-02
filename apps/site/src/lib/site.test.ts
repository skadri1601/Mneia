import { describe, expect, test } from 'vitest';
import { pageMetadata, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from './site';

describe('site discoverability metadata', () => {
  test('describes MNEIA as the shared memory and handoff layer', () => {
    expect(SITE_NAME).toBe('MNEIA');
    expect(SITE_TITLE).toContain('MNEIA');
    expect(SITE_DESCRIPTION).toMatch(/shared project memory/i);
    expect(SITE_DESCRIPTION).toMatch(/handoff/i);
  });

  test('emits canonical and social metadata for the home page', () => {
    const metadata = pageMetadata('/');

    expect(metadata.alternates?.canonical).toBe('https://mneia.dev');
    expect(metadata.openGraph?.siteName).toBe('MNEIA');
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image' });
  });
});
