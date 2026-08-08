import { WorkspaceSwitcher } from '../../components/WorkspaceSwitcher.js';
import { getCurrentAccount } from '../../server/current-account.js';
import { projectStore } from '../../server/project-runtime.js';
import { listProjects } from '../../server/projects.js';
import { createProjectAction } from './actions.js';
import { NewProject } from './new-project.js';
import { ProjectList } from './project-list.js';
import styles from './projects.module.css';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ProjectsPageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}

const first = (value: string | readonly string[] | undefined): string | undefined =>
  typeof value === 'string' || value === undefined ? value : value[0];

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const [account, query] = await Promise.all([getCurrentAccount(), searchParams]);
  const projects = await listProjects({ account, includeArchived: true, store: projectStore });
  const notice = first(query.notice);
  const error = first(query.error);

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <p>{account.workspace.displayName}</p>
        <WorkspaceSwitcher current={account.workspace.id} workspaces={account.workspaces} />
        <h1>Projects</h1>
        <p>
          Attach a project with <code>mneia init</code>, or create one here and bind it from the CLI
          afterwards. Repository bindings remain stable.
        </p>
      </header>
      {notice === 'archived' ? (
        <p className={styles.notice} role="status">
          Project archived.
        </p>
      ) : null}
      {error === 'project_not_found' ? (
        <p className={styles.error} role="alert">
          That project is no longer available.
        </p>
      ) : null}
      <ProjectList projects={projects} />
      <NewProject createAction={createProjectAction} error={error} />
    </main>
  );
}
