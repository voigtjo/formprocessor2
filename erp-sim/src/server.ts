import 'dotenv/config';
import Fastify from 'fastify';
import { healthRoutes } from './routes/health.js';
import { apiRoutes } from './routes/api.js';
import { makeDb } from './db/client.js';

const port = Number(process.env.ERP_PORT ?? 4001);
const databaseUrl = process.env.ERP_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('Missing ERP_DATABASE_URL');
}

const app = Fastify({ logger: true });

// db (not yet used in scaffold routes)
const { db, pool } = makeDb(databaseUrl);
app.decorate('db', db);

app.addHook('onClose', async () => {
  await pool.end();
});

await app.register(healthRoutes);
await app.register(apiRoutes);

await app.listen({ port, host: '0.0.0.0' });
