import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { uiRoutes } from './ui.js';

describe('lookup api', () => {
  it('returns usable customer options for fieldKey=customer_id and defaults valid=true', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/api/customers');
      expect(url).toContain('valid=true');
      return new Response(
        JSON.stringify([
          { id: 'c-1', name: 'Customer A', valid: true },
          { id: 'c-2', name: 'Customer B', valid: true }
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const db = {
      query: {
        fpTemplates: {
          findFirst: async () => ({
            id: '00000000-0000-0000-0000-0000000000c1',
            key: 'customer-order-test',
            name: 'Customer Order Test',
            templateJson: {
              fields: {
                customer_id: {
                  kind: 'lookup',
                  label: 'Customer',
                  source: {
                    path: '/api/customers',
                    valueKey: 'id',
                    labelKey: 'name'
                  }
                }
              },
              layout: [{ type: 'field', key: 'customer_id' }],
              workflow: {
                initial: 'created',
                states: {
                  created: { editable: ['customer_id'], readonly: [], buttons: [] }
                }
              },
              controls: {},
              actions: {}
            }
          })
        }
      }
    };

    const app = Fastify();
    await app.register(uiRoutes, { db: db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/lookup?templateId=00000000-0000-0000-0000-0000000000c1&fieldKey=customer_id'
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<option value="c-1">Customer A</option>');
    expect(res.body).toContain('<option value="c-2">Customer B</option>');
    expect(res.body).not.toContain('Lookup unavailable');

    vi.unstubAllGlobals();
    await app.close();
  });
});
