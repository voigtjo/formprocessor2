import type { Config } from 'drizzle-kit';
import dotenv from 'dotenv';
import { resolve } from 'node:path';

dotenv.config({ path: resolve(process.cwd(), '../.env') });

const url = process.env.FP_DATABASE_URL ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error('Missing database URL. Set FP_DATABASE_URL in the repository root .env file.');
}

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url
  }
} satisfies Config;
