import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { uiRoutes } from './ui.js';
import { macroRegistryByRef } from '../actions/macros/index.js';

function createMacroCatalogSelect(
  getRow: () =>
    | {
        ref: string;
        isEnabled: boolean;
        kind?: string | null;
        definitionJson?: unknown;
        paramsSchemaJson?: unknown;
      }
    | undefined
) {
  return () => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          const row = getRow();
          if (!row) return [];
          return [
            {
              ref: row.ref,
              isEnabled: row.isEnabled,
              kind: row.kind ?? 'json',
              definitionJson: row.definitionJson ?? null,
              paramsSchemaJson: row.paramsSchemaJson ?? null
            }
          ];
        }
      })
    })
  });
}

function createMockDb() {
  let currentStatus = 'Assigned';
  let currentDataJson: Record<string, unknown> = { status: 'LegacyDataStatus' };

  const document = {
    id: '00000000-0000-0000-0000-0000000000d1',
    templateId: '00000000-0000-0000-0000-0000000000t1',
    status: currentStatus,
    dataJson: currentDataJson,
    externalRefsJson: {},
    snapshotsJson: {}
  };

  const template = {
    id: '00000000-0000-0000-0000-0000000000t1',
    key: 'customer-order',
    name: 'Customer Order',
    templateJson: {
      fields: {},
      layout: [],
      workflow: {
        initial: 'Assigned',
        states: {
          Assigned: { editable: [], readonly: [], buttons: ['start'] },
          Started: { editable: [], readonly: [], buttons: ['submit'] },
          Submitted: { editable: [], readonly: [], buttons: ['approve'] }
        }
      },
      controls: {
        start: { label: 'Start', action: 'startAction' },
        submit: { label: 'Submit', action: 'submitAction' },
        approve: { label: 'Approve', action: 'approveAction' }
      },
      actions: {
        startAction: { type: 'composite', steps: [{ type: 'setStatus', to: 'Started' }] },
        submitAction: { type: 'composite', steps: [{ type: 'setStatus', to: 'Submitted' }] },
        approveAction: { type: 'composite', steps: [{ type: 'setStatus', to: 'Approved' }] }
      }
    }
  };

  const db = {
    select: createMacroCatalogSelect(() => ({ ref: 'macro:ui/reloadLookup@1', isEnabled: true })),
    query: {
      fpDocuments: {
        findFirst: async () => ({ ...document, status: currentStatus })
      },
      fpTemplates: {
        findFirst: async () => template
      },
      fpTemplateAssignments: {
        findMany: async () => []
      }
    },
    transaction: async (cb: (tx: any) => Promise<void>) => {
      const tx = {
        update: () => ({
          set: (values: any) => ({
            where: async () => {
              if (typeof values.status === 'string') {
                currentStatus = values.status;
              }
              if (values.dataJson && typeof values.dataJson === 'object') {
                currentDataJson = values.dataJson as Record<string, unknown>;
              }
            }
          })
        })
      };
      await cb(tx);
    }
  };

  return {
    db,
    getStatus: () => currentStatus,
    getDataJson: () => currentDataJson
  };
}

function createLayoutButtonMockDb(actionDef: unknown) {
  let currentStatus = 'Assigned';

  const document = {
    id: '00000000-0000-0000-0000-0000000000d2',
    templateId: '00000000-0000-0000-0000-0000000000t2',
    status: currentStatus,
    dataJson: {},
    externalRefsJson: {},
    snapshotsJson: {}
  };

  const template = {
    id: '00000000-0000-0000-0000-0000000000t2',
    key: 'layout-ui',
    name: 'Layout UI',
    templateJson: {
      fields: {},
      layout: [{ type: 'button', key: 'uiReload', action: 'uiReload' }],
      workflow: {
        initial: 'Assigned',
        states: {
          Assigned: { editable: [], readonly: [], buttons: [] }
        }
      },
      controls: {
        uiReload: { label: 'Reload', action: 'uiReloadAction' }
      },
      actions: {
        uiReloadAction: actionDef
      }
    }
  };

  const db = {
    select: createMacroCatalogSelect(() => ({ ref: 'macro:ui/reloadLookup@1', isEnabled: true })),
    query: {
      fpDocuments: {
        findFirst: async () => ({ ...document, status: currentStatus })
      },
      fpTemplates: {
        findFirst: async () => template
      },
      fpTemplateAssignments: {
        findMany: async () => []
      }
    },
    transaction: async (cb: (tx: any) => Promise<void>) => {
      const tx = {
        update: () => ({
          set: (values: any) => ({
            where: async () => {
              if (typeof values.status === 'string') {
                currentStatus = values.status;
              }
            }
          })
        })
      };
      await cb(tx);
    }
  };

  return {
    db,
    getStatus: () => currentStatus
  };
}

