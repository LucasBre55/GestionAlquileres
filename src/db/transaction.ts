import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';
import type { DbExecutor } from './executor';

// Pool and WebSocket connections cannot outlive a single serverless invocation,
// so a Pool is opened per call and always closed. Node 22+ provides the global
// WebSocket the driver needs; no `ws` constructor is configured.
export async function withTransaction<T>(
  fn: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const db = drizzle(pool, { schema });
    return await db.transaction((tx) => fn(tx));
  } finally {
    await pool.end();
  }
}
