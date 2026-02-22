import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type FpDb = NodePgDatabase<typeof schema>;

export function makeDb() {
  const databaseUrl = process.env.FP_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Missing FP_DATABASE_URL');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
