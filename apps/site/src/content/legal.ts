export type LegalBlock =
  | { kind: 'text'; paragraphs: readonly string[] }
  | { kind: 'bullets'; items: readonly string[] }
  | { kind: 'table'; head: readonly string[]; rows: readonly (readonly string[])[] }
  | { kind: 'note'; text: string };

export type LegalSection = {
  id: string;
  heading: string;
  blocks: readonly LegalBlock[];
};

export type LegalDoc = {
  title: string;
  effective: string;
  updated: string;
  lead: string;
  sections: readonly LegalSection[];
};

export const LEGAL_ENTITY = 'Saad Kadri, trading as Mneia';
export const LEGAL_EFFECTIVE = '1 August 2026';

export const CONTACT = {
  privacy: 'privacy@mneia.dev',
  legal: 'legal@mneia.dev',
  security: 'security@mneia.dev',
  grievance: 'grievance@mneia.dev',
} as const;

export const REVIEW_NOTICE =
  'These documents are published in draft ahead of the Service becoming generally available. They describe what Mneia does today and what it will do when the hosted Service launches, and they are kept current as that changes.';

const SUBPROCESSORS: LegalBlock = {
  kind: 'table',
  head: ['Provider', 'What it does', 'Where it processes'],
  rows: [
    ['Cloudflare, Inc.', 'Hosts and serves this website, and proxies the web app', 'United States'],
    ['DigitalOcean, LLC', 'Hosts the web app and the hosted API', 'United States'],
    [
      'Clerk, Inc.',
      'Authentication — holds your email, name, and sign-in records',
      'United States',
    ],
    ['Neon Inc.', 'Managed Postgres, the single store for all Service data', 'United States'],
    ['Functional Software, Inc. (Sentry)', 'Error reporting for this website', 'United States'],
    ['Resend (Plus Five Five, Inc.)', 'Sends the waitlist confirmation email', 'United States'],
    ['Stripe, Inc.', 'Payment processing and subscription billing', 'United States'],
    ['Anthropic PBC', 'Extraction and contradiction detection on checkpoint', 'United States'],
  ],
};

