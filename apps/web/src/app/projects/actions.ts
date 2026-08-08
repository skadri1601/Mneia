'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentAccount } from '../../server/current-account.js';
import { projectStore } from '../../server/project-runtime.js';
import {
  archiveProject,
  createProject,
  ProjectControlError,
  renameProject,
} from '../../server/projects.js';

const textField = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

const projectPath = (projectId: string): string => `/projects/${encodeURIComponent(projectId)}`;

const mutationErrorDestination = (
  error: unknown,
  projectId: string,
  invalidInputCode: string,
  invalidInputError: ProjectControlError['code'],
): string | null => {
  if (!(error instanceof ProjectControlError)) return null;
  if (error.code === invalidInputError) {
    return `${projectPath(projectId)}?error=${invalidInputCode}`;
  }
  if (
    error.code === 'invalid_project_id' ||
    error.code === 'project_not_found' ||
    error.code === 'forbidden'
  ) {
    return '/projects?error=project_not_found';
  }
  return null;
};

export async function createProjectAction(formData: FormData): Promise<void> {
  let destination: string;

  try {
    const account = await getCurrentAccount();
    const project = await createProject({
      account,
      slug: textField(formData, 'slug'),
      displayName: textField(formData, 'displayName'),
      store: projectStore,
    });
    revalidatePath('/projects');
    destination = `${projectPath(project.id)}?notice=created`;
  } catch (error) {
    if (!(error instanceof ProjectControlError)) throw error;
    if (error.code === 'invalid_slug') {
      destination = '/projects?error=invalid_slug';
    } else if (error.code === 'slug_taken') {
      destination = '/projects?error=slug_taken';
    } else if (error.code === 'invalid_display_name') {
      destination = '/projects?error=invalid_name';
    } else {
      throw error;
    }
  }

  redirect(destination);
}

export async function renameProjectAction(formData: FormData): Promise<void> {
  const projectId = textField(formData, 'projectId');
  let destination: string;

  try {
    const account = await getCurrentAccount();
    await renameProject({
      account,
      projectId,
      displayName: textField(formData, 'displayName'),
      store: projectStore,
    });
    revalidatePath('/projects');
    revalidatePath(projectPath(projectId));
    destination = `${projectPath(projectId)}?notice=renamed`;
  } catch (error) {
    const mapped = mutationErrorDestination(
      error,
      projectId,
      'invalid_name',
      'invalid_display_name',
    );
    if (mapped === null) throw error;
    destination = mapped;
  }

  redirect(destination);
}

export async function archiveProjectAction(formData: FormData): Promise<void> {
  const projectId = textField(formData, 'projectId');
  let destination: string;

  try {
    const account = await getCurrentAccount();
    await archiveProject({
      account,
      projectId,
      expectedSlug: textField(formData, 'confirmation'),
      store: projectStore,
    });
    revalidatePath('/projects');
    revalidatePath(projectPath(projectId));
    destination = '/projects?notice=archived';
  } catch (error) {
    const mapped = mutationErrorDestination(
      error,
      projectId,
      'invalid_confirmation',
      'invalid_archive_confirmation',
    );
    if (mapped === null) throw error;
    destination = mapped;
  }

  redirect(destination);
}
