import { describe, expect, it, vi } from 'vitest';
import { buildIntegrationUrl, executeIntegrationRequest } from './integration-client.js';

describe('integration client', () => {
  it('builds integration urls with optional query params', () => {
    const url = buildIntegrationUrl('http://localhost:3001', '/api/products', {
      valid: 'true',
      empty: ''
    });
    expect(url.toString()).toBe('http://localhost:3001/api/products?valid=true');
  });

  it('executes a json integration request through one shared helper', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );

    const result = await executeIntegrationRequest(
      {
        baseUrl: 'http://localhost:3001',
        path: '/api/customer-orders',
        method: 'POST',
        jsonBody: { customer_id: 'cust-1' }
      },
      fetchImpl as unknown as typeof fetch
    );

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.bodyJson).toEqual({ ok: true });
  });
});