function createCustomerOrderLayoutButtonDb() {
  let currentStatus = 'Created';
  let currentDataJson: Record<string, unknown> = {};
  let currentExternalRefsJson: Record<string, unknown> = {
    customer_id: '99999999-0000-0000-0000-000000000001'
  };
  let currentSnapshotsJson: Record<string, unknown> = {};

  const document = {
    id: '00000000-0000-0000-0000-0000000000d5',
    templateId: '00000000-0000-0000-0000-0000000000t5',
    status: currentStatus,
    dataJson: currentDataJson,
    externalRefsJson: currentExternalRefsJson,
    snapshotsJson: currentSnapshotsJson
  };

  const template = {
    id: '00000000-0000-0000-0000-0000000000t5',
    key: 'customer-order-layout-ui',
    name: 'Customer Order Layout UI',
    templateJson: {
      fields: {},
      layout: [{ type: 'button', key: 'create_customer_order', action: 'create_customer_order', kind: 'ui' }],
      workflow: {
        initial: 'Created',
        states: {
          Created: { editable: [], readonly: [], buttons: [] }
        }
      },
      controls: {
        create_customer_order: { label: 'Create Customer Order', action: 'createCustomerOrderAction' }
      },
      actions: {
        createCustomerOrderAction: { type: 'macro', ref: 'macro:erp/ensureErpCustomerOrder@1' }
      }
    }
  };

  const db = {
    select: createMacroCatalogSelect(() => ({
      ref: 'macro:erp/ensureErpCustomerOrder@1',
      isEnabled: true,
      kind: 'json',
      paramsSchemaJson: {
        properties: {
          customerRefKey: { default: 'customer_id' },
          writeFieldKey: { default: 'customer_order_number' },
          writeExternalRefKey: { default: 'customer_order_id' },
          writeSnapshotKey: { default: 'customer_order_number' }
        }
      },
      definitionJson: {
        ops: [
          { op: 'read', from: 'external.{{params.customerRefKey}}', to: 'vars.customerId' },
          { op: 'fallback', from: 'data.{{params.customerRefKey}}', to: 'vars.customerId' },
          { op: 'require', from: 'vars.customerId', message: 'Select a customer first.' },
          {
            op: 'http.post',
            service: 'erp',
            path: '/api/customer-orders',
            body: { customer_id: '{{vars.customerId}}' },
            to: 'vars.response'
          },
          { op: 'require', from: 'vars.response.id', message: 'ERP customer order response missing id.' },
          { op: 'require', from: 'vars.response.order_number', message: 'ERP customer order response missing order_number.' },
          { op: 'write', to: 'data.{{params.writeFieldKey}}', value: '{{vars.response.order_number}}' },
          { op: 'write', to: 'external.{{params.writeExternalRefKey}}', value: '{{vars.response.id}}' },
          { op: 'write', to: 'snapshot.{{params.writeSnapshotKey}}', value: '{{vars.response.order_number}}' }
        ]
      }
    })),
    query: {
      fpDocuments: {
        findFirst: async () => ({
          ...document,
          status: currentStatus,
          dataJson: currentDataJson,
          externalRefsJson: currentExternalRefsJson,
          snapshotsJson: currentSnapshotsJson
        })
      },
      fpTemplates: {
        findFirst: async () => template
      },
      fpTemplateAssignments: {
        findMany: async () => []
      }
    },
    transaction: async (cb: (tx: any) => Promise<void>) => {
      const tx = {
        update: () => ({
          set: (values: any) => ({
            where: async () => {
              if (typeof values.status === 'string') currentStatus = values.status;
              if (values.dataJson && typeof values.dataJson === 'object') currentDataJson = values.dataJson;
              if (values.externalRefsJson && typeof values.externalRefsJson === 'object') {
                currentExternalRefsJson = values.externalRefsJson;
              }
              if (values.snapshotsJson && typeof values.snapshotsJson === 'object') {
                currentSnapshotsJson = values.snapshotsJson;
              }
            }
          })
        })
      };
      await cb(tx);
    }
  };

  return {
    db,
    state: () => ({
      status: currentStatus,
      dataJson: currentDataJson,
      externalRefsJson: currentExternalRefsJson,
      snapshotsJson: currentSnapshotsJson
    })
  };
}

