import type { DocPage } from './types';

export const WEB_APP: DocPage = {
  slug: 'web-app',
  name: 'The web app',
  title: 'The web app',
  description:
    'Every surface in the Mneia web app: onboarding, projects, the decision browser, the timeline, the review queue, handoffs, team and invitations, API tokens, device approval, billing, and workspace switching.',
  eyebrow: 'Reference',
  heading: 'The surfaces a browser gives you.',
  lead: 'The web app is a view onto the same verbs the CLI and the MCP server use, not a second product. It exists for the things a terminal is bad at: reviewing a queue on a phone, reading a decision history with a colleague, approving a device, and managing who is in the workspace.',
  minutes: 12,
  sections: [
    {
      id: 'thin-by-design',
      heading: 'Thin, on purpose',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Every page here calls the same API the CLI calls. A confirmation made in the browser and a confirmation made at a terminal go through one route, emit one event, and leave one record - which is why the two never disagree about what was decided.',
            'That is the constraint the app is designed against: if a surface here needed a verb the clients do not have, that would be the signal it had started becoming something else rather than a reason to add the verb.',
          ],
        },
        {
          kind: 'note',
          text: 'The app lives at **app.mneia.dev**; this documentation lives at **mneia.dev**. Signing in is handled by a dedicated identity provider, and Mneia’s own database stays the authorisation source of truth - see `/docs/security#credentials`.',
        },
      ],
    },
    {
      id: 'onboarding',
      heading: 'Getting in',
      blocks: [
        {
          kind: 'table',
          head: ['Surface', 'What it is'],
          rows: [
            ['`/sign-up` and `/sign-in`', 'Account creation and sign-in'],
            [
              '`/welcome`',
              'The one-time setup: a name for the workspace, your own name, the company size, and the function you work in. It is short because the answers shape defaults - team function is what keeps a support engineer out of a backend team’s debugging trail without anybody configuring it per person',
            ],
            [
              '`/join/{token}`',
              'Accepting an invitation. It lands you in **the inviter’s** workspace rather than creating a new one of your own, which is the whole point of the link',
            ],
            [
              '`/admin`',
              'Waitlist admission. Visible only to a super admin, and not part of the product surface for a customer',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'An invitation link that has expired, been revoked, or already been accepted says so plainly rather than failing generically. Accepting one is what creates your actor inside that workspace - the person is one identity across every workspace, the actor is that person inside one of them.',
          ],
        },
      ],
    },
    {
      id: 'projects',
      heading: 'Projects',
      blocks: [
        {
          kind: 'table',
          head: ['Surface', 'What it is'],
          rows: [
            ['`/projects`', 'Every project in this workspace you can see'],
            [
              '`/projects/{id}`',
              'Project settings: rename it, or archive it when the work is finished. Archiving frees a slot against a plan that caps projects',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'A project is a body of work rather than a repository. A sales team’s "Q3 enterprise motion" is as valid a project as a backend service, which is why nothing forces one to carry a repository URL.',
          ],
        },
      ],
    },
    {
      id: 'decisions',
      heading: 'The decision browser',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            '`/projects/{id}/decisions` is the project record: what was decided, by whom, on what basis, and what it replaced. Filter by kind, by status, by whether an item is load-bearing, and by free text.',
            'Every row carries its provenance in the open - whether a human confirmed it, when it was asserted, the confidence it was recorded with, the source reference where there is one, and the ids of what it replaced and what replaced it. A supersede chain reads as a sequence rather than a pile.',
          ],
        },
        {
          kind: 'note',
          text: 'This is the same data `mneia log` prints. The browser is better when you are reading with somebody else, or when you do not yet know what you are looking for; the terminal is better when you do.',
        },
      ],
    },
    {
      id: 'timeline',
      heading: 'The timeline',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            '`/projects/{id}/timeline` answers a question no filter can: **what did this project believe on a given date?** Pick a date and it reads the store as of that date rather than filtering today’s rows by status.',
            'An item that has since been superseded still appears, because it was believed then - that is the point. The page splits into what was believed on the date and what has been recorded since, so you can see exactly what somebody working that day could and could not have known.',
          ],
        },
        {
          kind: 'note',
          text: 'This is what the bi-temporal columns are for. `asserted_at` is when somebody said a thing and `valid_from` is when it was true of the project, and keeping both is the only way to answer this question afterwards. Retrofitting it onto a store with real history is close to impossible, which is why it shipped in the first migration.',
        },
      ],
    },
    {
      id: 'review',
      heading: 'The review queue',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            '`/projects/{id}/review` lists the items an extraction proposed that nobody has confirmed yet. Anyone on the team can review them - the queue belongs to the project rather than to whoever ran the checkpoint.',
            'Each item says **why it is being asked about**: that it is load-bearing, so later work is wrong if it is wrong, or that it would overrule something a person already confirmed. Confirm it, edit it first, or reject it with a reason.',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'This is the same queue as `mneia review --drain` and the same one `mneia_review_queue` reads. Draining it in the browser and draining it at a terminal are the same write through the same route.',
          ],
        },
        {
          kind: 'note',
          text: 'A **disputed** item never appears here. The queue lists active items, and a disagreement between two people is not settled by whichever of them opened the page - see `/docs/conflicts`.',
        },
      ],
    },
    {
      id: 'handoffs',
      heading: 'Handoffs',
      blocks: [
        {
          kind: 'table',
          head: ['Surface', 'What it is'],
          rows: [
            [
              '`/projects/{id}/handoffs`',
              'The project inbox: handoffs addressed to you, and handoffs left open. An open one is claimed by the first person to receive it',
            ],
            [
              '`/handoff/{id}`',
              'One handoff, as the artifact - the frozen markdown as it was written, with the item links still live',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'A `/handoff/{id}` link is the thing you paste to a colleague. Receiving it is what starts the pickup clock, which is the measurement that tells us whether the artifact actually reduces the cost of picking work up.',
            'An inbox that keeps growing is itself a finding: it means handoffs are being created and never received.',
          ],
        },
      ],
    },
    {
      id: 'team',
      heading: 'Team and invitations',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            '`/team` is who is in the workspace, and it is where membership is actually managed - the CLI’s `mneia team` reads the same roster and changes nothing.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            '**Invite a colleague by email.** Only a workspace lead can send one; the page says so rather than showing a control that will fail.',
            '**A join link** covers the case where email is the wrong channel.',
            '**Invitations waiting to be accepted** are listed, so an invitation that went nowhere is visible rather than assumed.',
            '**On a seated plan, an invitation needs a seat.** With none free, the control says to buy one from the billing page instead of failing at the moment somebody clicks the link.',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'A person can belong to more than one workspace, and the workspace switcher in the header moves between them. Everything on the page is scoped to the one currently selected.',
          ],
        },
      ],
    },
    {
      id: 'tokens',
      heading: 'API tokens and device approval',
      blocks: [
        {
          kind: 'table',
          head: ['Surface', 'What it is'],
          rows: [
            [
              '`/device`',
              'Where `mneia login` sends you. It shows the user code, the confirmation number, and which client is asking, and it approves or denies that one sign-in',
            ],
            [
              '`/tokens`',
              'Every live token in the workspace, with its label, when it was last used, and when it expires. Revoke one here',
            ],
          ],
        },
        {
          kind: 'bullets',
          items: [
            '**Check the workspace named on the approval page before approving.** A token carries its workspace, so approving a device claims whichever workspace was active in the browser at the time.',
            '**A token is stored only as a hash** and cannot be shown again.',
            '**Revoking takes effect on the token’s next request.** The machine holding it has to run `mneia login` again.',
            '**You can revoke your own tokens; revoking somebody else’s needs a workspace lead.**',
          ],
        },
        {
          kind: 'note',
          text: 'A token an application obtained through OAuth appears on this page like any other, and is revoked the same way - without involving the application that holds it. See `/docs/oauth`.',
        },
      ],
    },
    {
      id: 'billing',
      heading: 'Billing',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            '`/billing` shows the plan, the seats, the prepaid balance, and the usage meter for the current period - the same arithmetic the API enforces, so the page cannot show headroom a checkpoint is being refused for.',
            'Individual access is free. On a seated plan, billing is managed by the workspace lead, and the page offers checkout, the billing portal, and seat changes only to somebody who can actually use them.',
          ],
        },
        {
          kind: 'note',
          text: 'The prepaid balance can currently only be credited by us - there is no self-serve top-up, so for most workspaces it reads $0.00 and the allowance is the whole story. `/docs/metering` has the dials, the allowances, and what happens at the ceiling; `/pricing` has the commercial terms.',
        },
      ],
    },
    {
      id: 'not-here',
      heading: 'What the web app does not do',
      blocks: [
        {
          kind: 'bullets',
          items: [
            '**It does not checkpoint.** Capture happens where the session is - a terminal or an agent - because that is where the transcript lives.',
            '**It does not rehydrate into anything.** A slice is for the tool that is about to do the work; reading one in a browser would be a report rather than context.',
            '**It is not a chat interface, and it will not become one.** You already have one, and it is better than ours would be.',
            '**Conflict resolution is not finished here.** The schema records conflicts and the rules are settled - see `/docs/conflicts` - but the resolution surface is not something to rely on yet.',
          ],
        },
      ],
    },
  ],
};
