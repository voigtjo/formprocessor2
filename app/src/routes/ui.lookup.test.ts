import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { buildV1LookupTemplateJson } from './test-template-fixtures.js';
import { uiRoutes } from './ui.js';

describe('lookup api', () => {
  it('returns usable product options from generic field.source mapping', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/api/products');
      expect(url).toContain('valid=true');
      return new Response(
        JSON.stringify([
          { id: 'p-1', name: 'Product A', valid: true },
          { id: 'p-2', name: 'Product B', valid: true }
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              {
                key: 'products.listValid',
                name: 'List Valid Products',
                description: null,
                state: 'active',
                method: 'GET',
                baseUrl: 'http://localhost:3001',
                path: '/api/products',
                requestSchemaJson: { query: { valid: true } },
                responseSchemaJson: null,
                handlerCode: null
              }
            ]
          })
        })
      }),
      query: {
        fpTemplates: {
          findFirst: async () => ({
            id: '00000000-0000-0000-0000-0000000000a1',
            key: 'product-lookup',
            name: 'Product Lookup',
            templateJson: buildV1LookupTemplateJson('item_ref', 'products.listValid', 'Item')
          })
        }
      }
    };

    const app = Fastify();
    await app.register(uiRoutes, { db: db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/lookup?templateId=00000000-0000-0000-0000-0000000000a1&fieldKey=item_ref'
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<option value="p-1">Product A</option>');
    expect(res.body).toContain('<option value="p-2">Product B</option>');
    vi.unstubAllGlobals();
    await app.close();
  });

  it('returns usable customer options for generic customer lookup source mapping', async () => {
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
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              {
                key: 'customers.listValid',
                name: 'List Valid Customers',
                description: null,
                state: 'active',
                method: 'GET',
                baseUrl: 'http://localhost:3001',
                path: '/api/customers',
                requestSchemaJson: { query: { valid: true } },
                responseSchemaJson: null,
                handlerCode: null
              }
            ]
          })
        })
      }),
      query: {
        fpTemplates: {
          findFirst: async () => ({
            id: '00000000-0000-0000-0000-0000000000c1',
            key: 'customer-order-test',
            name: 'Customer Order Test',
            templateJson: buildV1LookupTemplateJson('buyer_customer_ref', 'customers.listValid', 'Customer')
          })
        }
      }
    };

    const app = Fastify();
    await app.register(uiRoutes, { db: db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/lookup?templateId=00000000-0000-0000-0000-0000000000c1&fieldKey=buyer_customer_ref'
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<option value="c-1">Customer A</option>');
    expect(res.body).toContain('<option value="c-2">Customer B</option>');
    expect(res.body).not.toContain('Lookup unavailable');

    vi.unstubAllGlobals();
    await app.close();
  });
});
