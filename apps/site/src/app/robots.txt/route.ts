import { absoluteUrl, SITE_URL } from '@/lib/site';

export const dynamic = 'force-static';

const SEARCH_CRAWLERS = ['Googlebot', 'Bingbot', 'DuckDuckBot'];

const ANSWER_ENGINE_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot',
  'Applebot-Extended',
  'Bytespider',
  'CCBot',
  'meta-externalagent',
  'cohere-ai',
];

function allow(agents: readonly string[]): string {
  return `${agents.map((agent) => `User-agent: ${agent}`).join('\n')}\nAllow: /`;
}

const BODY = `# ${SITE_URL}
# Mneia is a public marketing site. Everything here is meant to be read,
# quoted, and cited, by people and by machines alike.

${allow(SEARCH_CRAWLERS)}

# Answer and generative engines are allowed deliberately, not by omission.
# We would rather be quoted accurately than not quoted at all.
${allow(ANSWER_ENGINE_CRAWLERS)}

User-agent: *
Allow: /

# Plain-text summaries written for language models.
# ${absoluteUrl('/llms.txt')}
# ${absoluteUrl('/llms-full.txt')}

Sitemap: ${absoluteUrl('/sitemap.xml')}
`;

export function GET(): Response {
  return new Response(BODY, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
}