function createCreateBatchMacroMockDb(options?: { includeInStateButtons?: boolean; includeLayoutButton?: boolean }) {
  const includeInStateButtons = options?.includeInStateButtons ?? true;
  const includeLayoutButton = options?.includeLayoutButton ?? false;
  let currentStatus = 'Created';
  let currentDataJson: Record<string, unknown> = {};
  let currentExternalRefsJson: Record<string, unknown> = {
    product_id: '00000000-0000-0000-0000-000000000001'
  };
  let currentSnapshotsJson: Record<string, unknown> = {};
  let macroCatalogRow:
    | {
        ref: string;
        isEnabled: boolean;
        kind?: string | null;
        definitionJson?: unknown;
        paramsSchemaJson?: unknown;
      }
    | undefined = {
    ref: 'macro:erp/createBatch@1',
    isEnabled: true
  };

  const document = {
    id: '00000000-0000-0000-0000-0000000000d3',
    templateId: '00000000-0000-0000-0000-0000000000t3',
    status: currentStatus,
    dataJson: currentDataJson,
    externalRefsJson: currentExternalRefsJson,
    snapshotsJson: currentSnapshotsJson
  };

  const template = {
    id: '00000000-0000-0000-0000-0000000000t3',
    key: 'batch-create-test',
    name: 'Batch Create Test',
    templateJson: {
      fields: {},
      layout: [],
      workflow: {
        initial: 'Created',
        states: {
          Created: { editable: [], readonly: [], buttons: includeInStateButtons ? ['create_batch'] : [] }
        }
      },
      controls: {
        create_batch: { label: 'Create Batch', action: 'createBatchAction' }
      },
      actions: {
        createBatchAction: { type: 'macro', ref: 'macro:erp/createBatch@1' }
      }
    }
  };
  if (includeLayoutButton) {
    (template.templateJson as any).layout = [
      { type: 'button', key: 'create_batch', action: 'create_batch', kind: 'process', label: 'Create Batch' }
    ];
  }

  const db = {
    select: createMacroCatalogSelect(() => macroCatalogRow),
    query: {
      fpDocuments: {
        findFirst: async () => ({
          ...document,
          status: currentStatus,
          dataJson: currentDataJson,
          externalRefsJson: currentExternalRefsJson,
          snapshotsJson: currentSnapshotsJson
        })
      },
      fpTemplates: {
        findFirst: async () => template
      },
      fpTemplateAssignments: {
        findMany: async () => []
      }
    },
    transaction: async (cb: (tx: any) => Promise<void>) => {
      const tx = {
        update: () => ({
          set: (values: any) => ({
            where: async () => {
              if (typeof values.status === 'string') currentStatus = values.status;
              if (values.dataJson && typeof values.dataJson === 'object') currentDataJson = values.dataJson;
              if (values.externalRefsJson && typeof values.externalRefsJson === 'object') {
                currentExternalRefsJson = values.externalRefsJson;
              }
              if (values.snapshotsJson && typeof values.snapshotsJson === 'object') {
                currentSnapshotsJson = values.snapshotsJson;
              }
            }
          })
        })
      };
      await cb(tx);
    }
  };

  return {
    db,
    setMacroCatalogRow: (
      row:
        | {
            ref: string;
            isEnabled: boolean;
            kind?: string | null;
            definitionJson?: unknown;
            paramsSchemaJson?: unknown;
          }
        | undefined
    ) => {
      macroCatalogRow = row;
    },
    state: () => ({
      status: currentStatus,
      dataJson: currentDataJson,
      externalRefsJson: currentExternalRefsJson,
      snapshotsJson: currentSnapshotsJson
    })
  };
}

