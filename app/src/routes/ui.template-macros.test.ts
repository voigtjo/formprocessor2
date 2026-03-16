import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { uiRoutes } from './ui.js';

describe('template macro sync', () => {
  it('syncs macro refs from actions on template save', async () => {
    const deletedTemplateIds: string[] = [];
    const insertedLinks: Array<{ templateId: string; macroRef: string }> = [];
    const template = {
      id: '00000000-0000-0000-0000-0000000000a1',
      key: 'sync-test',
      name: 'Sync Test',
      description: null,
      state: 'draft',
      publishedAt: null,
      templateJson: {},
      version: 1
    };

    const db = {
      query: {
        fpTemplates: {
          findFirst: async () => template
        },
        fpTemplateAssignments: {
          findMany: async () => []
        }
      },
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: async () => []
          }),
          orderBy: async () => []
        })
      }),
      update: () => ({
        set: () => ({
          where: async () => {}
        })
      }),
      delete: () => ({
        where: async (condition: unknown) => {
          deletedTemplateIds.push(String(condition));
        }
      }),
      insert: () => ({
        values: (values: Array<{ templateId: string; macroRef: string }>) => {
          insertedLinks.push(...values);
          return {
            onConflictDoNothing: async () => {}
          };
        }
      })
    };

    const app = Fastify();
    await app.register(uiRoutes, { db: db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'POST',
      url: `/templates/${template.id}`,
      payload: {
        key: 'sync-test',
        name: 'Sync Test',
        state: 'draft',
        template_json: JSON.stringify({
          fields: {},
          layout: [],
          actions: {
            create_batch: { type: 'macro', ref: 'macro:erp/createBatch@1' },
            composite_action: {
              type: 'composite',
              steps: [{ type: 'macro', ref: 'macro:erp/ensureErpCustomerOrder@1' }]
            }
          }
        })
      }
    });

    expect(res.statusCode).toBe(303);
    expect(deletedTemplateIds.length).toBe(1);
    expect(insertedLinks).toEqual([
      { templateId: template.id, macroRef: 'macro:erp/createBatch@1' },
      { templateId: template.id, macroRef: 'macro:erp/ensureErpCustomerOrder@1' }
    ]);

    await app.close();
  });
});
