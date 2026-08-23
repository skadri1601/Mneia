import type { DocPage } from './types';

export const SECURITY: DocPage = {
  slug: 'security',
  name: 'Security and privacy',
  title: 'Security and privacy',
  description:
    'How Mneia isolates one workspace from another, how credentials and device approval work, what telemetry records and how to turn it off, retention and residency controls, audit export, and enterprise governance.',
  eyebrow: 'Trust',
  heading: 'Privacy enforced by controls, not by locality.',
  lead: 'Mneia is a hosted service, so the honest privacy story is about what the controls guarantee - scope, isolation, retention, residency, and audit - rather than about where the bytes sit.',
  minutes: 10,
  sections: [
    {
      id: 'posture',
      heading: 'The posture, stated plainly',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Your project content is stored on our infrastructure. The clients require an account and do not function without the service. We would rather say that directly than imply otherwise and be found out by the people most likely to check.',
            'What that buys, in exchange: one store where every surface sees the same rows the moment they are written. No sync protocol, no offline write queue, no cache invalidation, and no class of bugs where two copies of your project memory quietly disagree about what was decided.',
          ],
        },
        {
          kind: 'note',
          text: 'What the open licence covers is the part that carries our judgement - the CLI, the MCP server, the schema, the extraction prompts, and the ranking algorithm. Those are inspectable, forkable, and criticisable, which is a real constraint on us to make them defensible.',
        },
      ],
    },
    {
      id: 'isolation',
      heading: 'Workspace isolation',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Every row in the system carries the workspace it belongs to. Not most rows, and not most tables - every one, including join tables, and never nullable. A row that cannot name its workspace cannot be filtered, and that is a leak waiting for an occasion.',
            'Isolation is enforced in two independent layers, because one is a single point of failure:',
          ],
        },
        {
          kind: 'bullets',
          items: [
            '**The store interface applies the filter.** This catches the ordinary mistake - the query somebody wrote in a hurry.',
            '**Postgres row-level security applies it again**, underneath. This catches the hand-written query that bypassed the interface entirely.',
            '**An invariant test proves it.** It deliberately writes a query with the filter omitted and asserts that one workspace still cannot read another’s rows. A test that went through the interface would prove nothing, because the interface is the layer being bypassed.',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Policies ship in the same migration as the table they protect. A table that lands without its policy is a defect rather than an increment, and the schema check refuses it.',
            'The application refuses to run as a database role that could bypass row-level security. A connection holding those privileges is rejected at the transaction boundary rather than silently trusted, and the deployment reports which state it is actually in rather than asserting the intended one.',
          ],
        },
      ],
    },
    {
      id: 'scope',
      heading: 'Scope enforcement',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Inside a workspace, the five-value visibility hierarchy decides who sees what - private to the asserting actor, the project, the owning team, the whole workspace, or an explicit grant list. It is enforced at the query layer, so an item outside your scope is not returned to be filtered later; it is not returned.',
            'Team function shapes the default view, which is what keeps a support engineer out of a backend team’s debugging trail without anybody having to configure it per person.',
          ],
        },
      ],
    },
    {
      id: 'credentials',
      heading: 'Authentication and credentials',
      blocks: [
        {
          kind: 'table',
          head: ['Where', 'What'],
          rows: [
            [
              'Browser',
              'Identity is handled by a dedicated identity provider. Mneia’s own database remains the authorisation source of truth - provider user ids map to actors, and workspace, team, and scope enforcement stay behind row-level security.',
            ],
            [
              'CLI and MCP',
              'A device flow. `mneia login` prints a link, a user code, and a confirmation number; the machine gets a token only after approval inside an authenticated web session.',
            ],
            ['CI', '`MNEIA_TOKEN` in the environment. The same token shape, without the browser.'],
          ],
        },
        {
          kind: 'bullets',
          items: [
            'The token is written to `~/.mneia/credentials` with `0600` permissions, outside any repository.',
            'A token carries its workspace, so approving a device claims whichever workspace was active in the browser at the time. Check the workspace named on the approval page before approving.',
            '`.mneia/config.json` in your repository holds the binding only - no data, no credentials. It is safe to commit and meant to be.',
          ],
        },
      ],
    },
    {
      id: 'telemetry',
      heading: 'Telemetry',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Mneia records what happened to items - a slice was shown, an item was referenced or ignored, a candidate was confirmed, edited, or rejected, a conflict was resolved. Those events carry actor, project, timestamp, and item ids.',
            '**They do not carry content by default.** The payload is ids, scores, and durations. Redaction is applied on the way out rather than trusted to the caller.',
          ],
        },
        {
          kind: 'code',
          label: 'shell',
          lines: ['# opt out entirely, on any surface', 'export MNEIA_TELEMETRY=off'],
        },
        {
          kind: 'note',
          text: 'An unrecognised value is an error rather than a fallback. A typo in an opt-out must never quietly leave telemetry on, which is the one failure mode that would make the setting worthless.',
        },
        {
          kind: 'text',
          paragraphs: [
            'Why it exists at all, stated honestly: the percentage of rehydrated items that get referenced is how selection improves on your project rather than in general. Every human correction is a labelled example. Being straightforward about that is better than describing it as anonymous product analytics.',
          ],
        },
      ],
    },
    {
      id: 'audit',
      heading: 'Audit',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Audit events are a separate record from telemetry, deliberately. Telemetry is opt-out and redacted; an audit log that could be either is not an audit log.',
            'It records who did what to which object and when - membership changes, scope changes, resolutions, deletions - and it is exportable.',
          ],
        },
      ],
    },
    {
      id: 'retention',
      heading: 'Retention and residency',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Both are columns rather than policies in a document. A workspace carries a retention window and a region, and individual items carry their own purge time - so retention is enforced by the store rather than promised in prose.',
            'Region in particular is part of the schema from the beginning. Keying it after multi-region data already exists is a migration across regions, not a schema change, and that is not a thing anybody survives cleanly.',
          ],
        },
      ],
    },
    {
      id: 'governance',
      heading: 'Enterprise governance',
      blocks: [
        {
          kind: 'table',
          head: ['Control', 'What it covers'],
          rows: [
            ['**SSO and SAML**', 'Identity federated with your provider'],
            ['**Audit export**', 'The audit record, out of the system and into yours'],
            [
              '**Permission scopes**',
              'Restricted items with explicit grant lists - named teams or actors, each grant attributed and dated',
            ],
            ['**Residency**', 'Where a workspace’s data is stored'],
            [
              '**Dedicated deployment**',
              'For an organisation that accepts neither a shared schema nor our controls, a deployment inside your own boundary under a commercial licence',
            ],
            ['**Support SLA**', 'Response commitments and operational runbooks'],
          ],
        },
        {
          kind: 'note',
          text: 'Isolation is answered with row-level security and the invariant test that proves it, not with a separate schema per customer. A dedicated deployment is a genuinely different model rather than a softer version of the same one, and it is offered as such.',
        },
      ],
    },
    {
      id: 'reporting',
      heading: 'Reporting something',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'If you find a security issue, report it privately rather than in a public issue, and you will get a human. The subprocessor list, the data-handling policy, and the current security posture are published and kept current - a page that lags reality is worse than no page.',
          ],
        },
      ],
    },
  ],
};
