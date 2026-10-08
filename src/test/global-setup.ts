import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { getTestDatabaseUrl } from '../db/test-database-url';
import { truncateAllTables } from './truncate-all-tables';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

// Runs once per `vitest` invocation, before any test file is loaded.
export default async function setup() {
  const pool = new Pool({ connectionString: getTestDatabaseUrl(), max: 1 });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
    // After migrate, not before: on a fresh container the tables do not exist yet.
    // Clears leftovers from a previous run that died before its afterEach ran.
    await db.execute(truncateAllTables);
  } finally {
    await pool.end();
  }
}
