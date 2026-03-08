import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { uiRoutes } from './ui.js';

describe('ERP browser filters', () => {
  it('does not call /api/batches when product_id is missing', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes('/api/products')) {
        return new Response(JSON.stringify([{ id: 'p-1', name: 'Product 1' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      this.type('text/plain').send(
        JSON.stringify({
          hintMessage: String(data.hintMessage ?? ''),
          totalCount: Number(data.totalCount ?? 0)
        })
      );
    });
    await app.register(uiRoutes, {
      db: {} as any,
      erpBaseUrl: 'http://localhost:3001'
    });

    const res = await app.inject({
      method: 'GET',
      url: '/erp?tab=batches'
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Select a product to view batches');
    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requestedUrls.some((url) => url.includes('/api/products'))).toBe(true);
    expect(requestedUrls.some((url) => url.includes('/api/batches'))).toBe(false);

    vi.unstubAllGlobals();
    await app.close();
  });

  it('creates batch from ERP products page and shows returned batch number', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/batches') && (init?.method ?? 'GET').toUpperCase() === 'POST') {
        return new Response(
          JSON.stringify({
            id: 'b-1',
            product_id: '00000000-0000-0000-0000-000000000001',
            batch_number: 'B-00000000-ABC',
            status: 'ordered',
            created_at: new Date().toISOString()
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      this.type('text/plain').send(String(data.erpMessage ?? ''));
    });
    await app.register(uiRoutes, {
      db: {} as any,
      erpBaseUrl: 'http://localhost:3001'
    });

    const postRes = await app.inject({
      method: 'POST',
      url: '/erp/products/00000000-0000-0000-0000-000000000001/create-batch'
    });
    expect(postRes.statusCode).toBe(303);
    expect(postRes.headers.location).toContain('/erp?tab=products');
    expect(postRes.headers.location).toContain('Created+batch%3A+B-00000000-ABC');

    const getRes = await app.inject({
      method: 'GET',
      url: String(postRes.headers.location)
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.body).toContain('Created batch: B-00000000-ABC');

    const postCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/batches'));
    expect(postCalls.length).toBe(1);
    expect((postCalls[0]?.[1] as RequestInit | undefined)?.method).toBe('POST');

    vi.unstubAllGlobals();
    await app.close();
  });
});
