import type { JsonLdNode } from '@/lib/schema';
import { graph } from '@/lib/schema';

export function JsonLd({ nodes }: { nodes: readonly JsonLdNode[] }) {
  const serialised = JSON.stringify(graph(nodes)).replace(/</g, '\\u003c');

  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD must not be HTML-escaped by React
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serialised }} />
  );
}
