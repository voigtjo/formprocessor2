import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { uiRoutes } from './ui.js';

describe('workflow detail visibility', () => {
  it('renders hook operations for workflow detail', async () => {
    const workflowId = '98eba946-2a10-4dbf-b1f1-962615ccd58d';
    const db = {
      query: {
        fpWorkflows: {
          findFirst: vi.fn(async () => ({
            id: workflowId,
            key: 'customer-order.group-submit.v1',
            name: 'Customer Order Group Submit',
            description: 'Reference workflow',
            state: 'active',
            version: 1,
            workflowJson: {
              order: ['created', 'assigned', 'submitted', 'approved', 'archived'],
              initialStatus: 'created',
              states: {
                created: { buttons: ['assign'] },
                assigned: { buttons: ['submit'] },
                submitted: { buttons: ['approve'] },
                approved: { buttons: ['archive'] }
              },
              hooks: {
                onTransition: [
                  {
                    from: 'submitted',
                    to: 'approved',
                    effects: [
                      {
                        operationRef: 'customerOrders.setStatusFromContext',
                        apiRef: 'customerOrders.setStatus',
                        responseMapping: {
                          integration: {
                            syncStatus: 'completed'
                          }
                        }
                      }
                    ]
                  }
                ]
              }
            }
          }))
        }
      },
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            orderBy: async () => []
          })
        })
      }))
    };

    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      this.type('application/json').send(data);
    });

    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001'
    });

    const res = await app.inject({
      method: 'GET',
      url: `/workflows/${workflowId}`
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json() as {
      hookOperations: Array<{
        operationRef: string;
        apiRef: string | null;
        operation: { authType: string; modulePath: string } | null;
        responseTargets: string[];
      }>;
    };
    expect(payload.hookOperations).toHaveLength(1);
    expect(payload.hookOperations[0]?.operationRef).toBe('customerOrders.setStatusFromContext');
    expect(payload.hookOperations[0]?.apiRef).toBe('customerOrders.setStatus');
    expect(payload.hookOperations[0]?.operation?.authType).toBe('none');
    expect(payload.hookOperations[0]?.operation?.modulePath).toContain('erp-sim/customer-orders.ts');
    expect(payload.hookOperations[0]?.responseTargets).toContain('integration');

    await app.close();
  });
});
