import type { Metadata } from 'next';
import { ButtonPrimary } from '@/components/Button';
import prose from '@/components/Prose.module.css';
import { Tile } from '@/components/Tile';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Solo is free and stays free. Teams pay per seat with an included checkpoint allowance. Enterprise is custom.',
};

const TIERS = [
  {
    name: 'Solo',
    price: 'Free',
    unit: '',
    note: 'Free, and not a trial. Individual use is how the product spreads, so charging for it would be charging for our own distribution.',
    contents: [
      'One project',
      '30-day history',
      'Capped checkpoints',
      'MCP server and CLI',
      'Handoffs to yourself',
    ],
    featured: false,
  },
  {
    name: 'Team',
    price: '$24',
    unit: ' / user / month',
    note: 'Plus an included checkpoint allowance sized well above ordinary use.',
    contents: [
      'Shared projects and roles',
      'Cross-team scope',
      'Conflict resolution',
      'Unlimited history',
      'Team handoffs',
      'Web review app',
    ],
    featured: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    unit: '',
    note: 'For organisations that need governance over what context agents can see.',
    contents: [
      'SSO and SAML',
      'Audit export',
      'Permission scopes',
      'Data residency',
      'Bring your own cloud',
      'Support SLA',
    ],
    featured: false,
  },
];

const METERING = [
  {
    action: 'Checkpoint',
    cost: 'The extraction call — effectively the entire marginal cost',
    metered: 'Metered',
  },
  {
    action: 'Contradiction detection',
    cost: 'Small, runs on a higher-tier model',
    metered: 'Rolled into the checkpoint',
  },
  {
    action: 'Rehydrate',
    cost: 'One indexed query. Fractions of a cent',
    metered: 'Not metered',
  },
  {
    action: 'Handoff, log, status, search',
    cost: 'Negligible',
    metered: 'Not metered',
  },
  {
    action: 'Storage',
    cost: 'Meaningful only at extremes',
    metered: 'Fair-use ceiling only',
  },
];

export default function PricingPage() {
  return (
    <>
      <Tile surface="canvas" wide>
        <p className={prose.eyebrow}>Pricing</p>
        <h1 className={prose.hero}>Priced per seat, metered on one thing.</h1>
        <p className={prose.lead}>
          There is exactly one action in the product with a real marginal cost. Everything else is a
          database query, and we do not think you should be counting those.
        </p>

        <div className={styles.tiers}>
          {TIERS.map((tier) => (
            <div
              className={`${styles.tier} ${tier.featured ? styles.featured : ''}`}
              key={tier.name}
            >
              <div className={styles.tierName}>{tier.name}</div>
              <div className={styles.price}>
                {tier.price}
                {tier.unit ? <span className={styles.unit}>{tier.unit}</span> : null}
              </div>
              <p className={styles.tierNote}>{tier.note}</p>
              <ul className={styles.contents}>
                {tier.contents.map((item) => (
                  <li key={item}>
                    <span className={styles.tick}>—</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className={styles.preview}>
          <strong>Pricing is in preview.</strong> The seat price is set against what comparable
          tools charge, but the number is not final until we have measured what a real checkpoint
          costs us to run. If it moves before general availability, it moves before anyone is billed
          — not after.
        </div>
      </Tile>

      <Tile surface="dark1" wide>
        <p className={prose.eyebrow}>What gets metered</p>
        <h2 className={prose.displayLg}>One line item, not a bill you have to parse.</h2>
        <div className={prose.body}>
          <p>
            A checkpoint runs an extraction pass over your session. That call is the cost. The seat
            price includes an allowance set at several times ordinary use, so a normal month never
            touches it — the ceiling exists so a runaway loop in CI cannot quietly invert the
            economics.
          </p>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.meterTable}>
            <thead>
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Marginal cost</th>
                <th scope="col">Metered</th>
              </tr>
            </thead>
            <tbody>
              {METERING.map((row) => (
                <tr key={row.action}>
                  <th scope="row">{row.action}</th>
                  <td>{row.cost}</td>
                  <td>{row.metered}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tile>

      <Tile surface="canvas">
        <p className={prose.eyebrow}>No key required</p>
        <h2 className={prose.displayMd}>We pay for inference, not you.</h2>
        <div className={`${prose.body} ${prose.stack}`}>
          <p>
            You will not be asked for a model provider key. Charging a seat price and then asking
            you to fund the model calls on top would be charging for the same product twice, and it
            would put our costs on your monthly bill.
          </p>
          <p>
            <strong>The consequence is ours to carry:</strong> the seat price has variable cost
            inside it, which is exactly why the included allowance is a real number rather than a
            formality.
          </p>
        </div>
        <div className={prose.actions}>
          <ButtonPrimary href="/#waitlist">Request access</ButtonPrimary>
        </div>
      </Tile>
    </>
  );
}
