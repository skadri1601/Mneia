import 'server-only';

import { database } from './database.js';
import { PostgresOnboardingStore } from './store/postgres-onboarding-store.js';

export const onboardingStore = new PostgresOnboardingStore(database);
