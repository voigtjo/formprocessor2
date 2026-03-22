import { describe, expect, it, vi } from 'vitest';
import { executeConnectorOperation, listConnectorOperations, resolveConnectorOperation } from './registry.js';

describe('ts connector registry', () => {
  it('resolves seeded ERP connector operations by apiRef', () => {
    expect(resolveConnectorOperation('products.listValid')?.connector.key).toBe('erp-sim');
    expect(resolveConnectorOperation('customerOrders.create')?.metadata.method).toBe('POST');
    expect(resolveConnectorOperation('customerOrders.setStatus')?.metadata.method).toBe('PATCH');
    expect(resolveConnectorOperation('customerOrders.setStatusFromContext')?.metadata.method).toBe('PATCH');
  });

  it('executes lookup connector against ERP simulation contract', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([{ id: 'c-1', name: 'Acme', valid: true }]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );

    const result = await executeConnectorOperation({
      ref: 'customers.listValid',
      input: { valid: true },
      runtime: {
        defaultErpBaseUrl: 'http://localhost:3001',
        fetchImpl: fetchMock as unknown as typeof fetch
      }
    });

    expect(result.output).toEqual([{ id: 'c-1', name: 'Acme', valid: true }]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://localhost:3001/api/customers?valid=true');
  });

  it('executes auth-configured connector with bearer token header', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([{ id: '001', name: 'Acme Account' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );

    await executeConnectorOperation({
      ref: 'salesforce.accounts.listRecent',
      input: { limit: 5 },
      runtime: {
        defaultErpBaseUrl: 'http://localhost:3001',
        fetchImpl: fetchMock as unknown as typeof fetch,
        env: {
          SALESFORCE_SANDBOX_BASE_URL: 'https://example.salesforce.test'
        },
        credentials: {
          salesforceSandbox: {
            type: 'bearerToken',
            token: 'sf-token'
          }
        }
      }
    });

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://example.salesforce.test/services/data/v1/accounts?limit=5');
    expect(requestInit?.headers).toMatchObject({ Authorization: 'Bearer sf-token' });
  });

  it('advances customer order status stepwise to the ERP target state', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/customer-orders/order-1')) {
        return new Response(
          JSON.stringify({ id: 'order-1', order_number: 'O-123', customer_id: 'cust-1', status: 'received' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });

    const result = await executeConnectorOperation({
      ref: 'customerOrders.setStatus',
      input: { id: 'order-1', status: 'approved' },
      runtime: {
        defaultErpBaseUrl: 'http://localhost:3001',
        fetchImpl: fetchMock as unknown as typeof fetch
      }
    });

    expect(result.output).toEqual({ ok: true });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://localhost:3001/api/customer-orders/order-1');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.method).toBe('PATCH');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body).toBe(JSON.stringify({ status: 'offer_created' }));
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit | undefined)?.body).toBe(JSON.stringify({ status: 'completed' }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('uses persisted integration context when operationRef resolves follow-up status sync', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/customer-orders/order-ctx')) {
        return new Response(
          JSON.stringify({ id: 'order-ctx', order_number: 'O-CTX', customer_id: 'cust-1', status: 'received' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });

    const result = await executeConnectorOperation({
      ref: 'customerOrders.setStatusFromContext',
      input: { status: 'approved' },
      runtime: {
        defaultErpBaseUrl: 'http://localhost:3001',
        fetchImpl: fetchMock as unknown as typeof fetch,
        context: {
          document: { id: 'doc-ctx', status: 'approved' },
          data: {},
          external: {},
          snapshot: {},
          integration: {
            customerOrder: {
              lastCreated: {
                id: 'order-ctx'
              }
            }
          }
        }
      }
    });

    expect(result.output).toEqual({ ok: true });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://localhost:3001/api/customer-orders/order-ctx');
  });

  it('lists connector operations for seed mirroring', () => {
    expect(listConnectorOperations().map((item) => item.ref)).toEqual(
      expect.arrayContaining([
        'products.listValid',
        'customers.listValid',
        'batches.create',
        'customerOrders.create',
        'customerOrders.setStatus',
        'customerOrders.setStatusFromContext',
        'salesforce.accounts.listRecent'
      ])
    );
  });
});
