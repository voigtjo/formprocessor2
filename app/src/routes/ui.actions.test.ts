import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { uiRoutes } from './ui.js';
import { macroRegistryByRef } from '../actions/macros/index.js';

function createMacroCatalogSelect(getRow: () => { ref: string; isEnabled: boolean } | undefined) {
  return () => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          const row = getRow();
          return row ? [row] : [];
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

function createCreateBatchMacroMockDb(options?: { includeInStateButtons?: boolean; includeLayoutButton?: boolean }) {
  const includeInStateButtons = options?.includeInStateButtons ?? true;
  const includeLayoutButton = options?.includeLayoutButton ?? false;
  let currentStatus = 'Created';
  let currentDataJson: Record<string, unknown> = {};
  let currentExternalRefsJson: Record<string, unknown> = {
    product_id: '00000000-0000-0000-0000-000000000001'
  };
  let currentSnapshotsJson: Record<string, unknown> = {};
  let macroCatalogRow: { ref: string; isEnabled: boolean } | undefined = {
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
    setMacroCatalogRow: (row: { ref: string; isEnabled: boolean } | undefined) => {
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
