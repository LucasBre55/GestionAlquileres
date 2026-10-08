import { getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema';

// Derived from the schema so a new table is reset without touching this file.
const tableList = Object.values(schema)
  .flatMap((value) => (is(value, PgTable) ? [`"${getTableName(value)}"`] : []))
  .join(', ');

// One statement for all tables: no FK ordering issues, serial ids restart at 1.
export const truncateAllTables = sql.raw(
  `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`,
);
