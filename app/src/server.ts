import 'dotenv/config';
import Fastify from 'fastify';
import formbody from 'fastify-formbody';
import FastifyStatic from 'fastify-static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';
import { makeDb } from './db/client.js';
import { healthRoutes } from './routes/health.js';
import { uiRoutes } from './routes/ui.js';

const port = Number(process.env.FP_PORT ?? 4000);
const databaseUrl = process.env.FP_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('Missing FP_DATABASE_URL');
}

const app = Fastify({ logger: true });

const { db, pool } = makeDb(databaseUrl);
app.decorate('db', db);
app.addHook('onClose', async () => {
  await pool.end();
});

await app.register(formbody);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Static (optional)
await app.register(FastifyStatic as any, {
  root: path.join(__dirname, 'public'),
  prefix: '/public/'
});

// Views
app.decorate('view', (template: string, data: any) => ejs.renderFile(path.join(__dirname, 'views', template), data));
app.addHook('onRequest', async (_req, reply) => {
  // attach reply.view
  (reply as any).view = async (tpl: string, data: any) => {
    const html = await ejs.renderFile(path.join(__dirname, 'views', tpl), data, { async: true });
    reply.type('text/html').send(html);
  };
});

await app.register(healthRoutes);
await app.register(uiRoutes);

await app.listen({ port, host: '0.0.0.0' });
