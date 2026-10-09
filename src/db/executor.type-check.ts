import type { db } from './index';
import type { testDb } from './test-client';
import type { DbExecutor } from './executor';

// Compile-time only: tsc fails if either client stops being assignable to DbExecutor.
declare const neonHttpDb: typeof db;
declare const nodePgDb: typeof testDb;

export const neonHttpIsExecutor: DbExecutor = neonHttpDb;
export const nodePgIsExecutor: DbExecutor = nodePgDb;
