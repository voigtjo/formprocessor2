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
});
