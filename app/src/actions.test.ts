import { describe, expect, it, vi } from 'vitest';
import { executeActionDefinition, interpolateString } from './actions/index.js';

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

  it('setStatus updates status output and does not create data.status', async () => {
    const result = await executeActionDefinition({
      actionDef: {
        type: 'composite',
        steps: [{ type: 'setStatus', to: 'Approved' }]
      },
      context: {
        doc: { id: 'doc-8', status: 'Submitted' },
        data: {},
        external: {},
        snapshot: {}
      },
      erpBaseUrl: 'http://localhost:3001'
    });

    expect(result.status).toBe('Approved');
    expect(result.dataJson.status).toBeUndefined();
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

  it('macro ensureErpCustomerOrder creates external ref and snapshot when missing', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'co-11', order_number: 'O-11ABC' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );

    const result = await executeActionDefinition({
      actionDef: {
        type: 'composite',
        steps: [{ type: 'macro', name: 'ensureErpCustomerOrder' }]
      },
      context: {
        doc: { id: 'doc-4', status: 'received' },
        data: {},
        external: { customer_id: '11111111-1111-1111-1111-111111111111' },
        snapshot: {}
      },
      erpBaseUrl: 'http://localhost:3001',
      fetchImpl: fetchMock as unknown as typeof fetch,
      macroContext: {
        db: {},
        templateJson: {},
        document: { id: 'doc-4', status: 'received' }
      }
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.externalRefsJson.customer_order_id).toBe('co-11');
    expect(result.snapshotsJson.customer_order_id).toBe('O-11ABC');
    expect(result.dataJson.erp_customer_order_id).toBe('O-11ABC');
    expect(result.dataJson.erp_customer_order_ref).toBe('co-11');
  });

  it('returns a friendly error for unknown macro name', async () => {
    await expect(
      executeActionDefinition({
        actionDef: { type: 'macro', name: 'doesNotExist' },
        context: {
          doc: { id: 'doc-5', status: 'received' },
          data: {},
          external: {},
          snapshot: {}
        },
        erpBaseUrl: 'http://localhost:3001',
        macroContext: {
          db: {},
          templateJson: {},
          document: { id: 'doc-5', status: 'received' }
        }
      })
    ).rejects.toThrow('Unknown macro: doesNotExist');
  });

  it('normalizes customer-order transition for submit flow to avoid ERP 409', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );

    const result = await executeActionDefinition({
      actionDef: {
        type: 'composite',
        steps: [
          { type: 'setStatus', to: 'Submitted' },
          {
            type: 'callExternal',
            service: 'erp-sim',
            method: 'PATCH',
            path: '/api/customer-orders/{{external.customer_order_id}}/status',
            body: { status: '{{doc.status}}' }
          }
        ]
      },
      context: {
        doc: { id: 'doc-6', status: 'Started' },
        data: {},
        external: { customer_order_id: 'co-22' },
        snapshot: {}
      },
      erpBaseUrl: 'http://localhost:3001',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    const requestInit = (fetchMock as any).mock.calls[0]?.[1] as RequestInit | undefined;
    const sentBody = JSON.parse(String(requestInit?.body ?? '{}')) as { status: string };

    expect(sentBody.status).toBe('offer_created');
    expect(result.status).toBe('Submitted');
  });

  it('aborts action on callExternal failure and keeps original context status unchanged', async () => {
    const fetchMock = vi.fn(async () => new Response('Invalid transition', { status: 409 }));
    const context = {
      doc: { id: 'doc-7', status: 'Started' },
      data: { note: 'before' },
      external: { customer_order_id: 'co-33' },
      snapshot: {}
    };

    await expect(
      executeActionDefinition({
        actionDef: {
          type: 'composite',
          steps: [
            { type: 'setStatus', to: 'Approved' },
            {
              type: 'callExternal',
              service: 'erp-sim',
              method: 'PATCH',
              path: '/api/customer-orders/{{external.customer_order_id}}/status',
              body: { status: '{{doc.status}}' }
            }
          ]
        },
        context,
        erpBaseUrl: 'http://localhost:3001',
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).rejects.toThrow('External call failed (409)');

    expect(context.doc.status).toBe('Started');
    expect(context.data.note).toBe('before');
  });
});
