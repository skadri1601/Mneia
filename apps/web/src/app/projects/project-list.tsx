import Link from 'next/link';
import type { ManagedProject } from '../../server/store/project-store.js';
import styles from './projects.module.css';

export interface ProjectListProps {
  readonly projects: readonly ManagedProject[];
}

const ProjectRow = ({ project }: Readonly<{ project: ManagedProject }>) => (
  <li className={styles.projectCard}>
    <div className={styles.projectCardHeader}>
      <Link className={styles.projectLink} href={`/projects/${project.id}`}>
        {project.displayName}
      </Link>
      {project.archivedAt === null ? null : <span className={styles.status}>Archived project</span>}
    </div>
    <dl className={styles.projectMeta}>
      <div>
        <dt>Repository binding</dt>
        <dd>
          <code>{project.slug}</code>
        </dd>
      </div>
      {project.repoUrl === null ? null : (
        <div>
          <dt>Repository</dt>
          <dd>{project.repoUrl}</dd>
        </div>
      )}
    </dl>
  </li>
);

export function ProjectList({ projects }: ProjectListProps) {
  const active = projects.filter((project) => project.archivedAt === null);
  const archived = projects.filter((project) => project.archivedAt !== null);

  return (
    <div className={styles.projectGroups}>
      {active.length === 0 ? (
        <section className={styles.emptyState} aria-labelledby="empty-projects-title">
          <h2 id="empty-projects-title">No projects attached yet</h2>
          <p>
            Run <code>mneia init</code> in a repository to attach your first project, or create one
            below.
          </p>
        </section>
      ) : (
        <ul className={styles.projectList} aria-label="Active projects">
          {active.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </ul>
      )}

      {archived.length === 0 ? null : (
        <details className={styles.archivedProjects}>
          <summary>Archived ({archived.length})</summary>
          <ul className={styles.projectList} aria-label="Archived projects">
            {archived.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
