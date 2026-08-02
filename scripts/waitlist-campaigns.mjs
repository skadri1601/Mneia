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
    subject: 'Your Mneia access is open',
    body: ({ accessUrl, optOutUrl }) =>
      [
        'You asked for early access to Mneia, and we said you would hear from us',
        'once — when access opened. This is that email.',
        '',
        `Sign in and create your workspace here: ${accessUrl}`,
        '',
        'Mneia is the shared project memory and handoff layer for teams working with',
        'AI agents. Three operations, and nothing else: checkpoint what was decided,',
        'rehydrate the next session with only the context that matters, and hand work',
        'over as an artifact the next person can actually receive.',
        '',
        'If something does not work, reply to this message — it reaches a person.',
        '',
        'This is the last email you will get from the waitlist. Your address comes off',
        'the list within 30 days now that access is open, as our privacy policy says.',
        '',
        'To remove it immediately, open this link — it deletes your address rather than',
        'suppressing it, and takes effect at once:',
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
