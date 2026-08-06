import type { Actor, ScopedStore, Uuid } from '@mneia/core';
import { assembleSlice, resolveProject } from '@mneia/core';
import { CliError } from '../command.js';
import type { LocalBinding } from '../local-store.js';
import { loadLocalBinding, requireLocalBinding, withLocalStore } from '../local-store.js';
import type { BriefApi, BriefRequest, ProjectConfig } from './brief.js';
import type { LogApi, LogPage, LogRequest } from './log.js';
import type { StatusApi, StatusReport, StatusRequest } from './status.js';

const STATUS_ITEM_LIMIT = 500;

async function bindingFor(command: string): Promise<LocalBinding> {
  return requireLocalBinding(await loadLocalBinding(), command);
}

function projectSelectorFor(config: ProjectConfig, binding: LocalBinding): string {
  return config.project.length > 0
    ? config.project
    : (binding.projectSlug ?? binding.projectId ?? '');
}

async function requireProject(store: ScopedStore, selector: string, command: string) {
  if (selector.length === 0) {
    throw new CliError(
      'not_configured',
      `mneia ${command} has no project to read: neither the project config nor the local binding names one`,
      'run pnpm bootstrap:local --apply, or add a project to .mneia/config.json',
    );
  }
  const project = await resolveProject(store, selector);
  if (project === null) {
    throw new CliError(
      'not_configured',
      `mneia ${command} found no project matching "${selector}" in this workspace`,
      'check the slug with mneia status, or create the project first',
    );
  }
  return project;
}

async function actorsFor(store: ScopedStore, ids: readonly Uuid[]): Promise<readonly Actor[]> {
  const unique = [...new Set(ids)];
  const resolved = await Promise.all(unique.map((id) => store.getActor(id)));
  return resolved.filter((actor): actor is Actor => actor !== null);
}

export const localBriefApi: BriefApi = {
  async rehydrate(request: BriefRequest) {
    const binding = await bindingFor('brief');
    return withLocalStore(binding, async (store) => {
      const project = await requireProject(
        store,
        projectSelectorFor(request.config, binding),
        'brief',
      );
      const { slice } = await assembleSlice({
        store,
        project,
        task: request.task,
        tokenBudget: request.tokenBudget,
        now: new Date(),
      });
      return slice;
    });
  },
};

export const localLogApi: LogApi = {
  async log(request: LogRequest): Promise<LogPage> {
    const binding = await bindingFor('log');
    return withLocalStore(binding, async (store) => {
      const project = await requireProject(
        store,
        projectSelectorFor(request.config, binding),
        'log',
      );
      const all = await store.listContextItems({
        projectId: project.id,
        kinds: ['decision'],
        limit: request.limit,
      });
      const since = request.since;
      const items =
        since === null ? all : all.filter((item) => item.assertedAt.getTime() >= since.getTime());

      return {
        projectId: project.id,
        items,
        actors: await actorsFor(
          store,
          items.map((item) => item.assertedBy),
        ),
      };
    });
  },
};

export const localStatusApi: StatusApi = {
  async status(request: StatusRequest): Promise<StatusReport> {
    const binding = await bindingFor('status');
    return withLocalStore(binding, async (store) => {
      const project = await requireProject(
        store,
        projectSelectorFor(request.config, binding),
        'status',
      );
      return {
        projectId: project.id,
        items: await store.listContextItems({
          projectId: project.id,
          limit: STATUS_ITEM_LIMIT,
        }),
      };
    });
  },
};
