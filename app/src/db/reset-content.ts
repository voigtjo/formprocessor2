import dotenv from 'dotenv';
import { sql } from 'drizzle-orm';
import { resolve } from 'node:path';
import { makeDb } from './index.js';

dotenv.config({ path: resolve(process.cwd(), '../.env') });

const TARGET_TABLES = [
  'fp_document_approvals',
  'fp_document_editors',
  'fp_document_submissions',
  'fp_documents',
  'fp_template_assignments',
  'fp_group_members',
  'fp_template_macros',
  'fp_templates',
  'fp_workflows',
  'fp_apis',
  'fp_macros',
  'fp_groups',
  'fp_users'
] as const;

async function run() {
  const { db, pool } = makeDb();
  try {
    const targetTableSql = sql.join(TARGET_TABLES.map((tableName) => sql`${tableName}`), sql`, `);
    const existingRows = await db.execute(sql<{ table_name: string }>`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
        and table_name in (${targetTableSql})
      order by table_name
    `);

    const foundTables = existingRows.rows.map((row) => row.table_name);
    const foundSet = new Set(foundTables);
    const missingTables = TARGET_TABLES.filter((tableName) => !foundSet.has(tableName));
    const truncateTables = TARGET_TABLES.filter((tableName) => foundSet.has(tableName));

    console.log(`Reset target tables: ${TARGET_TABLES.join(', ')}`);
    console.log(`Found tables: ${foundTables.length > 0 ? foundTables.join(', ') : 'none'}`);
    console.log(`Missing tables (skipped): ${missingTables.length > 0 ? missingTables.join(', ') : 'none'}`);

    if (truncateTables.length === 0) {
      console.log('No matching tables exist yet. Nothing to reset.');
      return;
    }

    const truncateSql = `TRUNCATE TABLE ${truncateTables.map((tableName) => `"${tableName}"`).join(', ')} RESTART IDENTITY CASCADE`;
    await db.execute(sql.raw(truncateSql));
    console.log(`Truncated tables: ${truncateTables.join(', ')}`);
    console.log('DB content reset complete (schema kept).');
  } finally {
    await pool.end();
  }
}

await run();
