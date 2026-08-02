import Link from 'next/link';
import type { ManagedProject } from '../../server/store/project-store.js';
import styles from './projects.module.css';

type ProjectAction = (formData: FormData) => Promise<void>;

export interface ProjectSettingsProps {
  readonly project: ManagedProject;
  readonly renameAction: ProjectAction;
  readonly archiveAction: ProjectAction;
  readonly notice?: string;
  readonly error?: string;
}

const notices: Readonly<Record<string, string>> = {
  renamed: 'Project name updated.',
};

const errors: Readonly<Record<string, string>> = {
  invalid_name: 'Enter a project name between 1 and 128 characters.',
  invalid_confirmation: 'Type the repository binding exactly to archive this project.',
  project_not_found: 'That project is no longer available.',
};

export function ProjectSettings({
  project,
  renameAction,
  archiveAction,
  notice,
  error,
}: ProjectSettingsProps) {
  const noticeMessage = notice === undefined ? undefined : notices[notice];
  const errorMessage = error === undefined ? undefined : errors[error];
  const errorId =
    error === 'invalid_name'
      ? 'display-name-error'
      : error === 'invalid_confirmation'
        ? 'archive-confirmation-error'
        : undefined;

  return (
    <main className={styles.page}>
      <div className={styles.pageHeader}>
        <Link className={styles.backLink} href="/projects">
          Projects
        </Link>
        <h1>{project.displayName}</h1>
        <p>
          Repository binding: <code>{project.slug}</code>
        </p>
      </div>

      {noticeMessage === undefined ? null : (
        <p className={styles.notice} role="status">
          {noticeMessage}
        </p>
      )}
      {errorMessage === undefined ? null : (
        <p className={styles.error} id={errorId} role="alert">
          {errorMessage}
        </p>
      )}

      {project.archivedAt === null ? (
        <div className={styles.settingsGrid}>
          <section className={styles.settingsCard} aria-labelledby="rename-project-title">
            <h2 id="rename-project-title">Project name</h2>
            <p id="project-name-help">
              This changes the browser label. The repository binding stays fixed.
            </p>
            <form action={renameAction} className={styles.form}>
              <input name="projectId" type="hidden" value={project.id} />
              <label htmlFor="displayName">Project name</label>
              <input
                aria-describedby={
                  error === 'invalid_name'
                    ? 'project-name-help display-name-error'
                    : 'project-name-help'
                }
                aria-invalid={error === 'invalid_name'}
                autoComplete="off"
                defaultValue={project.displayName}
                id="displayName"
                maxLength={128}
                name="displayName"
                required
                type="text"
              />
              <button type="submit">Save name</button>
            </form>
          </section>

          <section className={styles.settingsCard} aria-labelledby="archive-project-title">
            <h2 id="archive-project-title">Archive project</h2>
            <p id="archive-project-help">
              Type the repository binding to confirm: <code>{project.slug}</code>
            </p>
            <form action={archiveAction} className={styles.form}>
              <input name="projectId" type="hidden" value={project.id} />
              <label htmlFor="confirmation">Repository binding</label>
              <input
                aria-describedby={
                  error === 'invalid_confirmation'
                    ? 'archive-project-help archive-confirmation-error'
                    : 'archive-project-help'
                }
                aria-invalid={error === 'invalid_confirmation'}
                autoCapitalize="none"
                autoComplete="off"
                id="confirmation"
                name="confirmation"
                required
                spellCheck={false}
                type="text"
              />
              <button type="submit">Archive project</button>
            </form>
          </section>
        </div>
      ) : (
        <section className={styles.settingsCard}>
          <h2>This project is archived.</h2>
          <p>Its repository binding remains reserved and its history remains available.</p>
        </section>
      )}
    </main>
  );
}
