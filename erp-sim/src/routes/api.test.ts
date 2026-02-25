import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { apiRoutes, type ApiRepo } from './api.js';
import { healthRoutes } from './health.js';

function createRepo(overrides: Partial<ApiRepo> = {}): ApiRepo {
  const repo: ApiRepo = {
    listProducts: async () => [],
    listCustomers: async () => [],
    getProductById: async () => undefined,
    getCustomerById: async () => undefined,
    listBatches: async () => [],
    listSerialInstances: async () => [],
    listCustomerOrders: async () => [],
    setProductValid: async () => false,
    setCustomerValid: async () => false,
    getBatchById: async () => undefined,
    setBatchStatus: async () => {},
    getSerialInstanceById: async () => undefined,
    setSerialInstanceStatus: async () => {},
    getCustomerOrderById: async () => undefined,
    setCustomerOrderStatus: async () => {},
    createCustomerOrder: async (customerId) => ({
      id: 'co-1',
      customerId,
      orderNumber: 'O-TEST01',
      status: 'received',
      createdAt: new Date()
    }),
    randomize: async () => ({
      products: 0,
      customers: 0,
      batches: 0,
      serial_instances: 0,
      customer_orders: 0
    }),
    ...overrides
  };

  return repo;
}

async function createApp(repo: ApiRepo) {
  const app = Fastify();
  await app.register(healthRoutes);
  await app.register(apiRoutes, { repo });
  return app;
}

describe('ERP API', () => {
  it('GET /health returns ok', async () => {
    const app = await createApp(createRepo());
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it('GET /api/products?valid=true returns only valid and sorted', async () => {
    const app = await createApp(
      createRepo({
        listProducts: async (valid) => {
          const items = [
            { id: 'p-2', name: 'Zeta', valid: true, productType: 'batch' as const },
            { id: 'p-3', name: 'Bravo', valid: true, productType: 'serial' as const },
            { id: 'p-1', name: 'Alpha', valid: false, productType: 'batch' as const }
          ];

          const filtered = valid === undefined ? items : items.filter((item) => item.valid === valid);
          return filtered.sort((a, b) => a.name.localeCompare(b.name));
        }
      })
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/products',
      query: { valid: 'true' }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([
      { id: 'p-3', name: 'Bravo', valid: true, product_type: 'serial' },
      { id: 'p-2', name: 'Zeta', valid: true, product_type: 'batch' }
    ]);

    await app.close();
  });

  it('GET /api/batches gating rejects invalid product_id format', async () => {
    const app = await createApp(createRepo());
    const res = await app.inject({
      method: 'GET',
      url: '/api/batches',
      query: { product_id: 'not-a-uuid', status: 'ordered' }
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('GET /api/batches gating rejects wrong type and invalid products', async () => {
    const app = await createApp(
      createRepo({
        getProductById: async (id) => {
          if (id === '00000000-0000-0000-0000-000000000001') {
            return { id, name: 'Serial Product', valid: true, productType: 'serial' as const };
          }
          if (id === '00000000-0000-0000-0000-000000000002') {
            return { id, name: 'Invalid Batch', valid: false, productType: 'batch' as const };
          }
          return undefined;
        }
      })
    );

    const wrongType = await app.inject({
      method: 'GET',
      url: '/api/batches',
      query: { product_id: '00000000-0000-0000-0000-000000000001', status: 'ordered' }
    });

    const invalidProduct = await app.inject({
      method: 'GET',
      url: '/api/batches',
      query: { product_id: '00000000-0000-0000-0000-000000000002', status: 'ordered' }
    });

    expect(wrongType.statusCode).toBe(200);
    expect(wrongType.json()).toEqual({ items: [] });

    expect(invalidProduct.statusCode).toBe(200);
    expect(invalidProduct.json()).toEqual({ items: [] });

    await app.close();
  });

  it('POST /api/customer-orders creates a received order and returns it', async () => {
    const customerId = '00000000-0000-0000-0000-000000000010';
    const createdAt = new Date('2026-01-01T00:00:00.000Z');

    const app = await createApp(
      createRepo({
        getCustomerById: async (id) => (id === customerId ? { id, name: 'Acme', valid: true } : undefined),
        createCustomerOrder: async (id) => ({
          id: '00000000-0000-0000-0000-000000000020',
          customerId: id,
          orderNumber: 'O-ABC123',
          status: 'received',
          createdAt
        })
      })
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/customer-orders',
      payload: { customer_id: customerId }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: '00000000-0000-0000-0000-000000000020',
      customer_id: customerId,
      order_number: 'O-ABC123',
      status: 'received',
      created_at: createdAt.toISOString()
    });

    await app.close();
  });

  it('GET /api/customer-orders/:id returns the row or 404', async () => {
    const existingId = '00000000-0000-0000-0000-000000000030';
    const createdAt = new Date('2026-01-02T00:00:00.000Z');
    const app = await createApp(
      createRepo({
        getCustomerOrderById: async (id) => {
          if (id !== existingId) return undefined;
          return {
            id,
            customerId: '00000000-0000-0000-0000-000000000040',
            orderNumber: 'O-DEF456',
            status: 'offer_created',
            createdAt
          };
        }
      })
    );

    const ok = await app.inject({
      method: 'GET',
      url: `/api/customer-orders/${existingId}`
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({
      id: existingId,
      customer_id: '00000000-0000-0000-0000-000000000040',
      order_number: 'O-DEF456',
      status: 'offer_created',
      created_at: createdAt.toISOString()
    });

    const missing = await app.inject({
      method: 'GET',
      url: '/api/customer-orders/00000000-0000-0000-0000-000000000099'
    });
    expect(missing.statusCode).toBe(404);

    await app.close();
  });
});
