import 'server-only';

import { database } from './database.js';
import {
  type MembershipStore,
  PostgresMembershipStore,
  type SeatPositionStore,
} from './store/postgres-membership-store.js';

let store: PostgresMembershipStore | undefined;

const membershipStore = (): PostgresMembershipStore => {
  store ??= new PostgresMembershipStore(database);
  return store;
};

export const memberships = (): MembershipStore => membershipStore();

/**
 * The same instance seen through the seat port.
 *
 * One connection source and one lazily constructed store, two interfaces, so a caller that
 * only needs `defaultTeamRole` is not handed the seat and audit writes.
 */
export const seats = (): SeatPositionStore => membershipStore();
