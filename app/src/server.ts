import dotenv from 'dotenv';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import fastifyView from '@fastify/view';
import ejs from 'ejs';
import path, { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeDb } from './db/index.js';
import { healthRoutes } from './routes/health.js';
import { uiRoutes } from './routes/ui.js';

dotenv.config({ path: resolve(process.cwd(), '../.env') });

declare module 'fastify' {
  interface FastifyReply {
    renderPage: (view: string, data?: Record<string, unknown>) => Promise<void>;
  }
}

export async function buildApp() {
  const app = Fastify({ logger: true });
  const { db, pool } = makeDb();

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const viewsRoot = path.join(__dirname, 'views');

  app.decorate('db', db);

  app.addHook('onClose', async () => {
    await pool.end();
  });

  await app.register(formbody as any);

  await app.register(fastifyStatic as any, {
    root: path.join(__dirname, 'public'),
    prefix: '/public/'
  });

  await app.register(fastifyView as any, {
    engine: { ejs },
    root: viewsRoot
  });

  app.decorateReply('renderPage', async function renderPage(view: string, data: Record<string, unknown> = {}) {
    const content = await ejs.renderFile(path.join(viewsRoot, view), data, { async: true });
    const html = await ejs.renderFile(path.join(viewsRoot, 'layout.ejs'), { ...data, content }, { async: true });
    this.type('text/html').send(html);
  });

  await app.register(healthRoutes);
  await app.register(uiRoutes, {
    db,
    erpBaseUrl: process.env.ERP_SIM_BASE_URL ?? 'http://localhost:3001'
  });

  return app;
}

export async function startServer() {
  const app = await buildApp();
  const port = Number(process.env.FP_PORT ?? 3000);
  await app.listen({ host: '0.0.0.0', port });
}

const entryFile = process.argv[1];
if (entryFile && import.meta.url === pathToFileURL(entryFile).href) {
  await startServer();
}
