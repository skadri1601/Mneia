'use client';

import { type FormEvent, useState } from 'react';
import { ButtonSubmit } from './Button';
import styles from './WaitlistForm.module.css';

type Status = 'idle' | 'submitting' | 'done' | 'error';

const RESTING_NOTE =
  'This deletes your address rather than suppressing it, and takes effect immediately.';
const DONE_NOTE = 'Done. Your address has been deleted and you will hear nothing further.';
const UNREACHABLE_NOTE = 'We could not reach the server. Check your connection and try again.';
const FALLBACK_ERROR = 'Something went wrong. Try again shortly.';
const MISSING_TOKEN_NOTE =
  'That link is missing its unsubscribe token. Use the link from the email, or write to privacy@mneia.dev and we will remove you by hand.';

function errorFrom(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return FALLBACK_ERROR;
  const { error } = payload as Record<string, unknown>;
  return typeof error === 'string' && error.length > 0 ? error : FALLBACK_ERROR;
}

function accepted(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as Record<string, unknown>).ok === true
  );
}

export function UnsubscribeForm({ token }: { token: string }) {
  const [status, setStatus] = useState<Status>('idle');
  const [note, setNote] = useState(token.length > 0 ? RESTING_NOTE : MISSING_TOKEN_NOTE);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('submitting');

    try {
      const response = await fetch(`/api/waitlist/unsubscribe?token=${encodeURIComponent(token)}`, {
        method: 'POST',
      });

      const payload: unknown = await response.json().catch(() => null);

      if (response.ok && accepted(payload)) {
        setStatus('done');
        setNote(DONE_NOTE);
        return;
      }

      setStatus('error');
      setNote(errorFrom(payload));
    } catch {
      setStatus('error');
      setNote(UNREACHABLE_NOTE);
    }
  }

  const busy = status === 'submitting';
  const settled = status === 'done';

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      {settled || token.length === 0 ? null : (
        <ButtonSubmit disabled={busy}>{busy ? 'Removing' : 'Unsubscribe'}</ButtonSubmit>
      )}
      <p
        className={status === 'idle' ? styles.note : `${styles.note} ${styles.noteStrong}`}
        aria-live="polite"
      >
        {note}
      </p>
    </form>
  );
}
