import dotenv from 'dotenv';
import Fastify from 'fastify';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { healthRoutes } from './routes/health.js';
import { apiRoutes } from './routes/api.js';
import { makeDb } from './db/index.js';

dotenv.config({ path: resolve(process.cwd(), '../.env') });

export async function buildApp() {
  const app = Fastify({ logger: true });
  const { db, pool } = makeDb();

  app.get('/', async () => ({ ok: true, service: 'erp-sim' }));

  app.addHook('onClose', async () => {
    await pool.end();
  });

  await app.register(healthRoutes);
  await app.register(apiRoutes, { db });

  return app;
}

export async function startServer() {
  const app = await buildApp();
  const port = Number(process.env.ERP_SIM_PORT ?? 3001);
  await app.listen({ port, host: '0.0.0.0' });
}

const entryFile = process.argv[1];
if (entryFile && import.meta.url === pathToFileURL(entryFile).href) {
  await startServer();
}
