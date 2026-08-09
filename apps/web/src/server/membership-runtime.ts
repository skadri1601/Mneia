import 'server-only';

import { database } from './database.js';
import {
  type MembershipStore,
  PostgresMembershipStore,
} from './store/postgres-membership-store.js';

let store: MembershipStore | undefined;

export const memberships = (): MembershipStore => {
  store ??= new PostgresMembershipStore(database);
  return store;
};
