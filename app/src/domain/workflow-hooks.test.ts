import { describe, expect, it, vi } from 'vitest';
import { executeWorkflowHookEffects } from './workflow-hooks.js';
import { normalizeWorkflowRuntimeModel } from './workflow-runtime.js';

describe('workflow hooks', () => {
  it('executes matching transition hooks and applies response mapping', async () => {
    const workflow = normalizeWorkflowRuntimeModel({
      hooks: {
        onTransition: [
          {
            from: 'submitted',
            to: 'approved',
            effects: [
              {
                operationRef: 'customerOrders.setStatusFromContext',
                apiRef: 'customerOrders.setStatus',
                request: {
                  status: 'approved'
                },
                responseMapping: {
                  snapshot: {
                    customer_order_sync: 'ok'
                  }
                }
              }
            ]
          }
        ]
      }
    });

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/customer-orders/order-1') && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ id: 'order-1', order_number: 'O-123', status: 'received' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }) as typeof fetch;

    const result = await executeWorkflowHookEffects({
      workflow,
      trigger: {
        type: 'transition',
        fromStatus: 'submitted',
        toStatus: 'approved'
      },
      context: {
        doc: { id: 'doc-1', status: 'approved' },
        data: {},
        external: { customer_order_id: 'order-1' },
        snapshot: {},
        integration: {},
        vars: {}
      },
      erpBaseUrl: 'http://localhost:3001',
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.snapshotsJson.customer_order_sync).toBe(true);
    expect(result.logs).toEqual([
      expect.objectContaining({
        trigger: 'transition',
        operationRef: 'customerOrders.setStatusFromContext',
        success: true
      })
    ]);
  });

  it('records hook failures without throwing for the workflow runtime', async () => {
    const workflow = normalizeWorkflowRuntimeModel({
      hooks: {
        onTransition: [
          {
            from: 'submitted',
            to: 'approved',
            effects: [
              {
                operationRef: 'customerOrders.setStatusFromContext',
                apiRef: 'customerOrders.setStatus',
                request: {
                  status: 'approved'
                }
              }
            ]
          }
        ]
      }
    });

    const result = await executeWorkflowHookEffects({
      workflow,
      trigger: {
        type: 'transition',
        fromStatus: 'submitted',
        toStatus: 'approved'
      },
      context: {
        doc: { id: 'doc-1', status: 'approved' },
        data: {},
        external: {},
        snapshot: {},
        integration: {},
        vars: {}
      },
      erpBaseUrl: 'http://localhost:3001'
    });

    expect(result.logs).toEqual([
      expect.objectContaining({
        trigger: 'transition',
        operationRef: 'customerOrders.setStatusFromContext',
        success: false
      })
    ]);
  });

  it('reads persisted integration context when syncing status', async () => {
    const workflow = normalizeWorkflowRuntimeModel({
      hooks: {
        onTransition: [
          {
            from: 'submitted',
            to: 'approved',
            effects: [
              {
                operationRef: 'customerOrders.setStatusFromContext',
                request: { status: 'approved' }
              }
            ]
          }
        ]
      }
    });

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/customer-orders/order-from-context') && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ id: 'order-from-context', order_number: 'O-CTX', status: 'received' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }) as typeof fetch;

    const result = await executeWorkflowHookEffects({
      workflow,
      trigger: {
        type: 'transition',
        fromStatus: 'submitted',
        toStatus: 'approved'
      },
      context: {
        doc: { id: 'doc-ctx', status: 'approved' },
        data: {},
        external: {},
        snapshot: {},
        integration: {
          customerOrder: {
            lastCreated: {
              id: 'order-from-context'
            }
          }
        },
        vars: {}
      },
      erpBaseUrl: 'http://localhost:3001',
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/api/customer-orders/order-from-context');
    expect(result.integrationContextJson.customerOrder).toMatchObject({
      lastSync: {
        id: 'order-from-context',
        requestedStatus: 'approved',
        appliedStatus: 'completed'
      }
    });
  });
});
