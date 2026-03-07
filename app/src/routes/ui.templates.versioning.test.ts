import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { fpDocuments, fpTemplateAssignments, fpTemplates } from '../db/schema.js';
import { uiRoutes } from './ui.js';

type TemplateRecord = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  state: 'draft' | 'published' | 'archived';
  version: number;
  publishedAt: Date | null;
  templateJson: Record<string, unknown>;
};

function createMockDb(initialTemplates: TemplateRecord[]) {
  const templates = [...initialTemplates];
  const insertedDocuments: Array<Record<string, unknown>> = [];
  let contextTemplateId = '';
  let contextTemplateKey = '';

  const db = {
    query: {
      fpTemplates: {
        findFirst: async () => {
          if (!contextTemplateId) return templates[0] ?? null;
          return templates.find((item) => item.id === contextTemplateId) ?? null;
        }
      },
      fpTemplateAssignments: {
        findMany: async () => []
      }
    },
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => templates.filter((item) => item.key === contextTemplateKey).sort((a, b) => b.version - a.version)
        })
      })
    }),
    insert: (table: unknown) => ({
      values: (values: any) => {
        if (table === fpTemplates) {
          const created: TemplateRecord = {
            id: '00000000-0000-0000-0000-0000000000d2',
            key: values.key,
            name: values.name,
            description: values.description ?? null,
            state: values.state,
            version: values.version,
            publishedAt: values.publishedAt ?? null,
            templateJson: values.templateJson
          };
          templates.push(created);
          return {
            returning: async () => [{ id: created.id }]
          };
        }
        if (table === fpTemplateAssignments) {
          return {
            onConflictDoNothing: async () => undefined
          };
        }
        if (table === fpDocuments) {
          insertedDocuments.push(values);
          return {
            returning: async () => [{ id: '00000000-0000-0000-0000-0000000000x1' }]
          };
        }
        return {
          returning: async () => []
        };
      }
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          if (values.state === 'archived') {
            for (const item of templates) {
              if (item.key === contextTemplateKey && item.state === 'published') {
                item.state = 'archived';
                item.publishedAt = null;
              }
            }
            return;
          }
          if (values.state === 'published') {
            const draft = templates.find((item) => item.id === contextTemplateId);
            if (draft) {
              draft.state = 'published';
              draft.publishedAt = new Date();
            }
            return;
          }
        }
      })
    }),
    __setContext: (templateId: string) => {
      contextTemplateId = templateId;
      const template = templates.find((item) => item.id === templateId);
      contextTemplateKey = template?.key ?? '';
    },
    __state: () => ({ templates, insertedDocuments })
  };

  return db;
}

async function createApp(mockDb: any) {
  const app = Fastify();
  app.addHook('preHandler', async (request) => {
    const match = String(request.url).match(/^\/templates\/([0-9a-f-]{36})/);
    if (match) {
      mockDb.__setContext(match[1]);
    }
    request.users = [];
    request.currentUser = null;
  });
  await app.register(uiRoutes, {
    db: mockDb as any,
    erpBaseUrl: 'http://localhost:3001'
  });
  return app;
}

describe('template versioning + publish flow', () => {
  it('opening edit on published template auto-creates next draft version', async () => {
    const db = createMockDb([
      {
        id: '00000000-0000-0000-0000-0000000000a1',
        key: 'change-request',
        name: 'Change Request',
        description: null,
        state: 'published',
        version: 1,
        publishedAt: new Date(),
        templateJson: { fields: {}, layout: [], workflow: { initial: 'created' } }
      }
    ]);
    const app = await createApp(db);

    const res = await app.inject({
      method: 'GET',
      url: '/templates/00000000-0000-0000-0000-0000000000a1/edit'
    });

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/templates/00000000-0000-0000-0000-0000000000d2/edit');
    const state = db.__state();
    expect(state.templates.some((item: TemplateRecord) => item.version === 2 && item.state === 'draft')).toBe(true);

    await app.close();
  });

  it('publishing a draft promotes it and archives previous published version', async () => {
    const db = createMockDb([
      {
        id: '00000000-0000-0000-0000-0000000000a1',
        key: 'change-request',
        name: 'Change Request',
        description: null,
        state: 'published',
        version: 1,
        publishedAt: new Date(),
        templateJson: { fields: {}, layout: [], workflow: { initial: 'created' } }
      },
      {
        id: '00000000-0000-0000-0000-0000000000d2',
        key: 'change-request',
        name: 'Change Request',
        description: null,
        state: 'draft',
        version: 2,
        publishedAt: null,
        templateJson: { fields: {}, layout: [], workflow: { initial: 'assigned' } }
      }
    ]);
    const app = await createApp(db);

    const res = await app.inject({
      method: 'POST',
      url: '/templates/00000000-0000-0000-0000-0000000000d2/publish'
    });

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/templates');
    const state = db.__state();
    const v1 = state.templates.find((item: TemplateRecord) => item.version === 1);
    const v2 = state.templates.find((item: TemplateRecord) => item.version === 2);
    expect(v1?.state).toBe('archived');
    expect(v2?.state).toBe('published');
    expect(v2?.publishedAt).not.toBeNull();

    await app.close();
  });

  it('new document creation uses the newly published version', async () => {
    const db = createMockDb([
      {
        id: '00000000-0000-0000-0000-0000000000d2',
        key: 'change-request',
        name: 'Change Request',
        description: null,
        state: 'published',
        version: 2,
        publishedAt: new Date(),
        templateJson: {
          fields: {},
          layout: [],
          workflow: { initial: 'submitted' }
        }
      }
    ]);
    db.__setContext('00000000-0000-0000-0000-0000000000d2');
    const app = await createApp(db);

    const res = await app.inject({
      method: 'POST',
      url: '/documents',
      payload: { templateId: '00000000-0000-0000-0000-0000000000d2' }
    });

    expect(res.statusCode).toBe(303);
    const inserted = db.__state().insertedDocuments[0];
    expect(inserted.templateId).toBe('00000000-0000-0000-0000-0000000000d2');
    expect(inserted.status).toBe('submitted');

    await app.close();
  });
});
