export const siteOrigin = () =>
  (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mneia.dev').replace(/\/+$/, '');

export const unsubscribePostUrl = (token) =>
  `${siteOrigin()}/api/waitlist/unsubscribe?token=${encodeURIComponent(token)}`;

export const unsubscribePageUrl = (token) =>
  `${siteOrigin()}/unsubscribe?token=${encodeURIComponent(token)}`;

const CAMPAIGNS = {
  'access-open': {
    id: 'access-open',
    summary: 'Tells a subscriber their access is live. The one message the waitlist consented to.',
    requires: {
      accessUrl: 'the URL a subscriber signs up at, e.g. https://app.mneia.dev/sign-up',
    },
    subject: 'Mneia is open — come on in',
    body: ({ accessUrl, optOutUrl }) =>
      [
        'Hello, and thank you for waiting.',
        '',
        'You put your name down for early access to Mneia, and we promised you would',
        'hear from us exactly once — the day it opened. Today is that day, and this is',
        'that email. We are genuinely glad you are here.',
        '',
        `Come and make yourself at home: ${accessUrl}`,
        '',
        'Here is what you are walking into. Mneia is shared project memory for teams',
        'working with AI agents. It does three things, and cheerfully nothing else:',
        '',
        '  checkpoint   capture what was decided and why, before the context is gone',
        '  rehydrate    start the next session with only what actually matters',
        '  handoff      pass work on as something the next person can really pick up',
        '',
        'If you have ever re-explained a decision to an agent that had already made it',
        'with you, that is the itch we built this to scratch.',
        '',
        'It is early days, and your first impressions are worth more to us now than they',
        'will ever be again. Reply to this message and it reaches a person — we read',
        'every one, and we answer.',
        '',
        'Thank you for the early vote of confidence. We hope you enjoy it.',
        '',
        '— The Mneia team',
        '',
        'One last thing, because we would rather be straight with you: this is the final',
        'email from the waitlist. Your address comes off the list within 30 days now that',
        'access is open, exactly as our privacy policy says.',
        '',
        'If you would rather it went right now, this link deletes it immediately — it',
        'removes your address rather than suppressing it, and takes effect at once:',
        optOutUrl,
      ].join('\n'),
  },
};

export const campaignNames = () => Object.keys(CAMPAIGNS);

export function findCampaign(name) {
  return Object.hasOwn(CAMPAIGNS, name) ? CAMPAIGNS[name] : undefined;
}

export function missingVariables(campaign, vars) {
  return Object.keys(campaign.requires ?? {}).filter(
    (key) => typeof vars[key] !== 'string' || vars[key].trim() === '',
  );
}

export function renderCampaign(campaign, { unsubscribeToken, vars = {} }) {
  const missing = missingVariables(campaign, vars);

  if (missing.length > 0) {
    throw new Error(
      `campaign ${campaign.id} expects ${missing.join(', ')}; none supplied — pass --var ${missing[0]}=<value>`,
    );
  }

  const oneClickUrl = unsubscribePostUrl(unsubscribeToken);
  const optOutUrl = unsubscribePageUrl(unsubscribeToken);

  return {
    subject: campaign.subject,
    text: campaign.body({ ...vars, optOutUrl }),
    headers: {
      'List-Unsubscribe': `<${oneClickUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
