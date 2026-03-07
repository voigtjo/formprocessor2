import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { uiRoutes } from './ui.js';

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

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('UI button cannot execute process action');
    expect(mock.getStatus()).toBe('Assigned');

    await app.close();
  });

  it('allows reloadLookup macro from layout button source', async () => {
    const mock = createLayoutButtonMockDb({ type: 'macro', name: 'reloadLookup' });
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
});
