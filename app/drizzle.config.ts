import 'dotenv/config';
import type { Config } from 'drizzle-kit';
const url = process.env.FP_DATABASE_URL;

if (!url) {
  throw new Error(
    'Missing FP_DATABASE_URL. Set it in the root .env or pass inline, e.g. FP_DATABASE_URL=postgres://... npm run db:push'
  );
}

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url
  }
} satisfies Config;
