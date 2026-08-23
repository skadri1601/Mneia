import type { DocSection } from './docs';
import type { Intro } from './pages';

export type BlogSlug =
  | 'the-unit-of-value-is-the-handoff'
  | 'seven-days-of-dogfooding'
  | 'the-watermark-that-skipped-600-turns';

export type BlogPost = {
  slug: BlogSlug;
  title: string;
  description: string;
  eyebrow: string;
  heading: string;
  lead: string;
  published: string;
  author: string;
  minutes: number;
  tags: readonly string[];
  sections: readonly DocSection[];
};

export const BLOG_INTRO: Intro = {
  eyebrow: 'Blog',
  heading: 'What we are building, and what it cost to learn.',
  lead: 'Notes from building the shared memory layer: the arguments we are betting on, and the bugs that taught us something worth writing down. Engineering posts name the commit.',
};

export const BLOG_STATUS =
  'Posts are dated and not silently rewritten. If something here stops being true - a milestone lands, a number moves, a claim is revoked - the correction goes in a new post rather than quietly over the old one.';

const HANDOFF_ESSAY: BlogPost = {
  slug: 'the-unit-of-value-is-the-handoff',
  title: 'The unit of value is not memory. It is the handoff.',
  description:
    'Every AI memory product gives you somewhere to put context and a way to query it. That is a database posture, and it fails at the exact moment it is needed - when someone is picking up work they did not do.',
  eyebrow: 'Thesis',
  heading: 'The unit of value is not memory. It is the handoff.',
  lead: 'Every competitor built a place to store context and a way to query it. Querying requires knowing what to ask, and the defining condition of picking up work is not knowing what you do not know.',
  published: '2026-08-11',
  author: 'Saad Kadri',
  minutes: 7,
  tags: ['Thesis', 'Product'],
  sections: [
    {
      id: 'the-query-problem',
      heading: 'Nobody types the most valuable question',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Here is the test we keep coming back to. Someone joins a piece of work on Wednesday that someone else started on Monday. They have a memory store, fully populated, perfectly indexed. What do they type?',
            'They type something about the task in front of them. They do not type **"what approaches did we already reject?"** - and that is almost always the most valuable thing in the store.',
            'This is not a search-quality problem that a better embedding fixes. It is structural. A query returns what you asked for, and the thing that hurts you when resuming work is precisely the thing you did not know to ask about. A store can only answer; it cannot volunteer.',
          ],
        },
        {
          kind: 'note',
          text: 'The failure is silent, which is what makes it expensive. Nobody notices the constraint they were never shown. They notice three days later, when the approach they took gets rejected in review for a reason that was settled a week before they arrived.',
        },
      ],
    },
    {
      id: 'push-not-pull',
      heading: 'Push, not pull',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'So the operation we build is not "retrieve". It is "hand over". An artifact produced at the moment work stops and consumed at the moment it resumes, containing the things the receiver would not have thought to pull.',
          ],
        },
        {
          kind: 'table',
          head: ['A memory store gives you', 'A handoff gives you'],
          rows: [
            ['Somewhere to put context', 'An object that arrives'],
            [
              'Results ranked by similarity to your query',
              'The single next action, and what blocks it',
            ],
            [
              'Whatever you knew to ask for',
              'The constraints you must not violate, asked for or not',
            ],
            ['A flat list of facts', 'What was tried, rejected, and must not be proposed again'],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'That last row is the one nobody else produces, and it is the one we would keep if we could only keep one. A deleted item cannot warn anyone. When something is superseded here, the replacement points at what it replaced and the old item stays, marked, with its reasoning intact - because what a team tried and rejected on Monday is exactly what a fresh agent proposes on Tuesday.',
          ],
        },
      ],
    },
    {
      id: 'what-it-forces',
      heading: 'What a transfer forces that a store does not',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Choosing the transfer over the store is not a framing exercise. It changes the data model on the first migration, and in ways that cannot be bolted on afterwards.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            '**Several writers, so provenance stops being optional.** Once work moves between people, every item has to record who asserted it - a human or an agent, which one, when. A human-confirmed constraint and an unconfirmed agent guess are not the same object and must not render the same way.',
            '**Disagreement becomes a first-class state.** Two writers will contradict each other. An agent contradicting a human-confirmed item is stored as disputed rather than applied; two humans contradicting each other is never auto-resolved, because arbitrating between colleagues is not a decision software should make on their behalf.',
            '**Permissions, because a transfer crosses a boundary.** Context does not stop at a team edge - a decision in payments changes what sales can promise - so the model assumes the company rather than the individual.',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'A single-user memory product has none of these problems, by construction. It also cannot grow into a product that does, because each one is a schema decision rather than a feature.',
          ],
        },
      ],
    },
    {
      id: 'crossing-tools',
      heading: 'And it has to survive crossing tools',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The other half of the bet: a handoff that only works inside one vendor’s client is not a handoff, it is a session feature.',
            'Work does not stay in one tool. It stops in Claude Code and resumes in Cursor, or stops with an agent and resumes with a person who does not use agents at all. Model providers are structurally incentivised against that kind of neutrality - their memory makes their client stickier, which is the point of building it.',
            'That gap does not close on its own, which is why we sit beside the frameworks and the clients rather than above them, and why the MCP server exposes no vendor-specific behaviour.',
          ],
        },
      ],
    },
    {
      id: 'what-keeps-you',
      heading: 'What actually keeps a team',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Not the feature list. Features get copied in a quarter.',
            'What compounds is the record: after a year, the project carries its own history of what was decided, why, who confirmed it, and what was already ruled out. A competitor cannot copy that, because it is not our software - it is the customer’s own history, and it gets more useful every month it grows.',
          ],
        },
      ],
    },
  ],
};

