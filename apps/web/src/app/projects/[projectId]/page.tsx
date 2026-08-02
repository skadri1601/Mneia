import { notFound } from 'next/navigation';
import { getCurrentAccount } from '../../../server/current-account.js';
import { projectStore } from '../../../server/project-runtime.js';
import { getProject, ProjectControlError } from '../../../server/projects.js';
import { archiveProjectAction, renameProjectAction } from '../actions.js';
import { ProjectSettings } from '../project-settings.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ProjectPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}

const first = (value: string | readonly string[] | undefined): string | undefined =>
  typeof value === 'string' || value === undefined ? value : value[0];

export default async function ProjectPage({ params, searchParams }: ProjectPageProps) {
  const [{ projectId }, query, account] = await Promise.all([
    params,
    searchParams,
    getCurrentAccount(),
  ]);

  const notice = first(query.notice);
  const error = first(query.error);

  try {
    const project = await getProject({ account, projectId, store: projectStore });
    return (
      <ProjectSettings
        archiveAction={archiveProjectAction}
        project={project}
        renameAction={renameProjectAction}
        {...(error === undefined ? {} : { error })}
        {...(notice === undefined ? {} : { notice })}
      />
    );
  } catch (error) {
    if (
      error instanceof ProjectControlError &&
      (error.code === 'invalid_project_id' ||
        error.code === 'project_not_found' ||
        error.code === 'forbidden')
    ) {
      return notFound();
    }
    throw error;
  }
}