function createCreatedStateFieldLockingDb() {
  let currentStatus = 'created';
  let currentDataJson: Record<string, unknown> = {
    title: 'Batch Doc',
    due_date: '2026-03-10',
    urgent: true
  };
  let currentExternalRefsJson: Record<string, unknown> = {
    product_id: '00000000-0000-0000-0000-000000000001'
  };
  let currentSnapshotsJson: Record<string, unknown> = {
    product_id: 'Batch Product'
  };

  const document = {
    id: '00000000-0000-0000-0000-0000000000d4',
    templateId: '00000000-0000-0000-0000-0000000000t4',
    status: currentStatus,
    dataJson: currentDataJson,
    externalRefsJson: currentExternalRefsJson,
    snapshotsJson: currentSnapshotsJson
  };

  const template = {
    id: '00000000-0000-0000-0000-0000000000t4',
    key: 'production-batch-macro-test-v2',
    name: 'Production Batch Macro Test v2',
    templateJson: {
      fields: {
        status: { kind: 'workflow', label: 'Status' },
        product_id: { kind: 'lookup', label: 'Product' },
        title: { kind: 'editable', label: 'Title' },
        due_date: { kind: 'date', label: 'Due Date' },
        urgent: { kind: 'checkbox', label: 'Urgent' },
        batch_number: { kind: 'editable', label: 'Batch Number' }
      },
      layout: [
        { type: 'field', key: 'product_id' },
        { type: 'field', key: 'title' },
        { type: 'field', key: 'due_date' },
        { type: 'field', key: 'urgent' },
        { type: 'field', key: 'batch_number' },
        { type: 'button', key: 'create_batch', action: 'create_batch', kind: 'process', label: 'Create Batch' }
      ],
      workflow: {
        initial: 'created',
        states: {
          created: {
            editable: ['product_id'],
            readonly: ['status', 'title', 'due_date', 'urgent', 'batch_number'],
            buttons: []
          },
          assigned: {
            editable: ['title', 'due_date', 'urgent', 'product_id'],
            readonly: ['status', 'batch_number'],
            buttons: []
          }
        }
      },
      controls: {
        create_batch: { label: 'Create Batch', action: 'createBatchAction' }
      },
      actions: {
        createBatchAction: { type: 'macro', ref: 'macro:erp/createBatch@1' }
      }
    }
  };

  const db = {
    select: createMacroCatalogSelect(() => ({ ref: 'macro:erp/createBatch@1', isEnabled: true })),
    query: {
      fpDocuments: {
        findFirst: async () => ({
          ...document,
          status: currentStatus,
          dataJson: currentDataJson,
          externalRefsJson: currentExternalRefsJson,
          snapshotsJson: currentSnapshotsJson
        })
      },
      fpTemplates: {
        findFirst: async () => template
      },
      fpTemplateAssignments: {
        findMany: async () => []
      }
    },
    transaction: async (cb: (tx: any) => Promise<void>) => {
      const tx = {
        update: () => ({
          set: (values: any) => ({
            where: async () => {
              if (typeof values.status === 'string') currentStatus = values.status;
              if (values.dataJson && typeof values.dataJson === 'object') currentDataJson = values.dataJson;
              if (values.externalRefsJson && typeof values.externalRefsJson === 'object') {
                currentExternalRefsJson = values.externalRefsJson;
              }
              if (values.snapshotsJson && typeof values.snapshotsJson === 'object') {
                currentSnapshotsJson = values.snapshotsJson;
              }
            }
          })
        })
      };
      await cb(tx);
    }
  };

  return {
    db,
    state: () => ({
      status: currentStatus,
      dataJson: currentDataJson,
      externalRefsJson: currentExternalRefsJson,
      snapshotsJson: currentSnapshotsJson
    })
  };
}

