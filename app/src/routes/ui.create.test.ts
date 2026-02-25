import { describe, expect, it, vi } from 'vitest';
import { ensureErpCustomerOrderReference } from './ui.js';

describe('document creation ERP enrichment', () => {
  it('sets external.customer_order_id when customer is selected', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'co-1', order_number: 'O-ABC123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );

    const externalRefs: Record<string, string> = { customer_id: '11111111-1111-1111-1111-111111111111' };
    const snapshots: Record<string, string> = {};
    const data: Record<string, string> = {};

    await ensureErpCustomerOrderReference({
      templateJson: {
        fields: {
          erp_customer_order_id: { kind: 'system', label: 'ERP Order' }
        },
        layout: [],
        workflow: { initial: 'received' }
      },
      externalRefs,
      snapshots,
      data,
      erpBaseUrl: 'http://localhost:3001',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/customer-orders', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ customer_id: '11111111-1111-1111-1111-111111111111' })
    });

    expect(externalRefs.customer_order_id).toBe('co-1');
    expect(snapshots.customer_order_id).toBe('O-ABC123');
    expect(data.erp_customer_order_id).toBe('O-ABC123');
  });

  it('also sets external.customer_order_id when actions reference external.customer_order_id', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'co-2', order_number: 'O-XYZ789' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );

    const externalRefs: Record<string, string> = {};
    const snapshots: Record<string, string> = {};
    const data: Record<string, string> = {};

    await ensureErpCustomerOrderReference({
      templateJson: {
        fields: {},
        layout: [],
        workflow: { initial: 'received' },
        actions: {
          complete: {
            type: 'composite',
            steps: [
              {
                type: 'callExternal',
                service: 'erp-sim',
                method: 'PATCH',
                path: '/api/customer-orders/{{external.customer_order_id}}/status',
                body: { status: 'completed' }
              }
            ]
          }
        }
      },
      externalRefs,
      snapshots,
      data,
      erpBaseUrl: 'http://localhost:3001',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(externalRefs.customer_order_id).toBe('co-2');
    expect(snapshots.customer_order_id).toBe('O-XYZ789');
    expect(data.erp_customer_order_id).toBe('O-XYZ789');
  });
});
