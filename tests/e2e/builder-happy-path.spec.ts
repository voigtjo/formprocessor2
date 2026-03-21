import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import ejs from 'ejs';
import { test, expect } from '@playwright/test';
import { uiRoutes } from '../../app/src/routes/ui.js';
import { buildV1ProductionBatchTemplateJson } from '../../app/src/routes/test-template-fixtures.js';
import {
  fpApis,
  fpGroups,
  fpMacros,
  fpTemplateAssignments,
  fpTemplateMacros,
  fpTemplates,
  fpWorkflows
} from '../../app/src/db/schema.js';

const __filename = fileURLToPath(import.meta.url);
const testsDir = path.dirname(path.dirname(__filename));
const repoRoot = path.resolve(testsDir, '..');
const appSrcDir = path.join(repoRoot, 'app', 'src');
const viewsRoot = path.join(appSrcDir, 'views');
const publicRoot = path.join(appSrcDir, 'public');

const alice = { id: '00000000-0000-0000-0000-0000000000a1', username: 'alice', displayName: 'Alice' };
const ops = { id: '00000000-0000-0000-0000-0000000000g1', key: 'ops', name: 'Operations' };

function parseCookies(cookieHeader: string | undefined) {
  if (!cookieHeader) return {} as Record<string, string>;
  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index === -1) return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function asyncRows<T extends Record<string, unknown>>(rows: T[]) {
  const promise = Promise.resolve(rows) as Promise<T[]> & {
    orderBy: () => Promise<T[]>;
    limit: () => Promise<T[]>;
  };
  promise.orderBy = async () => rows;
  promise.limit = async () => rows;
  return promise;
}

function createBuilderHappyPathDb() {
  const workflows = [
    { id: 'wf-evidence', key: 'evidence.group-submit.v1', name: 'Evidence Group Submit', version: 1, state: 'active' },
    { id: 'wf-production', key: 'production.standard.v1', name: 'Production Standard', version: 1, state: 'active' }
  ];
  const apis = [
    { key: 'customers.listValid', name: 'Customers', state: 'active' },
    { key: 'products.listValid', name: 'Products', state: 'active' },
    { key: 'batches.create', name: 'Create Batch', state: 'active' },
    { key: 'customerOrders.create', name: 'Create Customer Order', state: 'active' }
  ];
  const templates: Array<Record<string, any>> = [
    {
      id: '11111111-1111-1111-1111-111111111111',
      key: 'production-batch',
      name: 'Production Batch',
      description: 'Reference template for builder editing',
      state: 'draft',
      version: 1,
      workflowRef: 'production.standard.v1',
      templateJson: buildV1ProductionBatchTemplateJson(),
      publishedAt: null
    }
  ];
  const templateAssignments: Array<{ id: string; templateId: string; groupId: string }> = [];
  const templateMacroLinks: Array<{ templateId: string; macroRef: string; createdAt: Date }> = [];
  let nextTemplateCounter = 1;

  const db = {
    query: {
      fpTemplates: {
        findMany: async () => templates,
        findFirst: async ({ where }: any = {}) => {
          const text = String(where ?? '');
          return templates.find((item) => text.includes(item.id) || text.includes(item.key)) ?? templates[templates.length - 1] ?? null;
        }
      },
      fpTemplateAssignments: {
        findMany: async ({ where }: any = {}) => {
          const text = String(where ?? '');
          const template = templates.find((item) => text.includes(item.id));
          return template ? templateAssignments.filter((item) => item.templateId === template.id) : [];
        }
      },
      fpGroups: {
        findFirst: async () => ops
      }
    },
    select: (_shape?: any) => ({
      from: (table: any) => {
        if (table === fpWorkflows) {
          return {
            where: () => asyncRows(workflows),
            orderBy: async () => workflows,
            limit: async () => workflows
          };
        }
        if (table === fpGroups) {
          return {
            where: () => asyncRows([ops]),
            orderBy: async () => [ops],
            limit: async () => [ops]
          };
        }
        if (table === fpTemplateMacros) {
          return {
            where: ({}) => ({
              orderBy: async () => templateMacroLinks
            }),
            orderBy: async () => templateMacroLinks,
            limit: async () => templateMacroLinks
          };
        }
        if (table === fpMacros) {
          return {
            where: () => asyncRows([]),
            orderBy: async () => [],
            limit: async () => []
          };
        }
        if (table === fpApis) {
          return {
            where: () => asyncRows(apis),
            orderBy: async () => apis,
            limit: async () => apis
          };
        }
        if (table === fpTemplates) {
          return {
            where: () => asyncRows(templates),
            orderBy: async () => templates,
            limit: async () => templates
          };
        }
        return {
          where: () => asyncRows([]),
          orderBy: async () => [],
          limit: async () => []
        };
      }
    }),
    insert: (table: any) => ({
      values: (values: any) => {
        if (table === fpTemplates) {
          const templateId = `00000000-0000-0000-0000-${String(nextTemplateCounter++).padStart(12, '0')}`;
          const row = {
            id: templateId,
            key: values.key,
            name: values.name,
            description: values.description ?? null,
            state: values.state,
            version: values.version ?? 1,
            workflowRef: values.workflowRef ?? null,
            templateJson: values.templateJson,
            publishedAt: values.publishedAt ?? null
          };
          templates.push(row);
          return {
            returning: async () => [{ id: templateId }]
          };
        }
        if (table === fpTemplateAssignments) {
          const rows = Array.isArray(values) ? values : [values];
          rows.forEach((row, index) => {
            templateAssignments.push({
              id: row.id ?? `assign-${templateAssignments.length + index + 1}`,
              templateId: row.templateId,
              groupId: row.groupId
            });
          });
          return {
            onConflictDoNothing: async () => undefined
          };
        }
        if (table === fpTemplateMacros) {
          const rows = Array.isArray(values) ? values : [values];
          rows.forEach((row) => {
            templateMacroLinks.push({
              templateId: row.templateId,
              macroRef: row.macroRef,
              createdAt: new Date()
            });
          });
          return {
            onConflictDoNothing: async () => undefined
          };
        }
        return {
          returning: async () => []
        };
      }
    }),
    update: (table: any) => ({
      set: (values: any) => ({
        where: async ({}) => {
          if (table !== fpTemplates) return;
          const matching = templates.find((item) => item.id === values.id) ?? templates[templates.length - 1];
          if (!matching) return;
          Object.assign(matching, values);
        }
      })
    }),
    delete: (table: any) => ({
      where: async ({}) => {
        if (table === fpTemplateMacros) {
          templateMacroLinks.splice(0, templateMacroLinks.length);
        }
      }
    })
  };

  return { db, templates };
}