export const PRIVACY: LegalDoc = {
  title: 'Privacy Policy',
  effective: LEGAL_EFFECTIVE,
  updated: LEGAL_EFFECTIVE,
  lead: 'What we collect, why we collect it, who else touches it, and what you can make us do about it. Written to be read, not to be survived.',
  sections: [
    {
      id: 'who-we-are',
      heading: '1. Who we are, and how to reach us',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            `Mneia is operated by **${LEGAL_ENTITY}**, a sole proprietorship established in California, United States. Where this policy says "we", "us", or "Mneia", it means that person and that business. Where it says "you", it means whoever is reading: a visitor to this website, someone on the waitlist, or a user of the Service.`,
            `For anything in this policy, including exercising a right described below, write to **${CONTACT.privacy}**. We answer from a monitored mailbox, not an autoresponder.`,
          ],
        },
        {
          kind: 'table',
          head: ['Purpose', 'Address'],
          rows: [
            ['Privacy, data rights, and this policy', CONTACT.privacy],
            ['Terms, contracts, and legal notices', CONTACT.legal],
            ['Security reports and suspected breaches', CONTACT.security],
            ['Grievances under India’s DPDP Act', CONTACT.grievance],
          ],
        },
        {
          kind: 'note',
          text: 'We do not currently have an establishment in the EU or the UK. If we begin offering the Service to people in the EEA or the UK at a scale that requires a representative under Article 27 of the GDPR or the UK GDPR, we will appoint one and name them here before that processing begins.',
        },
      ],
    },
    {
      id: 'scope',
      heading: '2. What this policy covers',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'This policy covers three different things, and it is worth separating them, because right now they are not all live.',
          ],
        },
        {
          kind: 'table',
          head: ['Surface', 'Status', 'What it involves'],
          rows: [
            ['This website, mneia.dev', 'Live', 'Marketing pages you can read without an account'],
            [
              'The waitlist',
              'Live',
              'You give us a work email so we can tell you when access opens',
            ],
            [
              'The hosted Service',
              'Not yet generally available',
              'Checkpoint, rehydrate, and handoff, through the CLI, the MCP server, and the web app',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            '**Today, the only personal data we hold is a work email address if you joined the waitlist, plus the technical diagnostics described in section 4.** Everything this policy says about the Service describes what will happen when you use it. We are telling you now so the terms are not a surprise later, not because it is already happening.',
            'This policy does not cover third-party websites we link to, or the AI coding tools you use Mneia alongside. Claude Code, Cursor, Codex, and the rest each have their own policies and their own relationship with you.',
          ],
        },
      ],
    },
    {
      id: 'two-hats',
      heading: '3. The two roles we play, and why the difference matters',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Data protection law distinguishes between deciding **why** data is processed and merely processing it on someone else’s instructions. We do both, in different places, and your rights differ depending on which applies.',
          ],
        },
        {
          kind: 'table',
          head: ['What', 'Our role', 'What that means for you'],
          rows: [
            [
              'This website, the waitlist, your account, and billing',
              'Controller',
              'We decide why and how. Bring your requests to us directly.',
            ],
            [
              'The content inside a workspace: decisions, constraints, open questions, facts',
              'Processor',
              'Your organisation decides. We act on its instructions. Bring your requests to it first; we will help it answer you.',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'If you use Mneia through an employer or a team, **that organisation is the controller of everything you put into it.** It decides what is captured, who can see it, and when it is deleted. We will not hand your workspace content to you against your organisation’s instructions, and we will not withhold it from your organisation on yours. If you want your content deleted and your organisation says otherwise, that is a conversation to have with them.',
            'Where we act as a processor, a Data Processing Addendum forms part of our agreement with your organisation and governs that processing. It incorporates the Standard Contractual Clauses where they are required.',
          ],
        },
      ],
    },
    {
      id: 'website-data',
      heading: '4. What we collect from this website today',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            '**We set no cookies on this website. We run no advertising, no analytics product, and no session recording.** There is no tracking pixel, no fingerprinting script, and no data broker relationship. We are not being modest; there is genuinely nothing there.',
            'Two things do happen when you use this site.',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            '**The waitlist.** If you submit the form, we receive the work email address you typed. We use it for one thing: telling you when access opens. We do not sell it, rent it, share it for anyone else’s marketing, or add you to a newsletter you did not ask for. Every message we send will let you unsubscribe in one click, as the CAN-SPAM Act requires, and unsubscribing removes the address rather than merely suppressing it.',
            '**Error reporting.** When something breaks on this site, our error reporting sends us a diagnostic report. That report includes your **IP address**, operating system name and version, browser name and version, device characteristics, the page you were on, and a technical stack trace. It is processed by Sentry on our behalf and used only to find and fix the fault.',
          ],
        },
        {
          kind: 'note',
          text: 'An IP address is personal data in the EEA, the UK, India, and California. We collect it because a crash you cannot reproduce is a crash we cannot fix. If you would rather we did not, write to us and we will suppress IP collection for reports we can identify as yours.',
        },
      ],
    },
    {
      id: 'service-data',
      heading: '5. What the Service will collect when you use it',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Mneia is a hosted service. There is no local database and no offline mode; every surface is an authenticated client against one hosted API and one Postgres database. **Your content is on our servers by design, not by accident**, and you should decide whether that is acceptable to you before you put anything in it.',
          ],
        },
        {
          kind: 'table',
          head: ['Category', 'Examples', 'Where it comes from'],
          rows: [
            [
              'Account and identity',
              'Email, display name, external references such as a GitHub handle, authentication records',
              'You, and your identity provider',
            ],
            [
              'Organisation structure',
              'Workspaces, teams, team function, membership, roles, projects, repository URLs',
              'You and your administrators',
            ],
            [
              'Context items',
              'Decisions, constraints, open questions, facts, and pointers to pull requests, documents, and tickets, including the rationale attached to each',
              'Captured from your agent sessions at checkpoint',
            ],
            [
              'Session metadata',
              'Which tool a session ran in, when it started and ended, which actor it belonged to',
              'The client you connect from',
            ],
            [
              'Usage events',
              'Which items were shown, referenced, ignored, confirmed, edited, or rejected; conflicts detected and how they were resolved; handoffs created and received',
              'Your use of the Service',
            ],
            ['Billing', 'Plan, seat count, checkpoint consumption, invoices', 'You and Stripe'],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            '**Context items are the sensitive part, and we will not pretend otherwise.** A decision captured from an engineering session can contain architecture, credentials someone pasted carelessly, commercial terms, personnel matters, or anything else that was said while the work was being done. Mneia captures what your agent session produced. It cannot know in advance what that will contain.',
            'You control this through scope. Every item carries a visibility scope (private to the person who asserted it, project, team, workspace, or an explicit grant list), and scope is enforced at the API, not in the client. Choose it deliberately.',
          ],
        },
      ],
    },
    {
      id: 'ai',
      heading: '6. AI processing, and what we do not do with your content',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            '**Checkpointing sends your content to a large language model.** When you checkpoint, the relevant portion of your session is sent to Anthropic PBC, under our commercial account, to extract structured items and detect contradictions. We pay for that call; you do not bring your own key. It is the only marginal cost in the product, which is why it is the only thing we meter.',
          ],
        },
        {
          kind: 'note',
          text: 'We do not train models on your content. Not on your context items, not on your rationale, not on your handoffs. Model improvement uses behavioural signals only: which items were shown, referenced, ignored, confirmed, edited, or rejected, and which side of a conflict a human chose. Those signals travel as identifiers and outcomes, not as the words you wrote.',
        },
        {
          kind: 'text',
          paragraphs: [
            'That distinction is deliberate and we intend to keep it. If it ever changes, it will change by advance written notice and, where consent is the lawful basis, by asking you, not by an edit to this page.',
            'Our agreement with Anthropic prohibits them from training their models on data submitted through our commercial account. We do not control Anthropic’s own practices beyond that contract, and their terms are worth reading if this matters to you.',
            '**Extraction is automated, but it does not decide anything about you.** It produces suggestions you confirm, edit, or reject. No legal or similarly significant decision about any person is made by automated means, so the right to object to solely automated decision-making under Article 22 of the GDPR does not arise. If that ever changes, we will say so here first.',
          ],
        },
      ],
    },
    {
      id: 'why',
      heading: '7. Why we process it, and on what legal basis',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'For people in the EEA and the UK, Article 6 of the GDPR requires a lawful basis for every purpose. Ours are set out below. Where the basis is legitimate interests, you can object; see section 12.',
          ],
        },
        {
          kind: 'table',
          head: ['Purpose', 'Legal basis (GDPR Art. 6)'],
          rows: [
            ['Providing the Service you asked for', 'Performance of a contract'],
            [
              'Taking your work email for the waitlist',
              'Consent, which you may withdraw at any time',
            ],
            ['Billing, invoicing, and collecting payment', 'Performance of a contract'],
            [
              'Diagnosing errors and keeping the Service running',
              'Legitimate interests: a working product',
            ],
            [
              'Securing accounts and preventing abuse',
              'Legitimate interests: protecting you and other customers',
            ],
            [
              'Improving ranking and extraction from behavioural signals',
              'Legitimate interests: a product that gets better with use',
            ],
            ['Meeting tax, accounting, and legal obligations', 'Legal obligation'],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Where we act as a processor on your organisation’s behalf, the lawful basis is your organisation’s to establish, not ours.',
          ],
        },
      ],
    },
    {
      id: 'sharing',
      heading: '8. Who else touches your data',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            '**We do not sell your personal information, and we never have.** We do not share it for cross-context behavioural advertising. Under the CCPA as amended by the CPRA, and under every US state privacy statute that uses those terms, we neither sell nor share, and we have no data broker relationships to register.',
            'We do use service providers to run the product. Each is bound by contract to process data only on our instructions and to standards no weaker than this policy.',
          ],
        },
        SUBPROCESSORS,
        {
          kind: 'text',
          paragraphs: [
            'We will give notice before adding a sub-processor that handles customer content, so that organisations with a Data Processing Addendum can object.',
            'We may also disclose data where we are legally compelled to, to establish or defend legal claims, or to protect the rights and safety of people. **Where the law permits us to tell you about a demand for your data, we will, before we comply.** We will push back on requests that appear overbroad or defective.',
            'If the business is acquired or its assets transferred, data may move with it. You will be told before that happens, and any acquirer remains bound by commitments made here until you are given notice and a genuine choice.',
          ],
        },
      ],
    },
    {
      id: 'transfers',
      heading: '9. Sending data across borders',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'We are based in the United States and our infrastructure is in the United States. If you are outside it, using Mneia means your data is transferred there.',
            'For transfers from the EEA, the UK, and Switzerland, we rely on the **European Commission’s Standard Contractual Clauses**, with the UK International Data Transfer Addendum where the UK GDPR applies and the Swiss addendum where the revised FADP applies. Where a provider is certified under the EU-US Data Privacy Framework and its UK and Swiss extensions, we rely on that certification as well.',
            'We assess the destination country’s law before relying on those clauses, and we apply encryption in transit and at rest as a supplementary measure. You can request a copy of the relevant clauses from us.',
            'For transfers from India, we comply with the Digital Personal Data Protection Act, 2023 and will not transfer to any country the Central Government restricts. For Canada, Brazil, Australia, Japan, South Korea, and Nigeria, we rely on the contractual and consent mechanisms each of those regimes provides.',
          ],
        },
      ],
    },
    {
      id: 'retention',
      heading: '10. How long we keep it',
      blocks: [
        {
          kind: 'table',
          head: ['What', 'How long'],
          rows: [
            [
              'Waitlist email',
              'Until you unsubscribe or access opens, then deleted within 30 days',
            ],
            ['Error reports', '90 days'],
            ['Account records', 'For as long as the account is open'],
            [
              'Workspace content',
              'For as long as your organisation keeps it, subject to its plan’s history limit',
            ],
            ['Backups', 'Up to 35 days after deletion from live systems'],
            ['Billing and tax records', 'Seven years, because tax law requires it'],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'When you close an account we delete or irreversibly anonymise the associated personal data within **90 days**, except where we must keep it to meet a legal obligation or to establish or defend a legal claim. Behavioural signals already separated from identity are not restored to identity in order to delete them; they are no longer personal data at that point.',
          ],
        },
      ],
    },
    {
      id: 'security',
      heading: '11. How we protect it',
      blocks: [
        {
          kind: 'bullets',
          items: [
            'Encryption in transit (TLS) and at rest',
            'Access scoped and enforced at the API, never merely hidden in the client',
            'Authentication through a specialist provider rather than passwords we store ourselves',
            'Least-privilege access to production, limited to those who need it',
            'Secrets kept out of source control, with automated checks that they stay out',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            '**No system is perfectly secure, and anyone who tells you otherwise is selling something.** If a breach affects your personal data, we will notify the relevant supervisory authority within 72 hours where the GDPR requires it, notify you without undue delay where the risk to you is high, and meet the six-hour reporting requirement of India’s CERT-In directions where they apply. State breach notification laws in the United States will be met on their own timetables.',
            `If you have found a vulnerability, please tell us at **${CONTACT.security}**. We will not pursue legal action against good-faith security research that respects user privacy and does not degrade the Service.`,
          ],
        },
      ],
    },
    {
      id: 'rights-eu',
      heading: '12. Your rights in the EEA, the UK, and Switzerland',
      blocks: [
        {
          kind: 'bullets',
          items: [
            '**Access**: get a copy of the personal data we hold about you',
            '**Rectification**: have inaccurate data corrected',
            '**Erasure**: have data deleted where the grounds in Article 17 apply',
            '**Restriction**: have processing paused while a dispute is resolved',
            '**Portability**: receive data you gave us in a structured, machine-readable format',
            '**Objection**: object to processing based on legitimate interests, including profiling',
            '**Withdraw consent**: at any time, without affecting processing already carried out',
            '**Complain**: to your national supervisory authority, without coming to us first',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            `Write to **${CONTACT.privacy}**. We respond within **one month**, extendable by two further months for genuinely complex requests, and we will tell you if we extend. **We do not charge for this**, and we will not make you justify why you are asking.`,
            'If you are unhappy with our answer, you can complain to the supervisory authority where you live, work, or where you believe the problem occurred. In the UK that is the Information Commissioner’s Office. You do not need our permission and you do not need to exhaust our process first.',
          ],
        },
      ],
    },
    {
      id: 'rights-california',
      heading: '13. Your rights in California',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The California Consumer Privacy Act, as amended by the California Privacy Rights Act, gives California residents the rights below. **We do not sell or share personal information, so there is nothing for you to opt out of**, but the right exists and we are telling you about it rather than staying quiet.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            '**Know**: what we collect, where it came from, why, and who we disclose it to',
            '**Access**: a copy, covering the preceding 12 months and beyond on request',
            '**Delete**: subject to the exceptions in the statute',
            '**Correct**: inaccurate personal information',
            '**Opt out of sale or sharing**: we do neither, so this is nothing to exercise',
            '**Limit use of sensitive personal information**: we do not use it for inferring characteristics',
            '**Non-discrimination**: exercising a right will never change your price or service',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            `Make a request at **${CONTACT.privacy}**. We confirm within 10 business days and answer within 45 days, extendable once by a further 45 where the request is complex. You may use an authorised agent; we will ask for proof of their authority and for you to verify your own identity.`,
            '**Shine the Light.** California Civil Code section 1798.83 lets residents ask about personal information disclosed to third parties for their direct marketing. We disclose none, and never have.',
            '**Sensitive personal information.** We do not collect government identifiers, financial account credentials, precise geolocation, racial or ethnic origin, religious beliefs, union membership, genetic or biometric data, or health or sex life data. Card details go directly to Stripe and never reach our servers.',
          ],
        },
      ],
    },
    {
      id: 'rights-us-states',
      heading: '14. Your rights in other US states',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Comprehensive privacy statutes are in force in Virginia, Colorado, Connecticut, Utah, Texas, Oregon, Montana, Iowa, Delaware, Nebraska, New Hampshire, New Jersey, Tennessee, Minnesota, Maryland, Indiana, Kentucky, and Rhode Island. They differ in detail; we apply the most protective standard to everyone rather than sorting people by postcode.',
            'Wherever you live in the United States, you may **confirm** whether we process your data, **access** it, **correct** it, **delete** it, obtain a **portable copy**, and **opt out** of targeted advertising, sale, and profiling with legal or similarly significant effects. We do none of those last three.',
            '**If we refuse a request, you may appeal.** Colorado, Connecticut, Virginia, Texas, Montana, Oregon, Delaware, New Jersey, Minnesota, Maryland, and others require an appeal route, and we offer it to everyone. Reply to our refusal and a person will reconsider it within 45 days. If we still refuse, we will tell you how to contact your state Attorney General.',
            '**Washington My Health My Data Act.** We do not collect consumer health data as that statute defines it, and we do not sell it. Its definition is broad, so we monitor this rather than assuming.',
          ],
        },
      ],
    },
    {
      id: 'rights-india',
      heading: '15. Your rights in India',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Under the Digital Personal Data Protection Act, 2023 and the rules made under it, you are a Data Principal and we are a Data Fiduciary. You have the right to **access** a summary of your personal data and its processing, to **correction and erasure**, to **nominate** another person to exercise your rights if you die or become incapacitated, and to a **grievance redressal** process.',
            `Our Grievance Officer can be reached at **${CONTACT.grievance}**. We respond within the period the rules prescribe. If you are not satisfied, you may complain to the Data Protection Board of India.`,
            'Where we rely on your consent, our notice is available in English and we will provide it in any language listed in the Eighth Schedule to the Constitution on request. You may withdraw consent as easily as you gave it. We also comply with the Information Technology Act, 2000 and the SPDI Rules, 2011 in respect of sensitive personal data.',
          ],
        },
      ],
    },
    {
      id: 'rights-elsewhere',
      heading: '16. Your rights elsewhere',
      blocks: [
        {
          kind: 'table',
          head: ['Where you are', 'What applies'],
          rows: [
            [
              'Canada',
              'PIPEDA, and Quebec’s Law 25 including the right to data portability and to be informed of automated decisions',
            ],
            ['Brazil', 'LGPD: access, correction, anonymisation, portability, and deletion'],
            ['Australia', 'Privacy Act 1988 and the Australian Privacy Principles'],
            ['Japan', 'APPI: disclosure, correction, and suspension of use'],
            ['South Korea', 'PIPA: access, correction, deletion, and suspension of processing'],
            ['Nigeria', 'NDPA 2023: access, rectification, erasure, and objection'],
            ['New Zealand, Singapore, South Africa', 'Local access and correction rights'],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'If your country grants you a right this policy does not mention, you still have it, and asking us for it is enough.',
          ],
        },
      ],
    },
    {
      id: 'cookies',
      heading: '17. Cookies, tracking, and signals we honour',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            '**This website sets no cookies.** Because we set none, the consent requirements of the ePrivacy Directive and the UK PECR are not engaged, and there is no cookie banner for you to dismiss.',
            'When the Service launches, it will set strictly necessary cookies for authentication and security. Those are exempt from consent requirements because without them you cannot stay logged in. We will not add analytics or advertising cookies without asking first.',
            '**Global Privacy Control.** We honour the GPC browser signal as a valid opt-out of sale and sharing, as California and Colorado require. Since we neither sell nor share, the signal changes nothing in practice, but it is respected rather than ignored.',
            '**Do Not Track.** There is still no common standard for how sites should respond to DNT, so like most sites we do not respond to it differently. California law requires us to tell you that plainly, so we have.',
          ],
        },
      ],
    },
    {
      id: 'children',
      heading: '18. Children',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Mneia is a business tool and is not directed at children. **We do not knowingly collect personal data from anyone under 16**, and we do not permit under-16s to create accounts. If you believe a child has given us data, write to us and we will delete it. We comply with the Children’s Online Privacy Protection Act and, in India, with the DPDP Act’s requirement of verifiable parental consent for anyone under 18, which in practice means we do not offer the Service to them.',
          ],
        },
      ],
    },
    {
      id: 'changes',
      heading: '19. Changes to this policy',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'We will update this policy as the product changes; the Service launching will require it. The date at the top always reflects the current version.',
            '**For material changes that reduce your protections or widen what we do with your data, we will give at least 30 days’ notice** by email to account holders before they take effect, and where consent is the lawful basis we will ask again rather than assume. Continuing to use the Service after a change takes effect means you accept it; if you do not, you can close your account and export your data first.',
          ],
        },
      ],
    },
  ],
};

