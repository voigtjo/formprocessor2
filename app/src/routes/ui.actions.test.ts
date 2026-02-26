import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { uiRoutes } from './ui.js';

function createMockDb() {
  let currentStatus = 'Assigned';

  const document = {
    id: '00000000-0000-0000-0000-0000000000d1',
    templateId: '00000000-0000-0000-0000-0000000000t1',
    status: currentStatus,
    dataJson: {},
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
});
