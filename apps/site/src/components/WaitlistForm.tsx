'use client';

import { type FormEvent, useState } from 'react';
import { ButtonSubmit } from './Button';
import styles from './WaitlistForm.module.css';

type Status = 'idle' | 'submitting' | 'done' | 'error';

const RESTING_NOTE =
  'One email when your access is ready. Nothing else, and no sharing with anyone.';
const DONE_NOTE = 'You are on the list. We will email you when your access is ready.';
const UNREACHABLE_NOTE = 'We could not reach the server. Check your connection and try again.';
const FALLBACK_ERROR = 'Something went wrong. Try again shortly.';

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

export function WaitlistForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [note, setNote] = useState(RESTING_NOTE);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const email = new FormData(form).get('email');

    setStatus('submitting');

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (response.ok && accepted(payload)) {
        form.reset();
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

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate={false}>
      <label className={styles.label} htmlFor="waitlist-email">
        Work email
      </label>
      <input
        className={styles.input}
        id="waitlist-email"
        type="email"
        name="email"
        placeholder="you@company.com"
        autoComplete="email"
        required
        disabled={busy}
      />
      <ButtonSubmit disabled={busy}>{busy ? 'Sending' : 'Request access'}</ButtonSubmit>
      <p
        className={status === 'idle' ? styles.note : `${styles.note} ${styles.noteStrong}`}
        aria-live="polite"
      >
        {note}
      </p>
    </form>
  );
}
