import { describe, expect, it, vi } from 'vitest';
import { executeActionDefinition, interpolateString } from './actions.js';

describe('action engine', () => {
  it('interpolates supported tokens', () => {
    const result = interpolateString(
      '/api/customer-orders/{{external.customer_order_id}}/status?doc={{doc.id}}&s={{doc.status}}&n={{data.note}}&snap={{snapshot.customer_name}}',
      {
        doc: { id: 'doc-1', status: 'draft' },
        data: { note: 'hello' },
        external: { customer_order_id: 'co-9' },
        snapshot: { customer_name: 'Acme' }
      }
    );

    expect(result).toBe('/api/customer-orders/co-9/status?doc=doc-1&s=draft&n=hello&snap=Acme');
  });

  it('executes setStatus and setField steps sequentially', async () => {
    const result = await executeActionDefinition({
      actionDef: {
        type: 'composite',
        steps: [
          { type: 'setField', key: 'note', value: 'updated {{doc.status}}' },
          { type: 'setStatus', to: 'offer_created' },
          { type: 'setField', key: 'status_note', value: 'now {{doc.status}}' }
        ]
      },
      context: {
        doc: { id: 'doc-2', status: 'received' },
        data: {},
        external: {},
        snapshot: {}
      },
      erpBaseUrl: 'http://localhost:3001'
    });

    expect(result.status).toBe('offer_created');
    expect(result.dataJson).toEqual({
      note: 'updated received',
      status_note: 'now offer_created'
    });
  });

  it('throws a clear error when required external interpolation value is missing', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await expect(
      executeActionDefinition({
        actionDef: {
          type: 'composite',
          steps: [
            {
              type: 'callExternal',
              service: 'erp-sim',
              method: 'PATCH',
              path: '/api/customer-orders/{{external.customer_order_id}}/status',
              body: { status: 'offer_created' }
            }
          ]
        },
        context: {
          doc: { id: 'doc-3', status: 'received' },
          data: {},
          external: {},
          snapshot: {}
        },
        erpBaseUrl: 'http://localhost:3001',
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).rejects.toThrow('Missing interpolation value for external.customer_order_id');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
