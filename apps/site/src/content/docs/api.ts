import type { DocPage } from './types';

export const API: DocPage = {
  slug: 'api',
  name: 'HTTP API reference',
  title: 'HTTP API reference',
  description:
    'The hosted Mneia HTTP API: authentication, every /api/v1 route for projects, sessions, context items, rehydration, checkpoints, review, handoffs, and usage, plus error codes, rate limits, and the discovery and health endpoints.',
  eyebrow: 'Reference',
  heading: 'The API the CLI and the MCP server are both calling.',
  lead: 'Every Mneia command is an authenticated HTTP request. Nothing the clients can do is unavailable here, because there is no second path - the CLI, the MCP server, and the web app all reach the same routes.',
  minutes: 14,
  sections: [
    {
      id: 'shape',
      heading: 'The shape of a request',
      blocks: [
        {
          kind: 'code',
          label: 'http',
          lines: [
            'POST https://app.mneia.dev/api/v1/rehydrate',
            'authorization: Bearer mneia_...',
            'content-type: application/json',
            '',
            '{ "projectId": "...", "task": "migrate the ledger writes to v2", "budgetTokens": 4000 }',
          ],
        },
        {
          kind: 'bullets',
          items: [
            '**The base URL is your endpoint.** `https://app.mneia.dev` unless you were given another one, and it is what `MNEIA_API_URL` and `.mneia/config.json` both set.',
            '**Almost everything is `POST` with a JSON body,** including reads. A filter is a structured object rather than a query string, so it does not have to be flattened and re-parsed, and a request body is not logged in a proxy access log the way a URL is.',
            '**A success is `200` with the payload as the body.** There is no envelope on success - the resource is the response.',
            '**Every response carries `cache-control: no-store`.** These are a workspace’s private rows.',
            '**A token carries its workspace,** so no route takes a workspace parameter. There is nothing to pass and nothing to get wrong.',
          ],
        },
        {
          kind: 'note',
          text: 'This API is the same surface `@mneia/cli` and `@mneia/mcp-server` are built on. If you are reaching for it directly, check first that a command or a tool does not already do what you want - those are covered by tests and by a stable output contract, and this is the layer underneath them.',
        },
      ],
    },
    {
      id: 'auth',
      heading: 'Authentication',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'A bearer token on every request. There are three ways to hold one, and they produce the same kind of credential:',
          ],
        },
        {
          kind: 'table',
          head: ['How', 'Where the token comes from'],
          rows: [
            [
              'A person on a machine',
              '`mneia login` runs the device flow and writes it to `~/.mneia/credentials`',
            ],
            ['CI, or an ephemeral runner', '`MNEIA_TOKEN` in the environment'],
            [
              'A hosted or directory-listed client',
              'The OAuth 2.1 authorization code flow - see `/docs/oauth`',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'A token resolves to one workspace and one actor. Every query is scoped to that workspace at the store interface and again by Postgres row-level security underneath it, so a token cannot read another workspace’s rows even through a query that forgot to filter - see `/docs/security#isolation`.',
            '`GET /api/me` returns the actor and workspace a token resolves to, which is what `mneia whoami` prints. It is the cheapest way to check a credential.',
          ],
        },
        {
          kind: 'note',
          text: 'A `401` carries a `WWW-Authenticate: Bearer` header naming what went wrong, and on `/api/mcp` it also names the protected-resource metadata document - so a client can discover how to authenticate rather than guessing.',
        },
      ],
    },
    {
      id: 'projects',
      heading: 'Projects, actors, and sessions',
      blocks: [
        {
          kind: 'table',
          head: ['Route', 'Does'],
          rows: [
            [
              '`GET /api/v1/projects?slug=<slug>`',
              'Resolve a project by slug. This is what a bound repository does first, turning the slug in `.mneia/config.json` into an id',
            ],
            [
              '`POST /api/v1/projects`',
              'Create a project. Refused with `forbidden` when the plan’s project limit is reached, naming the limit and the projects that already exist',
            ],
            ['`GET /api/v1/projects/{id}`', 'One project by id'],
            ['`GET /api/v1/actors/{id}`', 'One actor by id'],
            [
              '`POST /api/v1/actors/list`',
              'The workspace roster - people and agents - which is what `mneia team` prints and what a directed handoff resolves a recipient against',
            ],
            [
              '`POST /api/v1/sessions`',
              'Open a session, recording the client, its version, and any stable session reference it exposes. Provenance points at this',
            ],
            [
              '`POST /api/v1/sessions/list`',
              'Who has worked on a project, with the client each session came from and what it produced - `mneia sessions`',
            ],
          ],
        },
      ],
    },
    {
      id: 'items',
      heading: 'Context items',
      blocks: [
        {
          kind: 'table',
          head: ['Route', 'Does'],
          rows: [
            ['`GET /api/v1/items/{id}`', 'One context item with its full provenance'],
            [
              '`POST /api/v1/items/list`',
              'Filter by project, kind, status, and load-bearing flag. Returns items, not a ranked slice',
            ],
            [
              '`POST /api/v1/items/search`',
              'The same filter plus free text. This is `mneia_search`: it answers "where is this one thing?", not "what do I need to know here?"',
            ],
            [
              '`POST /api/v1/items/retire`',
              'Retire an item that was never right, or stopped being true, with nothing replacing it. It stays in the record as retired rather than being deleted',
            ],
            [
              '`POST /api/v1/items/stale`',
              'What is due for re-verification, oldest first - the list `mneia verify` prints',
            ],
            [
              '`POST /api/v1/items/verify`',
              'Confirm that an item still holds, or deny it with a reason and retire it. Recorded as a checkpoint, so the change is attributable',
            ],
          ],
        },
        {
          kind: 'note',
          text: '**`human_confirmed` and `asserted_by` are never read from a request body.** The actor is resolved from the token and its kind is read from the database, and the confirmation flag is derived from that. A write path that accepted either from its caller would hand the decision about who may overrule whom to the caller.',
        },
      ],
    },
    {
      id: 'rehydrate',
      heading: 'Rehydration',
      blocks: [
        {
          kind: 'code',
          label: 'http',
          lines: [
            'POST /api/v1/rehydrate',
            '',
            '{',
            '  "projectId": "...",',
            '  "task": "add rate limiting to the public API",',
            '  "budgetTokens": 4000',
            '}',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Returns the slice: the rendered markdown, the slice id, and the scored items that went into it. The slice id matters - pass it back with a later checkpoint, along with the ids of the items that actually changed what you did, or there is no signal about whether the slice was worth loading and it cannot be recovered afterwards.',
            'Active load-bearing constraints appear regardless of score or budget pressure. That is a guarantee rather than a ranking preference: a dropped constraint is how an agent redoes the approach a human already rejected. Its p95 latency budget is 300ms.',
          ],
        },
      ],
    },
    {
      id: 'checkpoints',
      heading: 'Checkpoints',
      blocks: [
        {
          kind: 'table',
          head: ['Route', 'Does'],
          rows: [
            [
              '`POST /api/v1/checkpoints/propose`',
              'Upload session turns and get back **candidates**. This is the metered call - it runs the extraction model. Nothing is written to the project',
            ],
            [
              '`POST /api/v1/checkpoints`',
              'Write a batch of already-decided items as one atomic checkpoint',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'The two are separate because they are different acts: proposing costs money and decides nothing, and writing decides things and costs nothing. Splitting them is what lets a person review the candidates in between.',
            '`propose` resumes from a server-side watermark keyed on the source and the session reference, so a run that fails part way through does not lose the turns it had already read, and running it twice does not capture the same session twice. An upload that does not reach back to the stored watermark is still extracted - the watermark simply holds, the turns are reported as still pending, and the response says why. A transcript too large for one request is split into chunks rather than trimmed.',
            'A `propose` call is checked against the workspace’s allowance before the model is called. See `/docs/metering` for the dials and the refusals.',
          ],
        },
        {
          kind: 'note',
          text: '**Writing a checkpoint is atomic.** An interrupted write leaves no partial state, every item touched is recorded against the checkpoint with the action taken - created, updated, superseded, or rejected - and every write emits its event.',
        },
      ],
    },
    {
      id: 'review',
      heading: 'Review',
      blocks: [
        {
          kind: 'table',
          head: ['Route', 'Does'],
          rows: [
            [
              '`GET /api/v1/review/pending?projectId=<id>&limit=<n>`',
              'The items waiting on a human to confirm, load-bearing first. Read-only',
            ],
            [
              '`POST /api/v1/review`',
              'Record a batch of decisions - confirm, edit, or reject, each rejection carrying its reason. Returns the checkpoint the decisions were recorded in',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Both the terminal and the web app go through these two routes, which is why a terminal reviewer and a web reviewer leave the same record: the confirmations, edits, and rejections are written in one place and emit their events there.',
            'A candidate that is load-bearing, or that would supersede a human-confirmed item, is held here rather than written. An agent may read this queue and must not settle it.',
          ],
        },
      ],
    },
    {
      id: 'handoffs',
      heading: 'Handoffs',
      blocks: [
        {
          kind: 'table',
          head: ['Route', 'Does'],
          rows: [
            [
              '`POST /api/v1/handoff`',
              'Render and store a handoff for a project. Name a recipient to direct it, or leave it open',
            ],
            [
              '`GET /api/v1/handoff/{id}`',
              'One handoff, including the markdown frozen at the moment it was created',
            ],
            [
              '`GET /api/v1/handoff/{id}/items`',
              'The item set behind the frozen prose, by section - what the live links point at',
            ],
            ['`POST /api/v1/handoff/inbox`', 'Handoffs addressed to you'],
            [
              '`POST /api/v1/handoff/open`',
              'Open handoffs on a project, addressed to nobody in particular',
            ],
            [
              '`POST /api/v1/handoff/receive`',
              'Mark one received. This is the point the pickup clock starts from',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'The rendered markdown is frozen and the item links stay live, which is deliberate: the artifact says what the sender thought mattered at the time, and the links say what the store thinks now. Those are different questions, and collapsing them would lose one of them.',
          ],
        },
      ],
    },
    {
      id: 'usage',
      heading: 'Usage',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            '`GET /api/v1/usage` returns this workspace’s meter for the current period: the plan, the period boundaries, each dial with its used figure, allowance, and fraction, and the headline percentage. It is the same arithmetic the quota gate enforces, so it cannot report headroom the API is refusing. See `/docs/metering`.',
          ],
        },
      ],
    },
    {
      id: 'errors',
      heading: 'Errors',
      blocks: [
        {
          kind: 'code',
          label: 'json',
          lines: [
            '{ "error": { "code": "invalid_request", "message": "items.0.title: expected a non-empty string" } }',
          ],
        },
        {
          kind: 'table',
          head: ['Code', 'Status', 'Means'],
          rows: [
            [
              '`invalid_request`',
              '`400`',
              'The body did not validate, or a path parameter was not a UUID. Nothing was read or written',
            ],
            ['`invalid_token`', '`401`', 'No usable bearer token'],
            [
              '`forbidden`',
              '`403`',
              'Authenticated, but not allowed - a plan limit, or a workspace state that cannot serve the request',
            ],
            [
              '`not_found`',
              '`404`',
              'No such row in this workspace. It does not distinguish absent from invisible',
            ],
            [
              '`supersede_refused`',
              '`409`',
              'The write would have superseded a human-confirmed item. It is queued for a person instead',
            ],
            [
              '`payload_too_large`',
              '`413`',
              'The body is over the cap. Checkpoint fewer turns per call',
            ],
            [
              '`rate_limited`',
              '`429`',
              'Too many requests in the window. A `retry-after` header says how long to wait',
            ],
            [
              '`unsupported`',
              '`501`',
              'A store operation the hosted API does not serve. The message names which, and which milestone it lands with',
            ],
            ['`internal`', '`500`', 'A fault on our side. Retry once, then report it'],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Validation happens before anything is read or written, so an invalid call changes nothing. A message names what was expected and what was received rather than saying the request was invalid, because the first can be acted on and the second cannot.',
            '`supersede_refused` is not a failure to be retried. It means the arbiter did its job: an agent assertion that would overrule a human-confirmed item is never applied silently, and the item is now waiting in the review queue.',
          ],
        },
      ],
    },
    {
      id: 'limits',
      heading: 'Rate limits and body size',
      blocks: [
        {
          kind: 'table',
          head: ['Limit', 'Default', 'Notes'],
          rows: [
            [
              'Requests per minute',
              '120',
              'Counted per token, in a fixed one-minute window. A refused request gives its slot back, so being rate limited does not push the next caller further over for the rest of the window',
            ],
            [
              'Request body',
              '1 MiB',
              'Checked from `content-length` before the body is read where the header is present, and again from the bytes',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'The body cap is deliberate rather than incidental: an unbounded transcript is an unbounded prompt. A session larger than one request is uploaded across successive calls, and the remainder is reported as pending rather than dropped.',
            'Rate limiting is separate from metering. This is about request volume; the meter is about what an extraction costs. A read that never calls a model is subject to the first and not the second.',
          ],
        },
      ],
    },
    {
      id: 'other-endpoints',
      heading: 'Outside /api/v1',
      blocks: [
        {
          kind: 'table',
          head: ['Route', 'Does'],
          rows: [
            ['`GET /api/me`', 'The actor and workspace a bearer token resolves to'],
            [
              '`GET /api/health`',
              'The deployment’s own report: whether row-level security is enforced, whether the model and embedding keys are set, and which required capabilities are failing. Unauthenticated',
            ],
            [
              '`POST /api/mcp`',
              'Remote MCP over Streamable HTTP, for a client that cannot spawn a local process. Stateless: no session id, so a deploy cannot strand a connection',
            ],
            [
              '`POST /api/device/code` · `POST /api/device/token`',
              'The RFC 8628 device grant behind `mneia login`',
            ],
            [
              '`POST /api/oauth/register` · `POST /api/oauth/token`',
              'OAuth 2.1 dynamic client registration and the token exchange - see `/docs/oauth`',
            ],
            [
              '`GET /.well-known/oauth-authorization-server` · `GET /.well-known/oauth-protected-resource`',
              'Discovery metadata, RFC 8414 and RFC 9728',
            ],
          ],
        },
        {
          kind: 'note',
          text: '`key_present` in the health report is not `working`. Health never calls the provider, so it cannot see a key that authenticates and is out of credit. Read it as "a key is set", never as "extraction works".',
        },
      ],
    },
    {
      id: 'stability',
      heading: 'What is stable',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The `/api/v1` prefix is a version, and a breaking change to a route’s request or response shape means a new prefix rather than a quiet edit. Adding an optional field to a request, or a field to a response, is not a breaking change - tolerate unknown fields in what you read.',
            'The client packages are the supported surface and they move with the API. If you are calling these routes by hand, pin nothing to the exact prose of an error message: the `code` is the contract, and the `message` is written for a person to read.',
          ],
        },
      ],
    },
  ],
};
