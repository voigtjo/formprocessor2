import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLookupUrl, fetchLookupOptions, normalizeLookupSource } from './lookup.js';

describe('lookup url handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds ERP lookup URL and uses it in fetchLookupOptions', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ items: [{ id: 'p-1', name: 'Product One' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    const source = {
      path: '/api/batches',
      query: {
        status: 'ordered',
        product_id: '{{external.product_id}}'
      }
    };

    const externalRefs = { product_id: '11111111-1111-1111-1111-111111111111' };

    const url = buildLookupUrl('http://localhost:3001', source, externalRefs);
    expect(url).toBe(
      'http://localhost:3001/api/batches?status=ordered&product_id=11111111-1111-1111-1111-111111111111'
    );

    const options = await fetchLookupOptions('http://localhost:3001', source, externalRefs);

    expect(fetchMock).toHaveBeenCalledWith(url, { headers: { Accept: 'application/json' } });
    expect(options).toEqual([{ value: 'p-1', label: 'Product One' }]);
  });

  it('normalizes boolean query and maps id/name fields', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ items: [{ id: 'p-2', name: 'Product Two' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    const source = normalizeLookupSource({
      source: {
        path: '/api/products',
        query: { valid: true }
      }
    });

    const url = buildLookupUrl('http://localhost:3001', source, {});
    expect(url).toContain('/api/products?valid=true');

    const options = await fetchLookupOptions('http://localhost:3001', source, {}, 'id', 'name');
    expect(options).toEqual([{ value: 'p-2', label: 'Product Two' }]);
  });
});
