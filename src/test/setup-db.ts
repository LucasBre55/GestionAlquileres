import { afterAll, afterEach } from 'vitest';
import { testDb, testPool } from '../db/test-client';
import { truncateAllTables } from './truncate-all-tables';

afterEach(async () => {
  await testDb.execute(truncateAllTables);
});

afterAll(async () => {
  await testPool.end();
});
