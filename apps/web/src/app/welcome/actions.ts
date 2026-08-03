'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentAccount } from '../../server/current-account.js';
import { onboardingStore } from '../../server/onboarding-runtime.js';
import { OnboardingError, parseOnboardingProfile } from '../../server/store/onboarding-store.js';

const textField = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

export async function saveOnboardingAction(formData: FormData): Promise<void> {
  let destination = '/projects';

  try {
    const account = await getCurrentAccount();
    const profile = parseOnboardingProfile({
      companyName: textField(formData, 'companyName'),
      companySize: textField(formData, 'companySize'),
      teamFunction: textField(formData, 'teamFunction'),
      displayName: textField(formData, 'displayName'),
    });

    await onboardingStore.save({
      workspaceId: account.workspace.id,
      teamId: account.team.id,
      actorId: account.actor.id,
      profile,
    });
  } catch (error) {
    if (error instanceof OnboardingError) {
      destination = `/welcome?error=${error.code}`;
    } else {
      throw error;
    }
  }

  revalidatePath('/welcome');
  revalidatePath('/projects');
  redirect(destination);
}
