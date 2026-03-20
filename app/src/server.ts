import dotenv from 'dotenv';
import { asc } from 'drizzle-orm';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import fastifyView from '@fastify/view';
import ejs from 'ejs';
import path, { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLocalAttachmentStorage } from './core/attachments.js';
import { normalizeAppBaseUrl } from './core/app-links.js';
import { createNoopAuditGateway } from './core/audit.js';
import { createLocalOutboxNotificationGateway } from './core/notifications.js';
import {
  buildCoreRequestContext,
  buildCurrentUserContext,
  buildDefaultTenantContext,
  type CoreRequestContext,
  type CurrentUserContext,
  type TenantContext
} from './core/request-context.js';
import { makeDb } from './db/index.js';
import { fpUsers } from './db/schema.js';
import { healthRoutes } from './routes/health.js';
import { uiRoutes } from './routes/ui.js';

dotenv.config({ path: resolve(process.cwd(), '../.env') });

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: { id: string; username: string; displayName: string } | null;
    users: Array<{ id: string; username: string; displayName: string }> | null;
    tenantContext: TenantContext;
    currentUserContext: CurrentUserContext;
    requestContext: CoreRequestContext;
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

function requestWantsHtml(acceptHeader: string | undefined) {
  if (!acceptHeader) return false;
  return acceptHeader.includes('text/html');
}

function isApiRequest(url: string) {
  return url.startsWith('/api/');
}

export function normalizeUiErrorMessage(params: { url: string; message: string; statusCode: number }) {
  const message = String(params.message ?? '').trim() || 'Unexpected error';
  if (
    message === 'Request body is too large' ||
    message.includes('body is too large') ||
    message.includes('FST_ERR_CTP_BODY_TOO_LARGE')
  ) {
    if (params.url.includes('/attachments')) {
      return 'Attachment upload is too large. V1 limit is 10 MB per file.';
    }
    return 'Request body is too large.';
  }
  return message;
}

async function renderErrorDocument(params: {
  viewsRoot: string;
  statusCode: number;
  title: string;
  message: string;
  backHref: string;
  currentUser: { id: string; username: string; displayName: string } | null;
  users: Array<{ id: string; username: string; displayName: string }>;
  currentPath: string;
}) {
  const viewData = {
    title: params.title,
    statusCode: params.statusCode,
    message: params.message,
    backHref: params.backHref,
    currentUser: params.currentUser,
    users: params.users,
    currentPath: params.currentPath
  };
  const content = await ejs.renderFile(path.join(params.viewsRoot, 'error.ejs'), viewData, { async: true });
  return ejs.renderFile(path.join(params.viewsRoot, 'layout.ejs'), { ...viewData, content }, { async: true });
}

async function checkDocumentColumns(pool: { query: (sqlText: string, params?: unknown[]) => Promise<any> }) {
  const tableCheck = await pool.query(`select to_regclass('public.fp_documents') as rel`);
  const rel = tableCheck.rows?.[0]?.rel;
  if (!rel) {
    return {
      hasActorColumns: false,
      hasTemplateVersion: false,
      hasMultiAssignments: false,
      hasAttachments: false,
      hasAuditTrail: false
    };
  }

  const columnCheck = await pool.query(
    `
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'fp_documents'
        and column_name in ('editor_user_id', 'approver_user_id', 'template_version')
    `
  );
  const names = new Set((columnCheck.rows ?? []).map((row: { column_name?: string }) => row.column_name));
  const multiTables = await pool.query(
    `
      select to_regclass('public.fp_document_editors') as editors_rel,
             to_regclass('public.fp_document_approvals') as approvals_rel,
             to_regclass('public.fp_document_submissions') as submissions_rel,
             to_regclass('public.fp_document_attachments') as attachments_rel,
             to_regclass('public.fp_document_audit_events') as audit_rel
    `
  );
  return {
    hasActorColumns: names.has('editor_user_id') && names.has('approver_user_id'),
    hasTemplateVersion: names.has('template_version'),
    hasMultiAssignments:
      !!multiTables.rows?.[0]?.editors_rel &&
      !!multiTables.rows?.[0]?.approvals_rel &&
      !!multiTables.rows?.[0]?.submissions_rel,
    hasAttachments: !!multiTables.rows?.[0]?.attachments_rel,
    hasAuditTrail: !!multiTables.rows?.[0]?.audit_rel
  };
}

