import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { healthRoutes } from '../../app/src/routes/health.js';
import { uiRoutes } from '../../app/src/routes/ui.js';

function createMockDb() {
  const template = {
    id: '00000000-0000-0000-0000-000000000011',
    key: 'change-request',
    name: 'Change Request',
    state: 'active',
    templateJson: {
      fields: {},
      layout: [],
      workflow: { initial: 'Assigned', states: { Assigned: { editable: [], readonly: [], buttons: [] } } },
      controls: {},
      actions: {}
    }
  };

  return {
    query: {
      fpTemplates: {
        findMany: async () => [template],
        findFirst: async () => template
      },
      fpTemplateAssignments: {
        findMany: async () => []
      },
      fpDocuments: {
        findFirst: async () => null
      }
    },
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => [
            {
              id: template.id,
              key: template.key,
              name: template.name,
              description: null,
              state: template.state,
              version: 1
            }
          ]
        }),
        innerJoin: () => ({
          orderBy: async () => []
        })
      })
    }),
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: '00000000-0000-0000-0000-000000000099' }]
      })
    }),
    update: () => ({
      set: () => ({
        where: async () => {}
      })
    }),
    transaction: async (cb: (tx: any) => Promise<void>) => {
      await cb({
        update: () => ({
          set: () => ({
            where: async () => {}
          })
        })
      });
    }
  };
}

async function createApp() {
  const app = Fastify();
  app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
    const content = JSON.stringify(data);
    this.type('text/html').send(content);
  });
  app.addHook('preHandler', async (request) => {
    request.users = [{ id: 'u1', username: 'alice', displayName: 'Alice' }];
    request.currentUser = request.users[0];
  });

  await app.register(healthRoutes);
  await app.register(uiRoutes, {
    db: createMockDb() as any,
    erpBaseUrl: 'http://localhost:3001'
  });

  return app;
}

describe('E2E smoke via inject', () => {
  it('GET /health returns 200', async () => {
    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it('GET /templates returns active template page', async () => {
    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/templates' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('change-request');
    await app.close();
  });

  it('GET /documents/new without templateId returns wizard select', async () => {
    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/documents/new' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"selectedTemplateId":""');
    expect(res.body).toContain('"templates"');
    await app.close();
  });
});
