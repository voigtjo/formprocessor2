import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { uiRoutes } from './ui.js';

function createMockDb() {
  const insertValuesSpy = vi.fn();
  const insertSpy = vi.fn(() => ({
    values: insertValuesSpy.mockImplementation((_values: unknown) => ({
      returning: vi.fn(async () => [{ id: '00000000-0000-0000-0000-0000000000d1' }])
    }))
  }));
  const templateFindSpy = vi.fn();
  const assignmentFindManySpy = vi.fn(async () => []);

  const db = {
    query: {
      fpTemplates: {
        findFirst: templateFindSpy,
        findMany: vi.fn(async () => [])
      },
      fpTemplateAssignments: {
        findMany: assignmentFindManySpy
      }
    },
    insert: insertSpy
  };

  return { db, insertSpy, insertValuesSpy, templateFindSpy, assignmentFindManySpy };
}

describe('documents create route', () => {
  it('GET /documents/new without templateId shows template dropdown wizard', async () => {
    const { db } = createMockDb();
    (db.query.fpTemplates.findMany as any).mockResolvedValue([
      { id: '00000000-0000-0000-0000-0000000000aa', key: 'co', name: 'Customer Order' }
    ]);

    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      const templates = Array.isArray(data.templates) ? (data.templates as Array<Record<string, unknown>>) : [];
      const options = templates
        .map((tpl) => `<option value="${String(tpl.id)}">${String(tpl.name)} (${String(tpl.key)})</option>`)
        .join('');
      this.type('text/html').send(`<select id="templateId" name="templateId">${options}</select>`);
    });
    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001'
    });

    const res = await app.inject({
      method: 'GET',
      url: '/documents/new'
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<select id="templateId" name="templateId"');
    expect(res.body).toContain('Customer Order (co)');

    await app.close();
  });

  it('POST /documents without templateId returns 400 and does not insert', async () => {
    const { db, insertSpy, templateFindSpy } = createMockDb();
    const app = Fastify();
    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001'
    });

    const res = await app.inject({
      method: 'POST',
      url: '/documents',
      payload: {}
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      message: 'Please start from a template. Missing or invalid templateId.'
    });
    expect(templateFindSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();

    await app.close();
  });

  it('POST /documents sets group_id when template assignment exists', async () => {
    const { db, templateFindSpy, assignmentFindManySpy, insertValuesSpy } = createMockDb();
    const templateId = '00000000-0000-0000-0000-0000000000a1';
    const assignedGroupId = '00000000-0000-0000-0000-0000000000b1';

    templateFindSpy.mockResolvedValue({
      id: templateId,
      templateJson: {
        fields: {},
        layout: [],
        workflow: { initial: 'received' }
      }
    });
    assignmentFindManySpy.mockResolvedValue([{ groupId: assignedGroupId }]);

    const app = Fastify();
    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001'
    });

    const res = await app.inject({
      method: 'POST',
      url: '/documents',
      payload: { templateId }
    });

    expect(res.statusCode).toBe(303);
    expect(insertValuesSpy).toHaveBeenCalledOnce();
    expect(insertValuesSpy.mock.calls[0]?.[0]).toMatchObject({
      templateId,
      status: 'received',
      groupId: assignedGroupId
    });

    await app.close();
  });

  it('POST /documents keeps group_id null when template has no assignment', async () => {
    const { db, templateFindSpy, assignmentFindManySpy, insertValuesSpy } = createMockDb();
    const templateId = '00000000-0000-0000-0000-0000000000a2';

    templateFindSpy.mockResolvedValue({
      id: templateId,
      templateJson: {
        fields: {},
        layout: [],
        workflow: { initial: 'received' }
      }
    });
    assignmentFindManySpy.mockResolvedValue([]);

    const app = Fastify();
    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001'
    });

    const res = await app.inject({
      method: 'POST',
      url: '/documents',
      payload: { templateId }
    });

    expect(res.statusCode).toBe(303);
    expect(insertValuesSpy).toHaveBeenCalledOnce();
    expect(insertValuesSpy.mock.calls[0]?.[0]).toMatchObject({
      templateId,
      status: 'received',
      groupId: null
    });

    await app.close();
  });

  it('creates document with product lookup and renders product snapshot label in detail', async () => {
    const templateId = '00000000-0000-0000-0000-0000000000f1';
    const documentId = '00000000-0000-0000-0000-0000000000d9';
    let storedDoc: any = null;

    const template = {
      id: templateId,
      key: 'change-request',
      name: 'Change Request',
      templateJson: {
        fields: {
          product_id: {
            kind: 'lookup',
            label: 'Product',
            source: {
              path: '/api/products',
              query: { valid: true },
              valueKey: 'id',
              labelKey: 'name'
            }
          }
        },
        layout: [
          {
            type: 'group',
            title: 'Main',
            children: [
              {
                type: 'row',
                children: [{ type: 'col', children: [{ type: 'field', key: 'product_id' }] }]
              }
            ]
          }
        ],
        workflow: {
          initial: 'created',
          states: {
            created: { editable: ['product_id'], readonly: [], buttons: [] }
          }
        },
        controls: {},
        actions: {}
      }
    };

    const db = {
      query: {
        fpTemplates: {
          findFirst: vi.fn(async () => template),
          findMany: vi.fn(async () => [template])
        },
        fpTemplateAssignments: {
          findMany: vi.fn(async () => [])
        },
        fpDocuments: {
          findFirst: vi.fn(async () => storedDoc)
        }
      },
      insert: vi.fn(() => ({
        values: vi.fn((values: any) => ({
          returning: vi.fn(async () => {
            storedDoc = {
              id: documentId,
              templateId: values.templateId,
              status: values.status,
              groupId: null,
              dataJson: values.dataJson,
              externalRefsJson: values.externalRefsJson,
              snapshotsJson: values.snapshotsJson
            };
            return [{ id: documentId }];
          })
        }))
      }))
    };

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ items: [{ id: 'p-1', name: 'Super Product' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      this.type('text/html').send(`${String(data.layoutHtml ?? '')}\n${JSON.stringify(data.snapshotsJson ?? {})}`);
    });
    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001'
    });

    const createRes = await app.inject({
      method: 'POST',
      url: '/documents',
      payload: {
        templateId,
        'lookup:product_id': 'p-1'
      }
    });
    expect(createRes.statusCode).toBe(303);
    expect(storedDoc.externalRefsJson.product_id).toBe('p-1');
    expect(storedDoc.snapshotsJson.product_id).toBe('Super Product');

    const detailRes = await app.inject({
      method: 'GET',
      url: `/documents/${documentId}`
    });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.body).toContain('Super Product');
    expect(detailRes.body).not.toContain('>-<');

    vi.unstubAllGlobals();
    await app.close();
  });
});
