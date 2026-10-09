import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

// Common shape of the Neon (production) and node-postgres (tests) Drizzle clients,
// and of the transactions opened from either, so business logic can take the
// executor as a parameter.
export type DbExecutor = PgDatabase<PgQueryResultHKT, typeof schema>;
