'use server';

import { auth } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { admitSignup } from '../../server/admission.js';
import {
  AccessEmailConfigurationError,
  admissionStore,
  deliverAccessEmail,
  welcomeUrl,
} from '../../server/admission-runtime.js';
import { createInvitation, InvitationError } from '../../server/invitations.js';
import { AdmissionError } from '../../server/store/admission-store.js';
import { currentUserIsSuperAdmin } from '../../server/super-admin.js';

const textField = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

const failure = (code: string): string => `/admin?error=${code}`;

const ADMISSION_FAILURES: Readonly<Record<string, string>> = {
  already_decided: 'already_decided',
  signup_not_found: 'signup_not_found',
  invalid_signup_id: 'signup_not_found',
};

const failureDestination = (error: unknown): string | null => {
  if (error instanceof AccessEmailConfigurationError) return failure('email_not_configured');
  if (error instanceof InvitationError) return failure('invitation_failed');
  if (error instanceof AdmissionError) {
    return failure(ADMISSION_FAILURES[error.code] ?? 'approve_failed');
  }
  return null;
};

export async function approveSignupAction(formData: FormData): Promise<void> {
  if (!(await currentUserIsSuperAdmin())) {
    notFound();
  }

  const { userId } = await auth();
  if (userId === null) {
    notFound();
  }

  let destination: string;

  try {
    const result = await admitSignup({
      signupId: textField(formData, 'signupId'),
      approvedBy: userId,
      store: admissionStore,
      createInvitation,
      deliver: deliverAccessEmail,
      welcomeUrl: welcomeUrl(),
    });

    destination = `/admin?notice=${result.outcome}&email=${encodeURIComponent(result.email)}`;
  } catch (error) {
    const handled = failureDestination(error);
    if (handled === null) throw error;
    destination = handled;
  }

  revalidatePath('/admin');
  redirect(destination);
}
