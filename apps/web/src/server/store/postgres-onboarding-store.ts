import 'server-only';

import {
  assertConnectionEnforcesRls,
  type PostgresConnectionSource,
  type PostgresSession,
  WORKSPACE_SETTING,
} from '@mneia/core';
import {
  OnboardingError,
  type OnboardingStore,
  type SaveOnboardingInput,
} from './onboarding-store.js';

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);

export class PostgresOnboardingStore implements OnboardingStore {
  constructor(private readonly source: PostgresConnectionSource) {}

  async save({ workspaceId, teamId, actorId, profile }: SaveOnboardingInput): Promise<void> {
    await this.inTransaction(workspaceId, async (session) => {
      await session.execute(
        'UPDATE workspace SET display_name = $2, company_size = $3 WHERE id = $1',
        [workspaceId, profile.companyName, profile.companySize],
      );
      await session.execute(
        'UPDATE team SET function = $3::team_function WHERE workspace_id = $1 AND id = $2',
        [workspaceId, teamId, profile.teamFunction],
      );
      await session.execute(
        'UPDATE actor SET display_name = $3 WHERE workspace_id = $1 AND id = $2',
        [workspaceId, actorId, profile.displayName],
      );
    });
  }

  private async inTransaction(
    workspaceId: string,
    operation: (session: PostgresSession) => Promise<void>,
  ): Promise<void> {
    const session = await this.source.acquire();
    let transactionStarted = false;
    let discardSession = false;
    let completed = false;
    let failure: unknown;

    try {
      await assertConnectionEnforcesRls(session);
      await session.execute('BEGIN');
      transactionStarted = true;
      await session.execute('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await session.execute('SELECT set_config($1, $2, true)', [WORKSPACE_SETTING, workspaceId]);
      await operation(session);
      await session.execute('COMMIT');
      transactionStarted = false;
      completed = true;
    } catch (error) {
      failure = error;
      if (transactionStarted) {
        try {
          await session.execute('ROLLBACK');
        } catch (rollbackError) {
          discardSession = true;
          failure = new OnboardingError(
            'rollback_failed',
            `Onboarding failed with "${describeCause(error)}" and rollback failed too`,
            { cause: new AggregateError([error, rollbackError]) },
          );
        }
      }
    }

    try {
      if (discardSession) await session.discard();
      else await session.release();
    } catch (cleanupError) {
      throw new OnboardingError(
        'session_cleanup_failed',
        `Could not ${discardSession ? 'discard' : 'release'} the Postgres onboarding session`,
        { cause: new AggregateError(completed ? [cleanupError] : [failure, cleanupError]) },
      );
    }

    if (!completed) throw failure;
  }
}