describe('workflow action execution', () => {
  it('GET action route does not execute and redirects to document', async () => {
    const mock = createMockDb();
    const app = Fastify();
    await app.register(uiRoutes, { db: mock.db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'GET',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/action/start'
    });

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/documents/00000000-0000-0000-0000-0000000000d1');
    expect(mock.getStatus()).toBe('Assigned');

    await app.close();
  });

  it('POST start then submit updates document status', async () => {
    const mock = createMockDb();
    const app = Fastify();
    await app.register(uiRoutes, { db: mock.db as any, erpBaseUrl: 'http://localhost:3001' });

    const startRes = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/action/start',
      payload: {}
    });
    expect(startRes.statusCode).toBe(303);
    expect(startRes.headers.location).toBe('/documents/00000000-0000-0000-0000-0000000000d1');
    expect(mock.getStatus()).toBe('Started');

    const submitRes = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/action/submit',
      payload: {}
    });
    expect(submitRes.statusCode).toBe(303);
    expect(submitRes.headers.location).toBe('/documents/00000000-0000-0000-0000-0000000000d1');
    expect(mock.getStatus()).toBe('Submitted');

    await app.close();
  });

  it('setStatus updates fp_documents.status and does not persist data_json.status', async () => {
    const mock = createMockDb();
    const app = Fastify();
    await app.register(uiRoutes, { db: mock.db as any, erpBaseUrl: 'http://localhost:3001' });

    const startRes = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/action/start',
      payload: {}
    });

    expect(startRes.statusCode).toBe(303);
    expect(mock.getStatus()).toBe('Started');
    expect(mock.getDataJson().status).toBeUndefined();

    await app.close();
  });

  it('denies process action execution from layout button source', async () => {
    const mock = createLayoutButtonMockDb({
      type: 'composite',
      steps: [{ type: 'setStatus', to: 'Started' }]
    });
    const app = Fastify();
    await app.register(uiRoutes, { db: mock.db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d2/action/uiReload?source=ui',
      payload: {}
    });

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toContain('/documents/00000000-0000-0000-0000-0000000000d2?error=');
    expect(String(res.headers.location)).toContain('UI+button+cannot+execute+process+action');
    expect(mock.getStatus()).toBe('Assigned');

    await app.close();
  });

  it('allows reloadLookup macro from layout button source', async () => {
    const mock = createLayoutButtonMockDb({ type: 'macro', ref: 'macro:ui/reloadLookup@1' });
    const app = Fastify();
    await app.register(uiRoutes, { db: mock.db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d2/action/uiReload?source=ui',
      payload: {}
    });

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/documents/00000000-0000-0000-0000-0000000000d2');
    expect(mock.getStatus()).toBe('Assigned');

    await app.close();
  });

  it('allows create_customer_order macro from layout button source=ui', async () => {
    const mock = createCustomerOrderLayoutButtonDb();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'co-ui-1', order_number: 'CO-UI-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const app = Fastify();
    await app.register(uiRoutes, { db: mock.db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d5/action/create_customer_order?source=ui',
      payload: {}
    });

    expect(res.statusCode).toBe(303);
    expect(String(res.headers.location)).toContain('/documents/00000000-0000-0000-0000-0000000000d5');
    expect(String(res.headers.location)).not.toContain('error=');
    expect(mock.state().dataJson.customer_order_number).toBe('CO-UI-1');
    expect(mock.state().externalRefsJson.customer_order_id).toBe('co-ui-1');
    expect(mock.state().snapshotsJson.customer_order_number).toBe('CO-UI-1');

    vi.unstubAllGlobals();
    await app.close();
  });

  it('integration: create_batch macro writes batch_number into document data_json', async () => {
    const mock = createCreateBatchMacroMockDb();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'batch-1',
          batch_number: 'B-00000000-NEW'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const app = Fastify();
    await app.register(uiRoutes, { db: mock.db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d3/action/create_batch',
      payload: {}
    });

    expect(res.statusCode).toBe(303);
    expect(mock.state().dataJson.batch_number).toBe('B-00000000-NEW');
    expect(mock.state().externalRefsJson.batch_id).toBe('batch-1');
    expect(mock.state().snapshotsJson.batch_id).toBe('B-00000000-NEW');

    vi.unstubAllGlobals();
    await app.close();
  });

  it('shows success banner message after macro action redirect', async () => {
    const mock = createCreateBatchMacroMockDb();
    mock.setMacroCatalogRow({
      ref: 'macro:erp/createBatch@1',
      isEnabled: true,
      kind: 'json',
      definitionJson: {
        ops: [
          { op: 'write', to: 'data.batch_number', value: 'B-DB-MSG-1' },
          { op: 'message', value: 'Batch created via DB macro: B-DB-MSG-1' }
        ]
      }
    });

    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(view: string, data: Record<string, unknown> = {}) {
      this.type('application/json').send({ view, data });
    });
    await app.register(uiRoutes, { db: mock.db as any, erpBaseUrl: 'http://localhost:3001' });

    const actionRes = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d3/action/create_batch',
      payload: {}
    });

    expect(actionRes.statusCode).toBe(303);
    expect(String(actionRes.headers.location)).toContain('message=Batch+created+via+DB+macro%3A+B-DB-MSG-1');

    const detailRes = await app.inject({
      method: 'GET',
      url: String(actionRes.headers.location)
    });
    expect(detailRes.statusCode).toBe(200);
    const body = detailRes.json() as any;
    expect(body.view).toBe('documents/detail.ejs');
    expect(body.data.successMessage).toBe('Batch created via DB macro: B-DB-MSG-1');

    await app.close();
  });

  it('existing template create_batch action works unchanged with db-json macro defaults', async () => {
    const mock = createCreateBatchMacroMockDb();
    mock.setMacroCatalogRow({
      ref: 'macro:erp/createBatch@1',
      isEnabled: true,
      kind: 'json',
      paramsSchemaJson: {
        properties: {
          productRefKey: { default: 'product_id' },
          writeFieldKey: { default: 'batch_number' },
          writeExternalRefKey: { default: 'batch_id' },
          writeSnapshotKey: { default: 'batch_number' }
        }
      },
      definitionJson: {
        ops: [
          { op: 'read', from: 'external.{{params.productRefKey}}', to: 'vars.productId' },
          { op: 'fallback', from: 'data.{{params.productRefKey}}', to: 'vars.productId' },
          { op: 'require', from: 'vars.productId', message: 'Select a product first.' },
          {
            op: 'http.post',
            service: 'erp',
            path: '/api/batches',
            body: { product_id: '{{vars.productId}}' },
            to: 'vars.batchResponse'
          },
          { op: 'write', to: 'data.{{params.writeFieldKey}}', value: '{{vars.batchResponse.batch_number}}' },
          { op: 'write', to: 'external.{{params.writeExternalRefKey}}', value: '{{vars.batchResponse.id}}' },
          { op: 'write', to: 'snapshot.{{params.writeSnapshotKey}}', value: '{{vars.batchResponse.batch_number}}' }
        ]
      }
    });

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'batch-db-default',
          batch_number: 'B-DB-DEFAULT'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const app = Fastify();
    await app.register(uiRoutes, { db: mock.db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d3/action/create_batch',
      payload: {}
    });

    expect(res.statusCode).toBe(303);
    expect(mock.state().dataJson.batch_number).toBe('B-DB-DEFAULT');
    expect(mock.state().externalRefsJson.batch_id).toBe('batch-db-default');
    expect(mock.state().snapshotsJson.batch_number).toBe('B-DB-DEFAULT');
    vi.unstubAllGlobals();
    await app.close();
  });

  it('shows success message for ensureErpCustomerOrder db-json macro in document UI', async () => {
    let currentStatus = 'Created';
    let currentDataJson: Record<string, unknown> = {};
    let currentExternalRefsJson: Record<string, unknown> = {
      customer_id: '22222222-0000-0000-0000-000000000001'
    };
    let currentSnapshotsJson: Record<string, unknown> = {};

    const db = {
      select: createMacroCatalogSelect(() => ({
        ref: 'macro:erp/ensureErpCustomerOrder@1',
        isEnabled: true,
        kind: 'json',
        paramsSchemaJson: {
          properties: {
            customerRefKey: { default: 'customer_id' },
            writeFieldKey: { default: 'customer_order_number' },
            writeExternalRefKey: { default: 'customer_order_id' },
            writeSnapshotKey: { default: 'customer_order_number' }
          }
        },
        definitionJson: {
          ops: [
            { op: 'read', from: 'external.{{params.customerRefKey}}', to: 'vars.customerId' },
            { op: 'fallback', from: 'data.{{params.customerRefKey}}', to: 'vars.customerId' },
            { op: 'require', from: 'vars.customerId', message: 'Select a customer first.' },
            {
              op: 'http.post',
              service: 'erp',
              path: '/api/customer-orders',
              body: { customer_id: '{{vars.customerId}}' },
              to: 'vars.response'
            },
            { op: 'require', from: 'vars.response.id', message: 'ERP customer order response missing id.' },
            {
              op: 'require',
              from: 'vars.response.order_number',
              message: 'ERP customer order response missing order_number.'
            },
            { op: 'write', to: 'data.{{params.writeFieldKey}}', value: '{{vars.response.order_number}}' },
            { op: 'write', to: 'external.{{params.writeExternalRefKey}}', value: '{{vars.response.id}}' },
            { op: 'write', to: 'snapshot.{{params.writeSnapshotKey}}', value: '{{vars.response.order_number}}' },
            { op: 'message', value: 'Customer order created via DB macro: {{vars.response.order_number}}' }
          ]
        }
      })),
      query: {
        fpDocuments: {
          findFirst: async () => ({
            id: '00000000-0000-0000-0000-0000000000e1',
            templateId: '00000000-0000-0000-0000-0000000000te',
            status: currentStatus,
            dataJson: currentDataJson,
            externalRefsJson: currentExternalRefsJson,
            snapshotsJson: currentSnapshotsJson
          })
        },
        fpTemplates: {
          findFirst: async () => ({
            id: '00000000-0000-0000-0000-0000000000te',
            key: 'customer-order-macro',
            name: 'Customer Order Macro',
            templateJson: {
              fields: {},
              layout: [],
              workflow: {
                initial: 'Created',
                states: {
                  Created: { editable: [], readonly: [], buttons: ['ensure_customer_order'] }
                }
              },
              controls: {
                ensure_customer_order: { label: 'Ensure Customer Order', action: 'ensureCustomerOrderAction' }
              },
              actions: {
                ensureCustomerOrderAction: { type: 'macro', ref: 'macro:erp/ensureErpCustomerOrder@1' }
              }
            }
          })
        },
        fpTemplateAssignments: {
          findMany: async () => []
        }
      },
      transaction: async (cb: (tx: any) => Promise<void>) => {
        const tx = {
          update: () => ({
            set: (values: any) => ({
              where: async () => {
                if (typeof values.status === 'string') currentStatus = values.status;
                if (values.dataJson && typeof values.dataJson === 'object') currentDataJson = values.dataJson;
                if (values.externalRefsJson && typeof values.externalRefsJson === 'object') {
                  currentExternalRefsJson = values.externalRefsJson;
                }
                if (values.snapshotsJson && typeof values.snapshotsJson === 'object') {
                  currentSnapshotsJson = values.snapshotsJson;
                }
              }
            })
          })
        };
        await cb(tx);
      }
    };

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'co-db-1', order_number: 'CO-DB-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(view: string, data: Record<string, unknown> = {}) {
      this.type('application/json').send({ view, data });
    });
    await app.register(uiRoutes, { db: db as any, erpBaseUrl: 'http://localhost:3001' });

    const actionRes = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000e1/action/ensure_customer_order',
      payload: {}
    });

    expect(actionRes.statusCode).toBe(303);
    expect(String(actionRes.headers.location)).toContain('message=Customer+order+created+via+DB+macro%3A+CO-DB-1');
    expect(currentDataJson.customer_order_number).toBe('CO-DB-1');
    expect(currentExternalRefsJson.customer_order_id).toBe('co-db-1');
    expect(currentSnapshotsJson.customer_order_number).toBe('CO-DB-1');

    const detailRes = await app.inject({
      method: 'GET',
      url: String(actionRes.headers.location)
    });
    expect(detailRes.statusCode).toBe(200);
    const body = detailRes.json() as any;
    expect(body.data.successMessage).toBe('Customer order created via DB macro: CO-DB-1');

    vi.unstubAllGlobals();
    await app.close();
  });

  it('initializes macro runtime with templateDefinition.fullSchema for create_batch', async () => {
    const mock = createCreateBatchMacroMockDb();
    const originalMacro = macroRegistryByRef['macro:erp/createBatch@1'];
    macroRegistryByRef['macro:erp/createBatch@1'] = async (ctx) => {
      const fullSchema = (ctx as { templateDefinition?: { fullSchema?: unknown } }).templateDefinition?.fullSchema;
      if (!fullSchema || typeof fullSchema !== 'object') {
        throw new Error('missing templateDefinition.fullSchema');
      }
      return {
        dataJson: { batch_number: 'B-CONTEXT-OK' }
      };
    };

    const app = Fastify();
    try {
      await app.register(uiRoutes, { db: mock.db as any, erpBaseUrl: 'http://localhost:3001' });

      const res = await app.inject({
        method: 'POST',
        url: '/documents/00000000-0000-0000-0000-0000000000d3/action/create_batch',
        payload: {}
      });

      expect(res.statusCode).toBe(303);
      expect(mock.state().dataJson.batch_number).toBe('B-CONTEXT-OK');
    } finally {
      macroRegistryByRef['macro:erp/createBatch@1'] = originalMacro;
      await app.close();
    }
  });

  it('layout button create_batch works without being listed in current state buttons', async () => {
    const mock = createCreateBatchMacroMockDb({ includeInStateButtons: false, includeLayoutButton: true });
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'batch-2',
          batch_number: 'B-00000000-LAYOUT'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const app = Fastify();
    await app.register(uiRoutes, { db: mock.db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d3/action/create_batch',
      payload: {}
    });

    expect(res.statusCode).toBe(303);
    expect(mock.state().dataJson.batch_number).toBe('B-00000000-LAYOUT');
    vi.unstubAllGlobals();
    await app.close();
  });

  it('process action save still requires presence in workflow state buttons', async () => {
    const db = createMockDb();
    const app = Fastify();
    await app.register(uiRoutes, { db: db.db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/action/save',
      payload: {}
    });

    expect(res.statusCode).toBe(303);
    expect(String(res.headers.location)).toContain('/documents/00000000-0000-0000-0000-0000000000d1?error=');
    expect(String(res.headers.location)).toContain('Control+is+not+allowed+in+the+current+status');
    await app.close();
  });

  it('create_batch does not need to appear in process bar buttons', async () => {
    const mock = createCreateBatchMacroMockDb({ includeInStateButtons: false, includeLayoutButton: true });
    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      this.type('application/json').send(
        JSON.stringify({
          buttonKeys: data.buttonKeys ?? [],
          layoutHtml: String(data.layoutHtml ?? '')
        })
      );
    });
    await app.register(uiRoutes, { db: mock.db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'GET',
      url: '/documents/00000000-0000-0000-0000-0000000000d3'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { buttonKeys: string[]; layoutHtml: string };
    expect(body.buttonKeys).not.toContain('create_batch');
    expect(body.layoutHtml).toContain('/documents/00000000-0000-0000-0000-0000000000d3/action/create_batch');
    await app.close();
  });

  it('returns 400 when macro is disabled in fp_macros catalog', async () => {
    const mock = createCreateBatchMacroMockDb();
    mock.setMacroCatalogRow({ ref: 'macro:erp/createBatch@1', isEnabled: false });
    const app = Fastify();
    await app.register(uiRoutes, { db: mock.db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d3/action/create_batch',
      payload: {}
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Macro not enabled: macro:erp/createBatch@1');

    await app.close();
  });

  it('returns clear catalog error when macro row is missing', async () => {
    const mock = createCreateBatchMacroMockDb();
    mock.setMacroCatalogRow(undefined);
    const app = Fastify();
    await app.register(uiRoutes, { db: mock.db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d3/action/create_batch',
      payload: {}
    });

    expect(res.statusCode).toBe(303);
    expect(String(res.headers.location)).toContain('/documents/00000000-0000-0000-0000-0000000000d3?error=');
    expect(String(res.headers.location)).toContain('Macro+not+found+in+catalog%3A+macro%3Aerp%2FcreateBatch%401');

    await app.close();
  });

  it('enforces created-state field locking while keeping create_batch executable', async () => {
    const mock = createCreatedStateFieldLockingDb();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'batch-3',
          batch_number: 'B-LOCK-OK'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      this.type('text/html').send(String(data.layoutHtml ?? ''));
    });
    await app.register(uiRoutes, { db: mock.db as any, erpBaseUrl: 'http://localhost:3001' });

    const detailRes = await app.inject({
      method: 'GET',
      url: '/documents/00000000-0000-0000-0000-0000000000d4'
    });

    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.body).toContain('id="field-product_id"');
    expect(detailRes.body).not.toContain('id="field-product_id" name="lookup:product_id" disabled');
    expect(detailRes.body).toContain('id="field-title" name="data:title" type="text"');
    expect(detailRes.body).toContain('id="field-title" name="data:title" type="text" value="Batch Doc" disabled');
    expect(detailRes.body).toContain('id="field-due_date" name="data:due_date" type="date" value="2026-03-10" disabled');
    expect(detailRes.body).toContain('id="field-urgent" name="data:urgent" type="checkbox" value="1" checked disabled');
    expect(detailRes.body).toContain('formaction="/documents/00000000-0000-0000-0000-0000000000d4/action/create_batch"');

    const actionRes = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d4/action/create_batch',
      payload: {}
    });

    expect(actionRes.statusCode).toBe(303);
    expect(mock.state().dataJson.batch_number).toBe('B-LOCK-OK');
    vi.unstubAllGlobals();
    await app.close();
  });
});
