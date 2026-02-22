import Fastify from 'fastify';
import request from 'supertest';
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
    const res = await request(app.server).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
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

    const res = await request(app.server).get('/api/products').query({ valid: 'true' });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      { id: 'p-3', name: 'Bravo', valid: true, product_type: 'serial' },
      { id: 'p-2', name: 'Zeta', valid: true, product_type: 'batch' }
    ]);

    await app.close();
  });

  it('GET /api/batches gating rejects invalid product_id format', async () => {
    const app = await createApp(createRepo());
    const res = await request(app.server).get('/api/batches').query({ product_id: 'not-a-uuid', status: 'ordered' });

    expect(res.status).toBe(400);
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

    const wrongType = await request(app.server)
      .get('/api/batches')
      .query({ product_id: '00000000-0000-0000-0000-000000000001', status: 'ordered' });

    const invalidProduct = await request(app.server)
      .get('/api/batches')
      .query({ product_id: '00000000-0000-0000-0000-000000000002', status: 'ordered' });

    expect(wrongType.status).toBe(200);
    expect(wrongType.body).toEqual({ items: [] });

    expect(invalidProduct.status).toBe(200);
    expect(invalidProduct.body).toEqual({ items: [] });

    await app.close();
  });
});
