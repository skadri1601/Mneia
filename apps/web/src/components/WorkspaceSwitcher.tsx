import { selectWorkspaceAction } from '../app/workspace-actions.js';
import type { WorkspaceChoice } from '../server/store/account-store.js';
import styles from './WorkspaceSwitcher.module.css';

export interface WorkspaceSwitcherProps {
  readonly current: string;
  readonly workspaces: readonly WorkspaceChoice[];
}

export function WorkspaceSwitcher({ current, workspaces }: WorkspaceSwitcherProps) {
  if (workspaces.length < 2) {
    return null;
  }

  return (
    <form action={selectWorkspaceAction} className={styles.form}>
      <label className={styles.label} htmlFor="workspaceId">
        Workspace
      </label>
      <select className={styles.select} defaultValue={current} id="workspaceId" name="workspaceId">
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.displayName}
          </option>
        ))}
      </select>
      <button className={styles.submit} type="submit">
        Switch
      </button>
    </form>
  );
}
