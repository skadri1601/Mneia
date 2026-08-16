'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentAccount } from '../server/current-account.js';
import { writeSelectedWorkspace } from '../server/workspace-selection.js';

export async function enterWorkspaceAction(formData: FormData): Promise<void> {
  const requested = formData.get('workspaceId');
  if (typeof requested === 'string' && requested.length > 0) {
    const account = await getCurrentAccount();
    if (account.workspaces.some((workspace) => workspace.id === requested)) {
      await writeSelectedWorkspace(requested);
      revalidatePath('/', 'layout');
    }
  }

  redirect('/projects');
}

export async function selectWorkspaceAction(formData: FormData): Promise<void> {
  const requested = formData.get('workspaceId');
  if (typeof requested !== 'string' || requested.length === 0) {
    return;
  }

  const account = await getCurrentAccount();
  if (!account.workspaces.some((workspace) => workspace.id === requested)) {
    return;
  }

  await writeSelectedWorkspace(requested);
  revalidatePath('/', 'layout');
}
