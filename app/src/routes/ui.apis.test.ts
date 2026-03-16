import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { fpApis } from '../db/schema.js';
import { uiRoutes } from './ui.js';

type ApiRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  state: 'active' | 'inactive';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  baseUrl: string | null;
  path: string;
  requestSchemaJson: Record<string, unknown> | null;
  responseSchemaJson: Record<string, unknown> | null;
  handlerCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function createMockDb(initialApis: ApiRow[] = []) {
  const apis = [...initialApis];

  return {
    query: {
      fpApis: {
        findFirst: vi.fn(async (args?: { where?: unknown }) => {
          const id = String((args?.where as any)?.right?.value ?? '');
          return apis.find((item) => item.id === id) ?? null;
        })
      }
    },
    select: vi.fn(() => ({
      from: (table: unknown) => {
        if (table === fpApis) {
          return {
            where: () => ({
              orderBy: async () => [...apis].sort((a, b) => a.key.localeCompare(b.key))
            })
          };
        }
        return {
          orderBy: async () => []
        };
      }
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: any) => {
        if (table !== fpApis) {
          return { returning: async () => [] };
        }
        const created: ApiRow = {
          id: '00000000-0000-0000-0000-0000000000a9',
          key: values.key,
          name: values.name,
          description: values.description ?? null,
          state: values.state ?? 'active',
          method: values.method,
          baseUrl: values.baseUrl,
          path: values.path,
          requestSchemaJson: values.requestSchemaJson ?? null,
          responseSchemaJson: values.responseSchemaJson ?? null,
          handlerCode: values.handlerCode ?? null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        apis.push(created);
        return { returning: async () => [{ id: created.id }] };
      })
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: any) => ({
        where: vi.fn(async () => {
          const existing = apis.find((item) => item.id === values.id);
          if (existing) Object.assign(existing, values);
        })
      }))
    }))
  };
}

describe('apis routes', () => {
  it('renders APIs list', async () => {
    const db = createMockDb([
      {
        id: '00000000-0000-0000-0000-0000000000a1',
        key: 'customers.listValid',
        name: 'List Customers',
        description: null,
        state: 'active',
        method: 'GET',
        baseUrl: 'http://localhost:3001',
        path: '/api/customers',
        requestSchemaJson: { query: { valid: true } },
        responseSchemaJson: null,
        handlerCode: null,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      this.type('application/json').send(data);
    });
    await app.register(uiRoutes, { db: db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({ method: 'GET', url: '/apis' });
    expect(res.statusCode).toBe(200);
    const payload = res.json() as { apis: Array<{ key: string }> };
    expect(payload.apis).toHaveLength(1);
    expect(payload.apis[0]?.key).toBe('customers.listValid');
    await app.close();
  });

  it('creates a new API', async () => {
    const db = createMockDb();
    const app = Fastify();
    await app.register(uiRoutes, { db: db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'POST',
      url: '/apis',
      payload: {
        key: 'customerOrders.create',
        name: 'Create Customer Order',
        state: 'active',
        method: 'POST',
        base_url: 'http://localhost:3001',
        path: '/api/customer-orders',
        request_schema_json: '{"body":{"customer_id":"uuid"}}',
        response_schema_json: '',
        handler_code: ''
      }
    });

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/apis/00000000-0000-0000-0000-0000000000a9');
    await app.close();
  });

  it('returns validation error on invalid JSON fields', async () => {
    const db = createMockDb();
    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      this.type('application/json').send(data);
    });
    await app.register(uiRoutes, { db: db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'POST',
      url: '/apis',
      payload: {
        key: 'customers.listValid',
        name: 'List Customers',
        state: 'active',
        method: 'GET',
        base_url: 'http://localhost:3001',
        path: '/api/customers',
        request_schema_json: '{not-json}'
      }
    });

    expect(res.statusCode).toBe(400);
    const payload = res.json() as { errorMessage: string };
    expect(payload.errorMessage).toContain('request_schema_json must be valid JSON');
    await app.close();
  });
});
