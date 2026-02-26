import dotenv from 'dotenv';
import { asc } from 'drizzle-orm';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import fastifyView from '@fastify/view';
import ejs from 'ejs';
import path, { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeDb } from './db/index.js';
import { fpUsers } from './db/schema.js';
import { healthRoutes } from './routes/health.js';
import { uiRoutes } from './routes/ui.js';

dotenv.config({ path: resolve(process.cwd(), '../.env') });

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: { id: string; username: string; displayName: string } | null;
    users: Array<{ id: string; username: string; displayName: string }> | null;
  }
  interface FastifyReply {
    renderPage: (view: string, data?: Record<string, unknown>) => Promise<void>;
  }
}

function parseCookies(cookieHeader: string | undefined) {
  if (!cookieHeader) return {} as Record<string, string>;
  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const eqIndex = part.indexOf('=');
        if (eqIndex === -1) return [part, ''];
        const key = part.slice(0, eqIndex);
        const value = decodeURIComponent(part.slice(eqIndex + 1));
        return [key, value];
      })
  );
}

function buildUserCookie(userId: string) {
  return `fp_user=${encodeURIComponent(userId)}; Path=/; HttpOnly; SameSite=Lax`;
}

export async function buildApp() {
  const app = Fastify({ logger: true });
  const { db, pool } = makeDb();

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const viewsRoot = path.join(__dirname, 'views');

  app.decorate('db', db);
  app.decorateRequest('currentUser', null);
  app.decorateRequest('users', null);

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

  app.addHook('preHandler', async (request, reply) => {
    const users = await db
      .select({
        id: fpUsers.id,
        username: fpUsers.username,
        displayName: fpUsers.displayName
      })
      .from(fpUsers)
      .orderBy(asc(fpUsers.username));

    request.users = users;

    if (users.length === 0) {
      request.currentUser = null;
      return;
    }

    const cookies = parseCookies(request.headers.cookie);
    const cookieUserId = cookies.fp_user;
    const cookieUser = cookieUserId ? users.find((item) => item.id === cookieUserId) : undefined;

    if (cookieUser) {
      request.currentUser = cookieUser;
      return;
    }

    const firstUser = users[0];
    request.currentUser = firstUser;
    reply.header('set-cookie', buildUserCookie(firstUser.id));
  });

  app.decorateReply('renderPage', async function renderPage(view: string, data: Record<string, unknown> = {}) {
    const viewData = {
      ...data,
      currentUser: this.request.currentUser,
      users: this.request.users ?? [],
      currentPath: this.request.url
    };
    const content = await ejs.renderFile(path.join(viewsRoot, view), viewData, { async: true });
    const html = await ejs.renderFile(path.join(viewsRoot, 'layout.ejs'), { ...viewData, content }, { async: true });
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
