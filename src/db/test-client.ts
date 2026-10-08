import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { getTestDatabaseUrl } from './test-database-url';

// Integration tests import this client, never the production one in ./index.ts.
export const testPool = new Pool({ connectionString: getTestDatabaseUrl() });
export const testDb = drizzle(testPool, { schema });