export async function buildApp() {
  const app = Fastify({ logger: true });
  const { db, pool } = makeDb();
  let hasDocumentActorColumns = false;
  let hasDocumentTemplateVersion = false;
  let hasDocumentMultiAssignments = false;
  let hasDocumentAttachments = false;
  let hasDocumentAuditTrail = false;
  try {
    const checked = await checkDocumentColumns(pool);
    hasDocumentActorColumns = checked.hasActorColumns;
    hasDocumentTemplateVersion = checked.hasTemplateVersion;
    hasDocumentMultiAssignments = checked.hasMultiAssignments;
    hasDocumentAttachments = checked.hasAttachments;
    hasDocumentAuditTrail = checked.hasAuditTrail;
  } catch {
    hasDocumentActorColumns = false;
    hasDocumentTemplateVersion = false;
    hasDocumentMultiAssignments = false;
    hasDocumentAttachments = false;
    hasDocumentAuditTrail = false;
  }
  if (!hasDocumentActorColumns) {
    app.log.warn('DB missing editor_user_id/approver_user_id. Run: cd app && npm run db:push');
  }
  if (!hasDocumentTemplateVersion) {
    app.log.warn('DB missing template_version. Run: cd app && npm run db:push');
  }
  if (!hasDocumentMultiAssignments) {
    app.log.warn('DB missing fp_document_editors/fp_document_approvals/fp_document_submissions. Run: cd app && npm run db:push');
  }
  if (!hasDocumentAttachments) {
    app.log.warn('DB missing fp_document_attachments. Run: cd app && npm run db:push');
  }
  if (!hasDocumentAuditTrail) {
    app.log.warn('DB missing fp_document_audit_events. Run: cd app && npm run db:push');
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const viewsRoot = path.join(__dirname, 'views');

  app.decorate('db', db);
  app.decorateRequest('currentUser', null);
  app.decorateRequest('users', null);
  app.decorateRequest('tenantContext', null);
  app.decorateRequest('currentUserContext', null);
  app.decorateRequest('requestContext', null);

  const attachmentStorage = createLocalAttachmentStorage({
    rootDir: path.join(process.cwd(), 'var', 'attachments')
  });
  const auditGateway = createNoopAuditGateway();
  const appBaseUrl = normalizeAppBaseUrl(process.env.APP_BASE_URL ?? 'http://localhost:3000');
  const notificationGateway = createLocalOutboxNotificationGateway({
    rootDir: path.join(process.cwd(), 'var', 'notifications'),
    logger: app.log
  });

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
    request.tenantContext = buildDefaultTenantContext();

    if (users.length === 0) {
      request.currentUser = null;
      request.currentUserContext = buildCurrentUserContext(null);
      request.requestContext = buildCoreRequestContext({ user: null });
      return;
    }

    const cookies = parseCookies(request.headers.cookie);
    const cookieUserId = cookies.fp_user;
    const cookieUser = cookieUserId ? users.find((item) => item.id === cookieUserId) : undefined;

    if (cookieUser) {
      request.currentUser = cookieUser;
      request.currentUserContext = buildCurrentUserContext(cookieUser);
      request.requestContext = buildCoreRequestContext({ user: cookieUser });
      return;
    }

    const firstUser = users[0];
    request.currentUser = firstUser;
    request.currentUserContext = buildCurrentUserContext(firstUser);
    request.requestContext = buildCoreRequestContext({ user: firstUser });
    reply.header('set-cookie', buildUserCookie(firstUser.id));
  });

  app.decorateReply('renderPage', async function renderPage(view: string, data: Record<string, unknown> = {}) {
    const viewData = {
      ...data,
      currentUser: this.request.currentUser,
      currentUserContext: this.request.currentUserContext,
      tenantContext: this.request.tenantContext,
      users: this.request.users ?? [],
      currentPath: this.request.url,
      attachmentStorageProvider: attachmentStorage.provider,
      notificationProvider: notificationGateway.provider
    };
    const content = await ejs.renderFile(path.join(viewsRoot, view), viewData, { async: true });
    const html = await ejs.renderFile(path.join(viewsRoot, 'layout.ejs'), { ...viewData, content }, { async: true });
    this.type('text/html').send(html);
  });

  app.setErrorHandler(async (error, request, reply) => {
    const statusCode = (error as any)?.statusCode && Number((error as any).statusCode) >= 400 ? Number((error as any).statusCode) : 500;
    const message = normalizeUiErrorMessage({
      url: request.url,
      message: error instanceof Error ? error.message : 'Unexpected error',
      statusCode
    });
    if (!isApiRequest(request.url) && requestWantsHtml(request.headers.accept)) {
      const title =
        statusCode === 403 ? 'Forbidden' : statusCode === 404 ? 'Not Found' : statusCode === 400 ? 'Bad Request' : 'Error';
      const backHref = request.headers.referer || '/templates';
      const html = await renderErrorDocument({
        viewsRoot,
        statusCode,
        title,
        message,
        backHref,
        currentUser: request.currentUser,
        users: request.users ?? [],
        currentPath: request.url
      });
      reply.code(statusCode).type('text/html').send(html);
      return;
    }

    reply.code(statusCode).send({ message });
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (reply.statusCode < 400) return payload;
    if (isApiRequest(request.url)) return payload;
    if (!requestWantsHtml(request.headers.accept)) return payload;
    const contentType = String(reply.getHeader('content-type') ?? '');
    if (!contentType.includes('application/json')) return payload;

    const textPayload = typeof payload === 'string' ? payload : Buffer.isBuffer(payload) ? payload.toString('utf8') : '';
    if (!textPayload) return payload;

    let parsed: any;
    try {
      parsed = JSON.parse(textPayload);
    } catch {
      return payload;
    }
    const message = typeof parsed?.message === 'string' ? parsed.message : '';
    if (!message) return payload;

    const title =
      reply.statusCode === 403
        ? 'Forbidden'
        : reply.statusCode === 404
          ? 'Not Found'
          : reply.statusCode === 400
            ? 'Bad Request'
            : 'Error';
    const html = await renderErrorDocument({
      viewsRoot,
      statusCode: reply.statusCode,
      title,
      message,
      backHref: request.headers.referer || '/templates',
      currentUser: request.currentUser,
      users: request.users ?? [],
      currentPath: request.url
    });
    reply.type('text/html');
    return html;
  });

  await app.register(healthRoutes);
  await app.register(uiRoutes, {
    db,
    erpBaseUrl: process.env.ERP_SIM_BASE_URL ?? 'http://localhost:3001',
    hasDocumentActorColumns,
    hasDocumentTemplateVersion,
    hasDocumentMultiAssignments,
    hasDocumentAttachments,
    hasDocumentAuditTrail,
    appBaseUrl,
    attachmentStorage,
    auditGateway,
    notificationGateway
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