const DOGFOOD: BlogPost = {
  slug: 'seven-days-of-dogfooding',
  title: 'Seven days of dogfooding our own memory layer',
  description:
    'We wired five AI clients to our own project memory and ran the loop for a week. The interesting part was not whether it worked, but what had to be true before it could.',
  eyebrow: 'Build notes',
  heading: 'Seven days of dogfooding our own memory layer',
  lead: 'Five clients, two deterministic hooks, and one rule: if the loop is annoying enough to skip, the product does not work. Here is what had to be built before the clock could even start.',
  published: '2026-08-16',
  author: 'Saad Kadri',
  minutes: 8,
  tags: ['Build notes', 'Dogfooding'],
  sections: [
    {
      id: 'why',
      heading: 'Why a dogfood needed building at all',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The honest reason to dogfood is that the failure modes we care about only appear over days. A checkpoint that looks fine in a test looks different when it is the fourth one today and you are tired. Rehydration quality is invisible in a fixture and obvious when the slice you get back is missing the constraint you set on Monday.',
            'So the target was not a demo. It was seven consecutive days of the real loop, against this repository, with the same published clients a customer installs.',
          ],
        },
      ],
    },
    {
      id: 'clients',
      heading: 'Five clients, two of which are not JSON',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Claude Code, Cursor, Claude Desktop, Codex, and Gemini CLI. Two are repo-scoped and committed; three are user-scoped, so their real config paths are written out in the docs rather than faked into the repository.',
          ],
        },
        {
          kind: 'note',
          text: 'Codex takes TOML, not JSON. Pasting a JSON block into it is the single most likely setup failure, which is why it gets its own section in the client docs rather than a footnote. Client neutrality is a claim you have to pay for in documentation, not just in code.',
        },
        {
          kind: 'text',
          paragraphs: [
            'The four non-Claude-Code clients get both operations through the MCP server’s `instructions` field, which names no vendor and is pinned by a test so it cannot drift.',
          ],
        },
      ],
    },
    {
      id: 'hooks',
      heading: 'Making the loop deterministic',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Where the client allows it, the loop should not depend on remembering. Two hooks: `SessionStart` runs `mneia brief` and injects the slice, `Stop` runs `mneia checkpoint`.',
            'Both shell out to the published CLI rather than reimplementing the wire protocol. That is the whole point of a dogfood - if we call an internal path, we are testing something a customer does not have.',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'The `Stop` hook is where the real engineering went, because a checkpoint that fires once per turn instead of once per task boundary is worse than no checkpoint at all. Four guards:',
          ],
        },
        {
          kind: 'bullets',
          items: [
            'An active stop-hook flag returns immediately, so it cannot recurse into itself.',
            'No session marker means the session never rehydrated, so it never checkpoints.',
            'Fewer than six new transcript entries is a no-op - not every stop is a boundary.',
            'The lock is claimed with an exclusive-create write, so a concurrent stop loses the race rather than doubling up. A lock older than ten minutes is taken over once, so a killed process cannot wedge the session.',
          ],
        },
        {
          kind: 'note',
          text: 'The marker advances even after a failed attempt, because `mneia checkpoint` resumes from a server-side watermark. The marker is a debounce, never a record of what was captured - conflating those two is how you build something that silently drops sessions.',
        },
      ],
    },
    {
      id: 'gitignore',
      heading: 'The smallest blocker was a .gitignore line',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The project binding - which workspace and project this directory belongs to - is a property of the repository, not of one laptop. It is meant to be committed.',
            '`.gitignore` swallowed the whole of `.mneia/`, so the one file every client already reads could not be versioned. Narrowing it to `.mneia/*` plus a negation for `config.json` was a two-character fix that had been quietly making the binding a per-machine setup step for everyone.',
          ],
        },
        {
          kind: 'note',
          text: 'Credentials stay in `~/.mneia/credentials`, outside the repository, and nothing committed references them. The binding file holds no secret - that separation is what makes committing it safe.',
        },
      ],
    },
    {
      id: 'lesson',
      heading: 'What it changed',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The recurring lesson was that the interesting bugs were never in the ranking algorithm. They were in provenance - which session an item came from, and whether the answer could be trusted - and in the boundaries around the model call rather than the call itself.',
            'The other lesson is older and keeps being true: the checkpoint is the surface where the confirmation happens, so its interaction quality has weight out of all proportion to its size. Confirm has to be one keypress. Edit must not require retyping the item. Prompt only for what genuinely needs a human. A clumsy prompt there does not merely annoy - people skip the review, and the record stops being worth trusting.',
          ],
        },
      ],
    },
  ],
};

