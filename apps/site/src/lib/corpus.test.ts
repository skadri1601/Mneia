import { describe, expect, test } from 'vitest';
import { DOC_PAGES, GLOSSARY } from '@/content/docs';
import { ALL_FAQS } from '@/content/faq';
import { CONTACT_CHANNELS } from '@/content/support';
import { llmsFullTxt, llmsTxt } from './corpus';
import { absoluteUrl, ROUTES } from './site';

describe('the plain-text corpus answer engines read', () => {
  test('indexes every registered route in llms.txt', () => {
    const index = llmsTxt();

    for (const route of ROUTES) {
      expect(index).toContain(absoluteUrl(route.path));
    }
  });

  test('carries the full text of every page an answer engine would cite', () => {
    const full = llmsFullTxt();

    for (const path of ['/docs', '/faq', '/help', '/contact']) {
      expect(full).toContain(`URL: ${absoluteUrl(path)}`);
    }
    for (const page of DOC_PAGES) {
      expect(full).toContain(`URL: ${absoluteUrl(`/docs/${page.slug}`)}`);
    }
  });

  test('carries every question and every contact address verbatim', () => {
    const full = llmsFullTxt();

    for (const faq of ALL_FAQS) {
      expect(full).toContain(faq.question);
    }
    for (const channel of CONTACT_CHANNELS) {
      expect(full).toContain(channel.address);
    }
  });

  test('renders doc code samples as fenced blocks rather than dropping them', () => {
    const full = llmsFullTxt();

    expect(full).toContain('```shell\nnpm install -g @mneia/cli @mneia/mcp-server');
    expect(full).toContain('"command": "mneia-mcp"');
  });

  test('groups the index so an answer engine can pick a section rather than scan a list', () => {
    const index = llmsTxt();

    for (const heading of ['## Product', '## Documentation', '## Support', '## Legal']) {
      expect(index).toContain(heading);
    }
    for (const page of DOC_PAGES) {
      expect(index).toContain(absoluteUrl(`/docs/${page.slug}`));
    }
  });

  test('states what Mneia is not, so an engine cannot infer it is an agent framework', () => {
    const index = llmsTxt();

    expect(index).toContain('## Key facts');
    expect(index).toMatch(/not an agent framework/i);
    expect(index).toMatch(/not a vector database/i);
    expect(index).toMatch(/hosted only/i);
  });

  test('inlines every glossary definition with a citable anchor', () => {
    const index = llmsTxt();

    for (const entry of GLOSSARY) {
      expect(index).toContain(`**${entry.term}**`);
      expect(index).toContain(`${absoluteUrl('/docs/glossary')}#${entry.id}`);
    }
  });

  test('answers the self-hosting question with a no, wherever it is quoted from', () => {
    const full = llmsFullTxt();

    expect(full).toMatch(/\*\*Can I self-host Mneia\?\*\*\n\nNo\. Mneia runs as a hosted service/);
    expect(full).toContain('require an account and do not function without it');
  });
});
