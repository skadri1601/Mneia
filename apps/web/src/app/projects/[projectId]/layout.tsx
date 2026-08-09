import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ProjectWorkspace } from '../../../components/project-workspace/ProjectWorkspace.js';
import { getCurrentAccount } from '../../../server/current-account.js';
import { projectStore } from '../../../server/project-runtime.js';
import { getProject, ProjectControlError } from '../../../server/projects.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ProjectLayoutProps {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly projectId: string }>;
}

export default async function ProjectLayout({ children, params }: ProjectLayoutProps) {
  const [{ projectId }, account] = await Promise.all([params, getCurrentAccount()]);

  try {
    const project = await getProject({ account, projectId, store: projectStore });
    return (
      <ProjectWorkspace
        project={{ id: project.id, displayName: project.displayName, slug: project.slug }}
      >
        {children}
      </ProjectWorkspace>
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
