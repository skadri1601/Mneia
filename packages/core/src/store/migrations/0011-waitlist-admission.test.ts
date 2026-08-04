import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from './index.js';

const migration = MIGRATIONS.find(({ version }) => version === 11);
const sql = migration?.sql.replace(/\s+/g, ' ').trim() ?? '';

describe('waitlist admission migration', () => {
  it('registers version 11', () => {
    expect(migration?.name).toBe('waitlist-admission');
  });

  it('adds the admission trail to waitlist_signup', () => {
    expect(sql).toMatch(/ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'/i);
    expect(sql).toMatch(/CHECK \(status IN \('pending', 'approved', 'declined'\)\)/i);
    expect(sql).toMatch(/ADD COLUMN approved_at TIMESTAMPTZ/i);
    expect(sql).toMatch(/ADD COLUMN approved_by TEXT/i);
    expect(sql).toMatch(/ADD COLUMN invitation_ref TEXT/i);
  });

  it('refuses an approval that names neither a time nor an approver', () => {
    expect(sql).toMatch(
      /CONSTRAINT waitlist_signup_approval_is_attributed CHECK \(\(status = 'approved'\) = \(approved_at IS NOT NULL AND approved_by IS NOT NULL\)\)/i,
    );
  });

  it('indexes the pending queue the admin surface reads', () => {
    expect(sql).toMatch(
      /CREATE INDEX waitlist_signup_pending_idx ON waitlist_signup \(created_at, id\) WHERE status = 'pending';/i,
    );
  });

  it('constrains company_size to buckets rather than free text', () => {
    expect(sql).toMatch(/ALTER TABLE workspace ADD COLUMN company_size TEXT/i);
    expect(sql).toMatch(
      /company_size IS NULL OR company_size IN \('1-9', '10-49', '50-199', '200-499', '500\+'\)/i,
    );
  });
});