async function createAppServer() {
  const app = Fastify({ logger: false });
  const mock = createBuilderHappyPathDb();

  app.decorateRequest('currentUser', null as any);
  app.decorateRequest('users', null as any);

  await app.register(formbody as any);
  await app.register(fastifyStatic as any, {
    root: publicRoot,
    prefix: '/public/'
  });

  app.decorateReply('renderPage', async function renderPage(view: string, data: Record<string, unknown> = {}) {
    const requestAny = this.request as any;
    const viewData = {
      title: String(data.title ?? ''),
      currentPath: this.request.url,
      currentUser: requestAny.currentUser,
      users: requestAny.users ?? [],
      ...data
    };
    const content = await ejs.renderFile(path.join(viewsRoot, view), viewData, { async: true, views: [path.join(viewsRoot, 'templates')] });
    const html = await ejs.renderFile(path.join(viewsRoot, 'layout.ejs'), { ...viewData, content }, { async: true });
    this.type('text/html').send(html);
  });

  app.addHook('preHandler', async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const currentUser = cookies.fp_user ? alice : alice;
    (request as any).users = [alice];
    (request as any).currentUser = currentUser;
    if (!cookies.fp_user) {
      reply.header('set-cookie', `fp_user=${encodeURIComponent(alice.id)}; Path=/; HttpOnly; SameSite=Lax`);
    }
  });

  await app.register(uiRoutes, {
    db: mock.db as any,
    erpBaseUrl: 'http://localhost:3001',
    hasDocumentActorColumns: true,
    hasDocumentTemplateVersion: true,
    hasDocumentMultiAssignments: true,
    hasDocumentAttachments: true,
    hasDocumentAuditTrail: true,
    appBaseUrl: 'http://127.0.0.1:3000'
  });

  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, address, mock };
}

test.describe('template editor canvas builder via real browser', () => {
  let server: Awaited<ReturnType<typeof createAppServer>>;

  test.beforeEach(async () => {
    server = await createAppServer();
  });

  test.afterEach(async () => {
    await server.app.close();
  });

  test('new template page supports builder -> preview -> save -> reopen', async ({ page }) => {
    await page.goto(`${server.address}/templates/new`);

    await expect(page.locator('[data-template-builder]')).toBeVisible();
    await page.locator('[data-builder-select-cell="0.0"]').click();
    await page.locator('[data-builder-bind="formRows.0.cells.0.text"]').fill('Browser Builder Start');

    await page.getByLabel('Name').fill('Browser Builder Template');
    await page.getByLabel('Key').fill('browser-builder-template');

    await page.getByRole('tab', { name: 'Preview' }).click();
    await expect(page.locator('[data-builder-preview]')).toContainText('Browser Builder Start');

    await page.getByRole('button', { name: 'Create Template' }).click();
    await expect(page).toHaveURL(/\/templates\/.+\/edit$/);

    await page.reload();
    await page.getByRole('tab', { name: 'Builder' }).click();
    await page.locator('[data-builder-select-cell="0.0"]').click();
    await expect(page.locator('[data-builder-bind="formRows.0.cells.0.text"]')).toHaveValue('Browser Builder Start');
  });

  test('existing template page supports small canvas edit -> preview -> save -> reload', async ({ page }) => {
    await page.goto(`${server.address}/templates/11111111-1111-1111-1111-111111111111/edit`);

    await page.getByRole('tab', { name: 'Builder' }).click();
    await expect(page.locator('[data-template-builder]')).toBeVisible();
    await page.locator('[data-builder-select-cell="0.0"]').click();
    await page.locator('[data-builder-bind="formRows.0.cells.0.text"]').fill('Production Batch Edited In Browser');

    await page.getByRole('tab', { name: 'Preview' }).click();
    await expect(page.locator('[data-builder-preview]')).toContainText('Production Batch Edited In Browser');

    await page.getByRole('button', { name: 'Save Template' }).click();

    await page.reload();
    await page.getByRole('tab', { name: 'Builder' }).click();
    await page.locator('[data-builder-select-cell="0.0"]').click();
    await expect(page.locator('[data-builder-bind="formRows.0.cells.0.text"]')).toHaveValue('Production Batch Edited In Browser');
  });
});
