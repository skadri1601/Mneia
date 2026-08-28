import type { DocPage } from './types';

export const METERING: DocPage = {
  slug: 'metering',
  name: 'Metering and allowances',
  title: 'Metering and allowances',
  description:
    'What Mneia meters and what it does not: the three dials on a checkpoint, how a plan allowance is sized and pooled across seats, the prepaid wallet, per-token pricing in micros, and what happens when an allowance runs out.',
  eyebrow: 'Reference',
  heading: 'One action costs money. Everything else is a query.',
  lead: 'A checkpoint runs a model over your session, and that call is the entire marginal cost of the product. Rehydrate, handoff, search, log, and status are one indexed query each. So exactly one thing is metered, and this page says precisely how.',
  minutes: 12,
  sections: [
    {
      id: 'what-is-metered',
      heading: 'What is metered',
      blocks: [
        {
          kind: 'table',
          head: ['Operation', 'What it costs us', 'Metered'],
          rows: [
            [
              '**Checkpoint**',
              'The extraction call over your session transcript. Effectively the whole marginal cost',
              'Yes, on three dials',
            ],
            [
              '**Contradiction detection**',
              'Small, and it runs as part of the same pass',
              'Rolled into the checkpoint',
            ],
            ['**Rehydrate**', 'One indexed query, plus an embedding of the task', 'No'],
            ['**Handoff, pickup, search, log, status, verify, review**', 'Negligible', 'No'],
            ['**Storage**', 'Meaningful only at extremes', 'Fair-use ceiling only'],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'You are never asked for a model provider key. Charging a seat price and then asking you to fund the model calls on top would be charging for the same product twice, and it would put our costs on your monthly bill. The consequence is ours to carry, which is exactly why the included allowance is a real number rather than a formality.',
          ],
        },
        {
          kind: 'note',
          text: 'Prices, tiers, and what is buyable today are on **/pricing**, and that page is the commercial statement. This one is the mechanism: what is counted, how, and what happens at the ceiling.',
        },
      ],
    },
    {
      id: 'dials',
      heading: 'The three dials',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'A checkpoint is not one unit. Its cost is roughly `turns × rate + extractions × prompt overhead`, so a single dial is gameable from whichever side it does not measure: a turn allowance alone admits thousands of tiny extractions paying pure overhead, and an extraction allowance alone admits one enormous upload.',
          ],
        },
        {
          kind: 'table',
          head: ['Dial', 'Counts', 'Why it exists'],
          rows: [
            [
              '`turns`',
              'Conversation turns uploaded for extraction',
              'Bounds the size of what you send. This is the dial a very long session moves',
            ],
            [
              '`extractions`',
              'Extraction calls made',
              'Bounds how often you send. This is the dial a scripted loop moves',
            ],
            [
              '`embedding_tokens`',
              'Tokens embedded when items are written',
              'Deliberately slack. Embeddings cost a few cents per seat per month, which is not worth a customer managing - it is recorded so the spend is visible and can be re-sized from data',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'The turn allowance is set at the extraction allowance times **160**, the measured mean turns per checkpoint on this repository. At a typical session shape the two bind at about the same point, so neither silently caps the other.',
            'Usage accumulates in a **calendar month** period, in UTC, and resets at the start of the next one.',
          ],
        },
      ],
    },
    {
      id: 'allowances',
      heading: 'Allowances per plan',
      blocks: [
        {
          kind: 'table',
          head: ['Plan', 'Projects', 'Turns', 'Extractions', 'Embedding tokens'],
          rows: [
            ['Solo', '1', '64,000', '400', '640,000'],
            ['Pro', 'Unlimited', '272,000', '1,700', '2,720,000'],
            ['Team', 'Unlimited', '448,000 per seat', '2,800 per seat', '4,480,000 per seat'],
            ['Enterprise', 'Unlimited', 'Unmetered', 'Unmetered', 'Unmetered'],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            '**Team allowances are per seat and pooled.** The workspace total is the per-seat figure times the seats actually paid for, so a heavy user draws on a quiet colleague’s share rather than being cut off while the team has headroom.',
            'These are ceilings, not forecasts. Over a measured fortnight the heaviest workspace we have ran about 10.6 checkpoints a day - Pro’s allowance is more than five times that. A ceiling exists to bound a runaway client and a scripted free account, not to ration a working developer.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            '**Solo is free, and its ceiling is fixed.** Its job is distribution rather than revenue, so it is sized where a scripted account stops costing us meaningfully - not where a person would notice it.',
            '**A workspace can carry its own override on any dial.** A non-null override wins over the plan default, which is how a promotional grant, a design partner, or a negotiated arrangement lands without inventing a new plan.',
            '**Enterprise is not sold.** It is the internal and design-partner vehicle, uncapped by construction so that dogfooding is never billed against a customer ceiling.',
          ],
        },
        {
          kind: 'note',
          text: 'The billing page and the API read the **same** arithmetic the enforcer uses, seat pooling included. Deriving the numbers a second time for display is how a page ends up telling a customer they have headroom the API is refusing, and a meter that disagrees with the gate is worse than no meter at all.',
        },
      ],
    },
    {
      id: 'reading-the-meter',
      heading: 'Reading the meter',
      blocks: [
        {
          kind: 'code',
          label: 'shell',
          lines: [
            '$ mneia status',
            '...',
            '  Usage      41% of this month’s allowance (694 of 1700 extractions)',
            '             resets 2026-09-01',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'The headline percentage is **the larger of the turns and extractions fractions**, rounded down so 99.6% never reads as 100 while the workspace can still write. A warning appears at 80%.',
            'The embedding dial is deliberately excluded from that percentage. It is recorded so cost is computable, but a customer cannot act on it, and letting it move the headline number would show a bar moving for a reason nobody can explain.',
            'An unmetered dial reports no percentage at all rather than zero - "no limit" and "nothing used" are different answers, and conflating them is how an enterprise workspace appears to be idle.',
          ],
        },
        {
          kind: 'table',
          head: ['Surface', 'Shows'],
          rows: [
            ['`mneia status`', 'The percentage, the binding dial, and when the period resets'],
            [
              '`GET /api/v1/usage`',
              'The same report as JSON: every dial with its used, allowance, and fraction',
            ],
            ['The billing page', 'The plan, the seats, the prepaid balance, and the same meter'],
          ],
        },
      ],
    },
    {
      id: 'wallet',
      heading: 'The prepaid wallet',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Allowance first, then prepaid balance. When a dial is spent, work does not stop while there is a balance to draw on - only an empty wallet refuses.',
            'The balance lives on the workspace as `wallet_balance_micros`, and every movement is a row in `wallet_ledger` with its amount, its reason, and who caused it. The balance is the running figure; the ledger is the record of how it got there.',
          ],
        },
        {
          kind: 'table',
          head: ['Ledger kind', 'Means'],
          rows: [
            [
              '`grant`',
              'Balance we added without a payment - a design partner, a make-good, a promotion',
            ],
            ['`topup`', 'Balance added against a payment'],
            ['`debit`', 'Balance spent by a checkpoint that ran past its allowance'],
          ],
        },
        {
          kind: 'note',
          text: '**There is no self-serve top-up today.** The prepaid balance can currently only be credited by us, so for most workspaces it reads $0.00 and the wallet never comes into play - the allowance is the whole story. This is stated plainly rather than left to be discovered: a refusal that points at a button which does not exist is not actionable.',
        },
        {
          kind: 'text',
          paragraphs: [
            'A pre-flight check prices the request from the prompt size before the call is made, assuming a generous completion. That figure is an **authorization**, not a charge. The real cost is only known once the provider reports its token counts, and the debit is reconciled against it - downwards only. The estimate is nearly always larger than the truth, and on the rare occasion it is not, the excess is absorbed rather than charged past what the request was admitted for.',
          ],
        },
      ],
    },
    {
      id: 'pricing-arithmetic',
      heading: 'How a call is priced',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Cost is recorded in **micros** - millionths of a dollar. A checkpoint costs single-digit thousandths of a dollar, which cents cannot express, and floating point would drift once a wallet accumulates thousands of debits.',
          ],
        },
        {
          kind: 'code',
          label: 'arithmetic',
          lines: [
            'cost = uncached_input_tokens × input_rate',
            '     + cached_input_tokens   × cached_rate     # a tenth of the input rate',
            '     + output_tokens         × output_rate     # includes reasoning tokens',
            '',
            '# rounded up to the nearest micro, so a long tail of',
            '# sub-micro calls cannot accumulate as free usage',
          ],
        },
        {
          kind: 'bullets',
          items: [
            'Rates are per model, and are the provider’s published list prices. They are not read from the provider at run time, so an upstream price change shows up as drift between what we meter and what we are billed.',
            'Two service tiers are listed per model rather than one being derived from the other, so a future tier that is not a clean halving cannot be introduced by accident.',
            'The fallback model is several times the price of the primary. That is the cost of not losing a checkpoint to an outage, and it is priced honestly rather than hidden.',
            '**A model that can be called but not priced is a bug, not a free call.** Pricing an unknown model refuses loudly rather than metering zero and silently inverting the margin.',
            'Above the provider’s long-context threshold, input bills at double and output at 1.5× for the entire request. Transcripts are chunked below that line so it should never apply - it is priced anyway, so that if a chunk ever does cross it the ledger says what it really cost.',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Every extraction attempt - succeeded, failed, or fell back - is recorded in `checkpoint_usage` with its model, token counts, duration, outcome, and cost. A failed attempt still consumed tokens, and a record that only kept the successes would understate the bill it is there to explain.',
          ],
        },
      ],
    },
    {
      id: 'refusals',
      heading: 'When a checkpoint is refused',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The check happens before the money is spent, and it is checked against what the request will actually consume rather than only what is already spent - so a single oversized upload cannot step over the ceiling in one move.',
          ],
        },
        {
          kind: 'table',
          head: ['Refusal', 'Means', 'What to do'],
          rows: [
            [
              '`allowance_exhausted`',
              'A dial is spent and there is no prepaid balance to cover the request. The message names which dial',
              'Wait for the period to reset, or raise the ceiling - the message names the one control that exists for your plan',
            ],
            [
              '`wallet_empty`',
              'Past the allowance, with a balance too small for the request',
              'The balance is credited by us; there is no self-serve top-up',
            ],
            [
              '`seats_exceeded`',
              'A seated workspace has more members than purchased seats',
              'Add seats, or remove members',
            ],
            [
              '`subscription_inactive`',
              'A paid plan whose subscription is not active, trialing, or past due',
              'Update the payment method from the billing page',
            ],
          ],
        },
        {
          kind: 'note',
          text: 'Every paid plan needs a live subscription, not only the seated one. Gating on the seated plan alone let a cancelled single-seat workspace keep its full allowance indefinitely, which is a bug rather than a grace period.',
        },
        {
          kind: 'text',
          paragraphs: [
            'A refusal is a refusal to run an extraction. Nothing already recorded is affected, and every read operation - rehydrate, brief, log, status, handoff, pickup - keeps working, because none of them costs anything worth metering.',
          ],
        },
      ],
    },
    {
      id: 'where-it-lives',
      heading: 'Where it is recorded',
      blocks: [
        {
          kind: 'table',
          head: ['Table', 'Holds'],
          rows: [
            [
              '`workspace`',
              'The plan, the billing status, purchased seats, per-dial allowance overrides, and `wallet_balance_micros`',
            ],
            [
              '`workspace_usage_period`',
              'One row per workspace per month: checkpoints, turns, extractions, and embedding tokens used',
            ],
            [
              '`checkpoint_usage`',
              'One row per extraction attempt: model, input and output tokens, duration, outcome, and cost in micros',
            ],
            ['`wallet_ledger`', 'Every grant, top-up, and debit, with its reason'],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'The usage period is incremented inside the same transaction that records the checkpoint, so it cannot drift from the thing it counts. It is a projection of the event spine rather than a second source of truth - see `/docs/data-model#events`.',
          ],
        },
      ],
    },
  ],
};
