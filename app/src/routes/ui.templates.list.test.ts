import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { fpTemplateAssignments, fpTemplateMacros, fpTemplates } from '../db/schema.js';
import { uiRoutes } from './ui.js';

type TemplateRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  state: 'draft' | 'published' | 'archived';
  version: number;
  templateJson: Record<string, unknown>;
  publishedAt: Date | null;
  createdAt: Date;
};

function createMockDb(rows: TemplateRow[]) {
  let selectedTemplateId = '';
  let selectedKey = '';
  return {
    query: {
      fpTemplates: {
        findFirst: async () => {
          const id = selectedTemplateId;
          const found = rows.find((item) => item.id === id) ?? null;
          selectedKey = found?.key ?? '';
          return found;
        }
      }
    },
    select: () => ({
      from: (table: unknown) => {
        if (table === fpTemplates) {
          return {
            where: () => ({
              orderBy: async () =>
                rows
                  .filter((item) => (selectedKey ? item.key === selectedKey : true))
                  .sort((a, b) => b.version - a.version)
            })
          };
        }
        if (table === fpTemplateAssignments) {
          return {
            innerJoin: () => ({
              where: () => ({
                orderBy: async () => []
              })
            })
          };
        }
        if (table === fpTemplateMacros) {
          return {
            where: async () => []
          };
        }
        return {
          where: () => ({
            orderBy: async () => []
          })
        };
      }
    }),
    __setTemplateId: (templateId: string) => {
      selectedTemplateId = templateId;
    }
  };
}

describe('templates list', () => {
  it('shows one row per key and defaults to published', async () => {
    const db = createMockDb([
      {
        id: '00000000-0000-0000-0000-0000000000a1',
        key: 'customer-order-test',
        name: 'Customer Order Test',
        description: null,
        state: 'published',
        version: 1,
        templateJson: {},
        publishedAt: new Date(),
        createdAt: new Date()
      },
      {
        id: '00000000-0000-0000-0000-0000000000a2',
        key: 'customer-order-test',
        name: 'Customer Order Test',
        description: null,
        state: 'draft',
        version: 2,
        templateJson: {},
        publishedAt: null,
        createdAt: new Date()
      },
      {
        id: '00000000-0000-0000-0000-0000000000b1',
        key: 'production-batch',
        name: 'Production Batch',
        description: null,
        state: 'published',
        version: 3,
        templateJson: {},
        publishedAt: new Date(),
        createdAt: new Date()
      }
    ]);

    const app = Fastify();
    app.addHook('preHandler', async (request) => {
      const match = String(request.url).match(/^\/templates\/([0-9a-f-]{36})/);
      if (match) (db as any).__setTemplateId(match[1]);
    });
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      this.type('application/json').send(data);
    });
    await app.register(uiRoutes, { db: db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({ method: 'GET', url: '/templates' });
    expect(res.statusCode).toBe(200);
    const payload = res.json() as { templates: Array<{ key: string; state: string }> };
    expect(payload.templates).toHaveLength(2);
    expect(payload.templates.map((item) => item.key).sort()).toEqual(['customer-order-test', 'production-batch']);
    expect(payload.templates.every((item) => item.state === 'published')).toBe(true);

    await app.close();
  });

  it('shows all versions for a template key in versions page', async () => {
    const db = createMockDb([
      {
        id: '00000000-0000-0000-0000-0000000000a1',
        key: 'customer-order-test',
        name: 'Customer Order Test',
        description: null,
        state: 'published',
        version: 1,
        templateJson: {},
        publishedAt: new Date(),
        createdAt: new Date()
      },
      {
        id: '00000000-0000-0000-0000-0000000000a2',
        key: 'customer-order-test',
        name: 'Customer Order Test',
        description: null,
        state: 'draft',
        version: 2,
        templateJson: {},
        publishedAt: null,
        createdAt: new Date()
      }
    ]);

    const app = Fastify();
    app.addHook('preHandler', async (request) => {
      const match = String(request.url).match(/^\/templates\/([0-9a-f-]{36})/);
      if (match) (db as any).__setTemplateId(match[1]);
    });
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      this.type('application/json').send(data);
    });
    await app.register(uiRoutes, { db: db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'GET',
      url: '/templates/00000000-0000-0000-0000-0000000000a1/versions'
    });
    expect(res.statusCode).toBe(200);
    const payload = res.json() as { versions: Array<{ version: number }> };
    expect(payload.versions.map((item) => item.version)).toEqual([2, 1]);

    await app.close();
  });
});