const WATERMARK: BlogPost = {
  slug: 'the-watermark-that-skipped-600-turns',
  title: 'The watermark that skipped 600 turns',
  description:
    'A transcript reducer, a progress marker, and an off-by-one-assumption that silently dropped half of every long session. The bug was in the gap between two correct components.',
  eyebrow: 'Build notes',
  heading: 'The watermark that skipped 600 turns',
  lead: 'Two components, each behaving exactly as designed, combining into permanent data loss. The trim was capped; the marker was not.',
  published: '2026-08-14',
  author: 'Saad Kadri',
  minutes: 7,
  tags: ['Build notes', 'Correctness'],
  sections: [
    {
      id: 'setup',
      heading: 'Two components, both correct',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'A checkpoint sends a session transcript to an extraction model, which returns candidate decisions, constraints, and open questions. Two mechanisms sit in that path.',
            'A **reducer**, which trims an oversized transcript down to a character cap before it is sent, because a model has a context window and a long session does not fit in it. And a **watermark**, which records how far through the session we have already extracted, so the next checkpoint resumes rather than re-reading and re-paying for everything.',
            'Both did exactly what they said. The reducer trimmed to its cap. The watermark advanced to the last turn it was handed.',
          ],
        },
      ],
    },
    {
      id: 'bug',
      heading: 'The bug is in the gap between them',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The watermark advanced to the last turn **fed in**, not the last turn actually **sent**.',
            'On a short session those are the same turn and nothing is wrong. On a session larger than the cap, the reducer drops everything past the limit - and the watermark sails right over the dropped turns and marks them as done. The next checkpoint resumes from beyond them. They are never extracted, and nothing anywhere reports a loss.',
          ],
        },
        {
          kind: 'note',
          text: 'A real session on this repository: 1,357 turns, 1.31M characters, against a 700,000-character cap. Roughly half the transcript was discarded, which is on the order of six hundred turns marked as captured that were never sent. The checkpoint reported success.',
        },
        {
          kind: 'text',
          paragraphs: [
            'That is the shape of failure we care about most, and the reason it is worth a post. It is not a crash. There is no error, no retry, no degraded status - just a session that is quietly half-remembered, in the exact product whose entire promise is that it does not forget.',
          ],
        },
      ],
    },
    {
      id: 'fix',
      heading: 'Splitting instead of trimming',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The instinct is to move the watermark to the last turn sent. That is necessary and not sufficient - it stops the data loss but leaves the tail permanently unreachable, because every subsequent run trims at the same place.',
            'The actual fix has three parts:',
          ],
        },
        {
          kind: 'bullets',
          items: [
            '**Split rather than trim.** An oversized transcript is chunked into pieces that each fit, instead of having its tail cut off. The cap on the server was removed entirely; chunking replaced it.',
            '**Advance only on success.** The watermark moves after a chunk parses, never before. A chunk that fails leaves the marker where it was, so the next run retries it rather than skipping it.',
            '**Stop the client trimming too.** The CLI had its own 700,000-character cap doing the same thing one layer up. A session larger than one request is now uploaded across successive runs, and the remainder is reported as pending rather than dropped.',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'A related failure lived next door and is worth naming, because it is the same class. Failover to a smaller fallback model did not check whether the prompt fit the window it was failing over to - so an oversized prompt was handed to a smaller model and failed there, reporting the wrong cause. The fallback now refuses a window that cannot hold the prompt and says so.',
          ],
        },
      ],
    },
    {
      id: 'lesson',
      heading: 'What we took from it',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Neither component was wrong in isolation, and neither had a bug you could find by reading it alone. The defect existed only in the seam - in an assumption one made about the other that was true at small sizes and false at large ones.',
            'The generalisable part: **a progress marker must never be derived from an input, only from a confirmed output.** "How far did I read" and "how far did I successfully process" look identical until something in between silently discards work, and by then the marker has already told you a lie you cannot detect.',
            'Both paths are now covered by tests that fail if the watermark moves over an unsent turn, which is the only version of this fix that stays fixed.',
          ],
        },
      ],
    },
  ],
};

export const BLOG_POSTS: readonly BlogPost[] = [DOGFOOD, WATERMARK, HANDOFF_ESSAY];

export function blogPost(slug: BlogSlug): BlogPost {
  const post = BLOG_POSTS.find((entry) => entry.slug === slug);
  if (!post) {
    throw new Error(`expected a blog post for "${slug}"; found none`);
  }
  return post;
}

export function formatPublished(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) {
    throw new Error(`expected an ISO date like 2026-08-17; received "${iso}"`);
  }
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${day} ${months[month - 1]} ${year}`;
}