export const TERMS: LegalDoc = {
  title: 'Terms of Service',
  effective: LEGAL_EFFECTIVE,
  updated: LEGAL_EFFECTIVE,
  lead: 'The agreement between you and Mneia. It contains a binding arbitration clause and a class action waiver, which affect how disputes get resolved; section 19 sets out how to opt out.',
  sections: [
    {
      id: 'agreement',
      heading: '1. The agreement, and who is making it',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            `These Terms are a contract between you and **${LEGAL_ENTITY}**, a sole proprietorship established in California, United States.`,
            'You accept them by creating an account, using the Service, or joining the waitlist. If you are accepting on behalf of an organisation, **you are confirming you have authority to bind it**, and "you" then means that organisation. If you do not have that authority, do not accept.',
          ],
        },
        {
          kind: 'note',
          text: 'Section 19 requires most disputes to be resolved by individual arbitration and waives your right to a jury trial and to participate in a class action. You may opt out within 30 days without affecting anything else. Consumers in the EEA and the UK keep their local rights regardless.',
        },
      ],
    },
    {
      id: 'what-mneia-is',
      heading: '2. What Mneia is',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Mneia captures the decisions, constraints, and open questions produced in an AI agent session, and hands them to whoever picks the work up next. It does three things: **checkpoint**, **rehydrate**, and **handoff**.',
            '**It is a hosted service.** There is no local database, no offline mode, and no self-hosted deployment. The CLI, the MCP server, and the web app are all authenticated clients against one hosted API. An account is required and the clients do not function without one.',
            '**The Service is not yet generally available.** Access is opening in stages from the waitlist. Until we tell you your access is live, nothing here obliges us to provide the Service to you.',
          ],
        },
      ],
    },
    {
      id: 'open-source',
      heading: '3. The open-source clients',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The client packages (the CLI, the MCP server, the schema, the prompts, and the ranking logic) are published under the **Apache License, Version 2.0**. That licence governs them, and nothing in these Terms takes away a right it grants you.',
            '**The hosted service is proprietary.** The API, the store, the web app, billing, permissions, and audit are not open source and are not licensed to you except as the right to use the Service described here.',
            'Being able to read the client source does not mean you can run Mneia without us. That is a real limitation, we would rather say it here than let you discover it, and it changes if and when a bring-your-own-cloud deployment ships.',
          ],
        },
      ],
    },
    {
      id: 'accounts',
      heading: '4. Accounts and eligibility',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'You must be at least 16, and at least 18 in India, and not barred from receiving US-origin software under applicable sanctions and export law.',
            'You are responsible for what happens under your account and for keeping credentials secure. Tell us promptly if you suspect unauthorised access. **Accounts are for people, not for sharing**. A seat is one human being, and agents acting on your behalf count against your workspace rather than as separate seats.',
          ],
        },
      ],
    },
    {
      id: 'fees',
      heading: '5. Plans, fees, and what gets metered',
      blocks: [
        {
          kind: 'table',
          head: ['Plan', 'Price', 'Notes'],
          rows: [
            ['Solo', 'Free', 'One project, limited history, capped checkpoints. Free permanently.'],
            ['Team', 'Per user, per month', 'Plus an included checkpoint allowance, then overage'],
            [
              'Enterprise',
              'Custom',
              'Negotiated in a separate order form which prevails over these Terms',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            '**Checkpoints are metered because they cost us money.** Each one calls a large language model, and that call is the only meaningful marginal cost in the product. Everything else (rehydrate, handoff, search, status) is not metered. The included allowance is set well above ordinary use, so under normal conditions you will experience seat pricing and never think about it.',
            'Fees are billed in advance and are stated exclusive of taxes; you are responsible for any VAT, GST, or sales tax, and for withholding taxes where they apply. Prices may change with **30 days’ notice**, taking effect at your next renewal.',
            '**Refunds.** Fees are non-refundable except where the law requires otherwise, which for consumers in the EEA, the UK, and India it often does, and those rights are not affected by this paragraph. If we materially fail to provide the Service and do not fix it within a reasonable time, you can cancel and receive a pro-rata refund of prepaid fees.',
            'The Solo tier is free and we intend to keep it that way. We are not promising it will exist forever, but we will not convert it to a paid tier without notice and an export path.',
          ],
        },
      ],
    },
    {
      id: 'your-content',
      heading: '6. Your content, and who owns it',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            '**You own your content. We do not, and we make no claim to it.** That covers everything you put into Mneia or that Mneia captures from your sessions: decisions, constraints, rationale, handoffs, and the artefacts they point at.',
            'You grant us a **limited, non-exclusive, worldwide, royalty-free licence** to host, store, transmit, index, embed, display, and process your content **solely to provide the Service to you** and to meet our legal obligations. That licence exists so we can run the product. It ends when you delete the content or close your account, subject to the backup windows in our Privacy Policy.',
          ],
        },
        {
          kind: 'note',
          text: 'We do not train models on your content. Model improvement uses behavioural signals (which items were referenced, ignored, confirmed, edited, or rejected), not the words you wrote. This commitment is contractual, not merely a policy statement, and changing it requires advance written notice.',
        },
        {
          kind: 'text',
          paragraphs: [
            'You are responsible for having the right to put your content into Mneia, and for not putting in anything you are contractually or legally barred from disclosing to a service provider. **Checkpointing sends content to our LLM provider**. If that is incompatible with an obligation you owe someone else, do not checkpoint that work.',
          ],
        },
      ],
    },
    {
      id: 'acceptable-use',
      heading: '7. Acceptable use',
      blocks: [
        {
          kind: 'text',
          paragraphs: ['You will not:'],
        },
        {
          kind: 'bullets',
          items: [
            'Break the law, or use Mneia to help someone else break it',
            'Upload malware, or content you have no right to upload',
            'Attempt to access another customer’s workspace, or to defeat the scope enforcement that separates them',
            'Probe, scan, or load-test our infrastructure without written permission; security research under our disclosure process is welcome and exempt',
            'Resell or white-label the Service, or use it to build a competing product',
            'Scrape the Service, or use automation to evade metering, rate limits, or seat counts',
            'Use Mneia to store data that requires compliance we have not agreed to in writing: protected health information, cardholder data, or government classified material',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'We may suspend an account that is causing harm or risk to others. **Where circumstances allow, we will contact you first**, and suspension will be as narrow and as short as the problem requires.',
          ],
        },
      ],
    },
    {
      id: 'ai-outputs',
      heading: '8. AI outputs, and how much to trust them',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            '**Mneia uses large language models, and they get things wrong.** Extraction may miss a decision, capture one that was never made, or record a rationale imprecisely. Contradiction detection may flag a conflict that is not one, or miss one that is.',
            'Every extracted item is a **suggestion for you to confirm, edit, or reject**. That is why the confirmation step exists rather than being friction we forgot to remove. A human-confirmed item is never silently overridden by an agent’s assertion, and conflicts between two humans are never auto-resolved.',
            '**Do not rely on Mneia as the sole record of anything that matters.** It is a memory layer over your work, not the authoritative source. Keep your own records of decisions with legal, financial, or safety consequences. To the extent the law allows, we are not liable for a decision you made on the strength of an output that turned out to be wrong.',
          ],
        },
      ],
    },
    {
      id: 'our-ip',
      heading: '9. Our intellectual property',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The Service, the hosted platform, the Mneia name and marks, and everything we have written that is not published under an open-source licence remain ours. These Terms grant you the right to use the Service, not to own any part of it.',
            '**Feedback you send us, we may use freely** and without owing you anything. We would rather have your feedback than the awkwardness of a claim over it. This does not give us rights to your content.',
          ],
        },
      ],
    },
    {
      id: 'confidentiality',
      heading: '10. Confidentiality',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Each of us may learn confidential information from the other. We will each use it only for the purposes of this agreement, protect it with at least reasonable care, and not disclose it except to people who need it and are bound to keep it confidential.',
            '**Your content is your confidential information.** This obligation survives the end of the agreement. It does not apply to information that is public through no fault of the recipient, was already known, or is independently developed. Disclosure compelled by law is permitted, with notice to the other party where the law allows it.',
          ],
        },
      ],
    },
    {
      id: 'termination',
      heading: '11. Term, termination, and getting your data out',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The agreement runs until terminated. **You may close your account at any time**, for any reason or none. We may terminate for material breach you have not fixed within 30 days of notice, or immediately for the conduct in section 7. We may discontinue the Service entirely on 90 days’ notice, with a pro-rata refund of prepaid fees.',
            '**You can export your data at any time while the account is open, and for 30 days after it closes.** Export is a standing feature, not a favour granted on the way out, and we will not hold data hostage against unpaid fees; we will pursue those separately if we need to.',
            'After that window, data is deleted on the schedule in our Privacy Policy. Sections 6, 9, 10, 12, 13, 14, 19, and 20 survive termination.',
          ],
        },
      ],
    },
    {
      id: 'warranties',
      heading: '12. Warranties and disclaimers',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'We warrant that we will provide the Service with reasonable skill and care, and that we will not materially reduce its security during a paid term.',
            '**Beyond that, and to the fullest extent the law allows, the Service is provided "as is" and "as available", without warranties of any kind**, including merchantability, fitness for a particular purpose, non-infringement, and any warranty arising from course of dealing. We do not warrant that it will be uninterrupted, error-free, or that outputs will be accurate or complete.',
            'The Solo tier is free, and free means **provided without warranty of any kind**, with no service level and no uptime commitment.',
          ],
        },
        {
          kind: 'note',
          text: 'Some jurisdictions do not allow the exclusion of implied warranties. Consumers in the EEA, the UK, Australia, and India have statutory guarantees that cannot be excluded by contract. Nothing here limits those, and where they conflict with this section, they win.',
        },
      ],
    },
    {
      id: 'liability',
      heading: '13. Limitation of liability',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            '**Neither of us is liable for indirect, incidental, special, consequential, or punitive damages**, or for lost profits, revenue, goodwill, or data, even if told such damages were possible.',
            '**Our total liability is capped at the greater of the fees you paid us in the 12 months before the claim arose, or one hundred US dollars.** For the free tier, that cap is one hundred US dollars.',
          ],
        },
        {
          kind: 'note',
          text: 'These limits do not apply to death or personal injury caused by negligence, to fraud or fraudulent misrepresentation, to a party’s indemnification obligations, to your obligation to pay fees, or to anything else that cannot be limited under the law that applies to you. Consumer protections in the EEA, the UK, and India are not affected.',
        },
        {
          kind: 'text',
          paragraphs: [
            'This allocation of risk is a basis of the bargain and the reason the price is what it is. It applies even if a limited remedy fails of its essential purpose.',
          ],
        },
      ],
    },
    {
      id: 'indemnity',
      heading: '14. Indemnification',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            '**We will defend you** against a third-party claim that the Service as we provided it infringes their intellectual property, and pay any resulting settlement or award, provided you tell us promptly and let us control the defence.',
            '**You will defend us** against a third-party claim arising from your content, your use of the Service in breach of these Terms, or your violation of law or another person’s rights, on the same conditions.',
          ],
        },
      ],
    },
    {
      id: 'disputes',
      heading: '15. Disputes, arbitration, and how to opt out',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            '**Talk to us first.** Most problems are a misunderstanding. Write to us with the detail and give us 30 days. Most things end here.',
            `**Arbitration.** If that does not resolve it, disputes will be settled by binding individual arbitration administered by JAMS under its rules, seated in California, in English, before one arbitrator. Judgment on the award may be entered in any court with jurisdiction. **You are waiving your right to a jury trial**, and the arbitrator, not a court, decides questions about the scope of this clause, except as stated below.`,
            '**Class action waiver.** Disputes will be arbitrated **only on an individual basis**. Neither of us may bring a class, collective, consolidated, or representative action. If this waiver is held unenforceable as to a particular claim, that claim proceeds in court and the rest of this section still applies to everything else.',
          ],
        },
        {
          kind: 'note',
          text: 'You may opt out of arbitration and the class action waiver by emailing legal@mneia.dev within 30 days of first accepting these Terms, saying so plainly and identifying your account. Opting out costs you nothing and changes nothing else about your agreement or your service. We will not treat it as a reason to refuse or degrade service.',
        },
        {
          kind: 'text',
          paragraphs: [
            '**What is carved out.** These apply regardless of the above: either of us may seek injunctive relief in court to protect intellectual property or confidential information; either of us may bring a claim in small claims court if it qualifies; and public injunctive relief is not waived where California law preserves it.',
            '**If you are a consumer in the EEA or the UK**, this section does not apply to you. You may bring proceedings in the courts of your country of residence, under its law, and you keep access to the EU Online Dispute Resolution platform. **If you are in India**, nothing here limits your rights under the Consumer Protection Act, 2019.',
          ],
        },
      ],
    },
    {
      id: 'governing-law',
      heading: '16. Governing law',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'These Terms are governed by the laws of the **State of California**, excluding its conflict-of-laws rules and the UN Convention on Contracts for the International Sale of Goods. Where section 15 does not require arbitration, the state and federal courts of California have exclusive jurisdiction and both of us consent to venue there.',
            '**This does not deprive a consumer of the protection of mandatory law where they live.** If you are a consumer in the EEA, the UK, India, or anywhere else whose law says its rules apply to you regardless of what a contract says, those rules apply and this section yields to them.',
          ],
        },
      ],
    },
    {
      id: 'changes',
      heading: '17. Changes to these Terms',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'We may change these Terms. **For material changes we will give at least 30 days’ notice** by email and by updating the date at the top. Continuing to use the Service after they take effect means you accept them.',
            '**If you do not accept a material change, you may terminate before it takes effect and receive a pro-rata refund of prepaid fees.** A change that materially reduces your rights does not apply retroactively to a dispute that arose before it.',
          ],
        },
      ],
    },
    {
      id: 'general',
      heading: '18. General',
      blocks: [
        {
          kind: 'bullets',
          items: [
            '**Entire agreement**: these Terms, the Privacy Policy, any Data Processing Addendum, and any order form are the whole agreement. An Enterprise order form prevails over these Terms where they conflict.',
            '**Severability**: if a provision is unenforceable, the rest stands and the provision is narrowed to what is enforceable.',
            '**No waiver**: not enforcing something once does not waive it.',
            '**Assignment**: you may not assign without our consent; we may assign to a successor of the business, subject to the notice in our Privacy Policy.',
            '**Force majeure**: neither of us is liable for delay caused by events genuinely beyond our control. This does not excuse paying money that is owed.',
            '**Notices**: to you by email or in the Service; to us at legal@mneia.dev.',
            '**No third-party beneficiaries**: nobody outside this agreement gets rights under it.',
            '**Export and sanctions**: you will comply with US export control and sanctions law.',
            '**Language**: English is the governing language; translations are for convenience.',
          ],
        },
      ],
    },
  ],
};
