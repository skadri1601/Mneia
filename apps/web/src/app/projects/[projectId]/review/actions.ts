'use server';

import type { ContextItemReview } from '@mneia/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentAccount } from '../../../../server/current-account.js';
import { submitReview } from '../../../../server/review-runtime.js';
import { readReviews } from './parse.js';

const textField = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

const reviewPath = (projectId: string): string =>
  `/projects/${encodeURIComponent(projectId)}/review`;

export async function reviewPendingAction(formData: FormData): Promise<void> {
  const projectId = textField(formData, 'projectId');
  const reviews = readReviews(formData);

  if (reviews.length === 0) {
    redirect(`${reviewPath(projectId)}?error=nothing_decided`);
  }

  const account = await getCurrentAccount();

  try {
    await submitReview(
      { workspaceId: account.workspace.id, actorId: account.actor.id },
      { projectId, reviews },
    );
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : 'failed';
    redirect(`${reviewPath(projectId)}?error=${encodeURIComponent(code)}`);
  }

  revalidatePath(reviewPath(projectId));
  redirect(`${reviewPath(projectId)}?notice=reviewed&count=${reviews.length}`);
}
