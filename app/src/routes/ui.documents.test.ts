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
      state: 'published',
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
      state: 'published',
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

  it('creates document with assigned group and detail header shows group from document.group_id', async () => {
    const templateId = '00000000-0000-0000-0000-0000000000e1';
    const groupId = '00000000-0000-0000-0000-0000000000e2';
    const documentId = '00000000-0000-0000-0000-0000000000e3';
    let storedDoc: any = null;

    const template = {
      id: templateId,
      key: 'change-request',
      name: 'Change Request',
      state: 'published',
      templateJson: {
        fields: {},
        layout: [],
        workflow: {
          initial: 'created',
          states: {
            created: { editable: [], readonly: [], buttons: [] }
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
          findMany: vi.fn(async () => [{ groupId }])
        },
        fpGroups: {
          findFirst: vi.fn(async () => ({ id: groupId, key: 'ops', name: 'Operations' }))
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
              groupId: values.groupId,
              dataJson: values.dataJson ?? {},
              externalRefsJson: values.externalRefsJson ?? {},
              snapshotsJson: values.snapshotsJson ?? {}
            };
            return [{ id: documentId }];
          })
        }))
      }))
    };

    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      this.type('text/html').send(`Group: ${String(data.groupName ?? '—')}`);
    });
    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001'
    });

    const createRes = await app.inject({
      method: 'POST',
      url: '/documents',
      payload: { templateId }
    });
    expect(createRes.statusCode).toBe(303);
    expect(storedDoc.groupId).toBe(groupId);

    const detailRes = await app.inject({
      method: 'GET',
      url: `/documents/${documentId}`
    });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.body).toContain('Group: Operations');

    await app.close();
  });

  it('POST /documents rejects template when state is not published', async () => {
    const { db, templateFindSpy, insertSpy } = createMockDb();
    const templateId = '00000000-0000-0000-0000-0000000000ff';

    templateFindSpy.mockResolvedValue({
      id: templateId,
      state: 'draft',
      templateJson: {
        fields: {},
        layout: [],
        workflow: { initial: 'received' }
      }
    });

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

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ message: 'Only published templates can create documents.' });
    expect(insertSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it('passes workflow timeline in configured workflow.order and highlights current status context', async () => {
    const templateId = '00000000-0000-0000-0000-0000000000f2';
    const documentId = '00000000-0000-0000-0000-0000000000f3';
    const template = {
      id: templateId,
      key: 'rbac-test',
      name: 'RBAC Test',
      state: 'published',
      templateJson: {
        fields: {},
        layout: [],
        workflow: {
          initial: 'created',
          order: ['created', 'assigned', 'submitted', 'approved'],
          states: {
            created: { editable: [], readonly: [], buttons: [] },
            // Intentionally out of order to verify workflow.order precedence.
            approved: { editable: [], readonly: [], buttons: [] },
            submitted: { editable: [], readonly: [], buttons: [] },
            assigned: { editable: [], readonly: [], buttons: [] }
          }
        },
        controls: {},
        actions: {}
      }
    };

    const db = {
      query: {
        fpDocuments: {
          findFirst: vi.fn(async () => ({
            id: documentId,
            templateId,
            status: 'submitted',
            groupId: null,
            dataJson: {},
            externalRefsJson: {},
            snapshotsJson: {}
          }))
        },
        fpTemplates: {
          findFirst: vi.fn(async () => template)
        }
      }
    };

    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      const timeline = Array.isArray(data.workflowTimeline) ? data.workflowTimeline : [];
      const status = String((data.document as Record<string, unknown>)?.status ?? '');
      this.type('text/plain').send(`${timeline.join(' -> ')} | current=${status}`);
    });
    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001'
    });

    const res = await app.inject({
      method: 'GET',
      url: `/documents/${documentId}`
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('created -> assigned -> submitted -> approved');
    expect(res.body).toContain('current=submitted');

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
      state: 'published',
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

  it('creates published document with template_version and date/checkbox roundtrip', async () => {
    const templateId = '00000000-0000-0000-0000-000000000aa1';
    const documentId = '00000000-0000-0000-0000-000000000dd1';
    let storedDoc: any = null;

    const template = {
      id: templateId,
      key: 'ops-check',
      name: 'Ops Check',
      state: 'published',
      version: 2,
      templateJson: {
        fields: {
          due_date: { kind: 'editable', label: 'Due date', inputType: 'date' },
          urgent: { kind: 'editable', label: 'Urgent?', inputType: 'checkbox' }
        },
        layout: [{ type: 'field', key: 'due_date' }, { type: 'field', key: 'urgent' }],
        workflow: {
          initial: 'created',
          states: {
            created: { editable: ['due_date', 'urgent'], readonly: [], buttons: [] }
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
        fpTemplateAssignments: { findMany: vi.fn(async () => []) },
        fpDocuments: { findFirst: vi.fn(async () => storedDoc) }
      },
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(async () => [template])
          }))
        }))
      })),
      insert: vi.fn(() => ({
        values: vi.fn((values: any) => ({
          returning: vi.fn(async () => {
            storedDoc = {
              id: documentId,
              templateId: values.templateId,
              templateVersion: values.templateVersion,
              status: values.status,
              groupId: values.groupId,
              dataJson: values.dataJson ?? {},
              externalRefsJson: values.externalRefsJson ?? {},
              snapshotsJson: values.snapshotsJson ?? {}
            };
            return [{ id: documentId }];
          })
        }))
      })),
      update: vi.fn(() => ({
        set: vi.fn((values: any) => ({
          where: vi.fn(async () => {
            storedDoc = { ...storedDoc, ...values };
          })
        }))
      }))
    };

    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      this.type('text/html').send(String(data.layoutHtml ?? ''));
    });
    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001',
      hasDocumentTemplateVersion: true
    });

    const createRes = await app.inject({
      method: 'POST',
      url: '/documents',
      payload: { templateId, 'data:due_date': '2026-03-12', 'data:urgent': '1' }
    });
    expect(createRes.statusCode).toBe(303);
    expect(storedDoc.templateVersion).toBe(2);
    expect(storedDoc.dataJson).toMatchObject({ due_date: '2026-03-12', urgent: true });

    const detailRes = await app.inject({
      method: 'GET',
      url: `/documents/${documentId}`
    });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.body).toContain('name="data:due_date"');
    expect(detailRes.body).toContain('type="date"');
    expect(detailRes.body).toContain('name="data:urgent"');
    expect(detailRes.body).toContain('type="checkbox"');

    const saveRes = await app.inject({
      method: 'POST',
      url: `/documents/${documentId}/save`,
      payload: { 'data:due_date': '2026-03-13' }
    });
    expect(saveRes.statusCode).toBe(303);
    expect(storedDoc.dataJson).toMatchObject({ due_date: '2026-03-13', urgent: false });

    await app.close();
  });
});
