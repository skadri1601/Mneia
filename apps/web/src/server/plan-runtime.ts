import 'server-only';

import { database } from './database.js';
import { type PlanStore, PostgresPlanStore } from './store/postgres-plan-store.js';

let store: PlanStore | undefined;

export const plans = (): PlanStore => {
  store ??= new PostgresPlanStore(database);
  return store;
};
