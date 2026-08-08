import styles from './projects.module.css';

type ProjectAction = (formData: FormData) => Promise<void>;

export interface NewProjectProps {
  readonly createAction: ProjectAction;
  readonly error?: string | undefined;
}

const errors: Readonly<Record<string, string>> = {
  invalid_slug:
    'A repository binding is lower-case letters, digits, and single hyphens — for example mneia-web.',
  slug_taken: 'A project with that repository binding already exists in this workspace.',
  invalid_name: 'Enter a project name between 1 and 128 characters.',
};

export function NewProject({ createAction, error }: NewProjectProps) {
  const errorMessage = error === undefined ? undefined : errors[error];

  return (
    <section className={styles.settingsCard} aria-labelledby="new-project-title">
      <h2 id="new-project-title">New project</h2>
      <p id="new-project-help">
        The repository binding is what <code>mneia init</code> matches on, so it should be the
        repository directory name. Running <code>mneia init</code> there attaches to this project
        rather than creating a second one.
      </p>
      {errorMessage === undefined ? null : (
        <p className={styles.error} id="new-project-error" role="alert">
          {errorMessage}
        </p>
      )}
      <form action={createAction} className={styles.form}>
        <label htmlFor="new-project-name">Project name</label>
        <input
          aria-describedby={error === 'invalid_name' ? 'new-project-error' : undefined}
          aria-invalid={error === 'invalid_name'}
          autoComplete="off"
          id="new-project-name"
          maxLength={128}
          name="displayName"
          required
          type="text"
        />
        <label htmlFor="new-project-slug">Repository binding</label>
        <input
          aria-describedby={
            error === 'invalid_slug' || error === 'slug_taken'
              ? 'new-project-help new-project-error'
              : 'new-project-help'
          }
          aria-invalid={error === 'invalid_slug' || error === 'slug_taken'}
          autoComplete="off"
          id="new-project-slug"
          maxLength={100}
          name="slug"
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          required
          type="text"
        />
        <button type="submit">Create project</button>
      </form>
    </section>
  );
}
