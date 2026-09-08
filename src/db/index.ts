import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile?.();
  } catch {
    // Continúa si no existe .env en el entorno local o ya está provisto por el sistema
  }
}

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });