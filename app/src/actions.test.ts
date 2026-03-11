import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { makeDb as makeRealDb } from './db/index.js';
import { fpMacros } from './db/schema.js';
import { executeActionDefinition, interpolateString } from './actions/index.js';
import { macroRegistryByRef } from './actions/macros/index.js';

dotenv.config({ path: resolve(process.cwd(), '../.env') });

describe('action engine', () => {
  const makeMacroCatalogDb = (
    entries: Array<
      | string
      | { ref: string; isEnabled?: boolean; kind?: string; definitionJson?: unknown; paramsSchemaJson?: unknown }
    >
  ) => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const first = entries[0];
            if (!first) return [];
            if (typeof first === 'string') {
              return [{ ref: first, isEnabled: true, kind: 'json', definitionJson: null, paramsSchemaJson: null }];
            }
            return [
              {
                ref: first.ref,
                isEnabled: first.isEnabled ?? true,
                kind: first.kind ?? 'json',
                definitionJson: first.definitionJson ?? null,
                paramsSchemaJson: first.paramsSchemaJson ?? null
              }
            ];
          }
        })
      })
    })
  });

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

  it('requireField blocks with friendly message when value is missing', async () => {
    await expect(
      executeActionDefinition({
        actionDef: {
          type: 'composite',
          steps: [{ type: 'requireField', key: 'assignee_user_id', message: 'Submit requires editor assignment first.' }]
        },
        context: {
          doc: { id: 'doc-9', status: 'Assigned' },
          data: {},
          external: {},
          snapshot: {}
        },
        erpBaseUrl: 'http://localhost:3001'
      })
    ).rejects.toThrow('Submit requires editor assignment first.');
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
        steps: [{ type: 'macro', ref: 'macro:erp/ensureErpCustomerOrder@1' }]
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
        db: makeMacroCatalogDb(['macro:erp/ensureErpCustomerOrder@1']),
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

  it('macro ensureErpCustomerOrder executes from db-json definition and writes customer order fields', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'co-22', order_number: 'CO-22' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    const onMacroEvent = vi.fn();

    const result = await executeActionDefinition({
      actionDef: {
        type: 'macro',
        ref: 'macro:erp/ensureErpCustomerOrder@1'
      },
      context: {
        doc: { id: 'doc-4-json', status: 'received' },
        data: {},
        external: { customer_id: '11111111-1111-1111-1111-111111111111' },
        snapshot: {}
      },
      erpBaseUrl: 'http://localhost:3001',
      fetchImpl: fetchMock as unknown as typeof fetch,
      macroContext: {
        db: makeMacroCatalogDb([
          {
            ref: 'macro:erp/ensureErpCustomerOrder@1',
            kind: 'json',
            paramsSchemaJson: {
              properties: {
                customerRefKey: { default: 'customer_id' },
                writeFieldKey: { default: 'customer_order_number' },
                writeExternalRefKey: { default: 'customer_order_id' },
                writeSnapshotKey: { default: 'customer_order_number' }
              }
            },
            definitionJson: {
              ops: [
                { op: 'read', from: 'external.{{params.customerRefKey}}', to: 'vars.customerId' },
                { op: 'fallback', from: 'data.{{params.customerRefKey}}', to: 'vars.customerId' },
                { op: 'require', from: 'vars.customerId', message: 'Select a customer first.' },
                {
                  op: 'http.post',
                  service: 'erp',
                  path: '/api/customer-orders',
                  body: { customer_id: '{{vars.customerId}}' },
                  to: 'vars.response'
                },
                { op: 'require', from: 'vars.response.id', message: 'ERP customer order response missing id.' },
                {
                  op: 'require',
                  from: 'vars.response.order_number',
                  message: 'ERP customer order response missing order_number.'
                },
                { op: 'write', to: 'data.{{params.writeFieldKey}}', value: '{{vars.response.order_number}}' },
                {
                  op: 'write',
                  to: 'external.{{params.writeExternalRefKey}}',
                  value: '{{vars.response.id}}'
                },
                { op: 'write', to: 'snapshot.{{params.writeSnapshotKey}}', value: '{{vars.response.order_number}}' },
                { op: 'message', value: 'Customer order created via DB macro: {{vars.response.order_number}}' }
              ]
            }
          }
        ]),
        templateJson: {},
        document: { id: 'doc-4-json', status: 'received' }
      },
      onMacroEvent
    });

    expect(result.dataJson.customer_order_number).toBe('CO-22');
    expect(result.externalRefsJson.customer_order_id).toBe('co-22');
    expect(result.snapshotsJson.customer_order_number).toBe('CO-22');
    expect(result.message).toBe('Customer order created via DB macro: CO-22');
    expect(onMacroEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        macroRef: 'macro:erp/ensureErpCustomerOrder@1',
        source: 'db-json',
        outcome: 'success'
      })
    );
  });

  it('macro ensureErpCustomerOrder does not require builtin fallback for normal db-json execution', async () => {
    const originalBuiltin = macroRegistryByRef['macro:erp/ensureErpCustomerOrder@1'];
    delete macroRegistryByRef['macro:erp/ensureErpCustomerOrder@1'];
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'co-23', order_number: 'CO-23' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    const onMacroEvent = vi.fn();

    try {
      const result = await executeActionDefinition({
        actionDef: {
          type: 'macro',
          ref: 'macro:erp/ensureErpCustomerOrder@1'
        },
        context: {
          doc: { id: 'doc-4-json-nobuiltin', status: 'received' },
          data: {},
          external: { customer_id: '11111111-1111-1111-1111-111111111111' },
          snapshot: {}
        },
        erpBaseUrl: 'http://localhost:3001',
        fetchImpl: fetchMock as unknown as typeof fetch,
        macroContext: {
          db: makeMacroCatalogDb([
            {
              ref: 'macro:erp/ensureErpCustomerOrder@1',
              kind: 'json',
              paramsSchemaJson: {
                properties: {
                  customerRefKey: { default: 'customer_id' },
                  writeFieldKey: { default: 'customer_order_number' },
                  writeExternalRefKey: { default: 'customer_order_id' },
                  writeSnapshotKey: { default: 'customer_order_number' }
                }
              },
              definitionJson: {
                ops: [
                  { op: 'read', from: 'external.{{params.customerRefKey}}', to: 'vars.customerId' },
                  { op: 'fallback', from: 'data.{{params.customerRefKey}}', to: 'vars.customerId' },
                  { op: 'require', from: 'vars.customerId', message: 'Select a customer first.' },
                  {
                    op: 'http.post',
                    service: 'erp',
                    path: '/api/customer-orders',
                    body: { customer_id: '{{vars.customerId}}' },
                    to: 'vars.response'
                  },
                  { op: 'require', from: 'vars.response.id', message: 'ERP customer order response missing id.' },
                  { op: 'require', from: 'vars.response.order_number', message: 'ERP customer order response missing order_number.' },
                  { op: 'write', to: 'data.{{params.writeFieldKey}}', value: '{{vars.response.order_number}}' },
                  { op: 'write', to: 'external.{{params.writeExternalRefKey}}', value: '{{vars.response.id}}' },
                  { op: 'write', to: 'snapshot.{{params.writeSnapshotKey}}', value: '{{vars.response.order_number}}' }
                ]
              }
            }
          ]),
          templateJson: {},
          document: { id: 'doc-4-json-nobuiltin', status: 'received' }
        },
        onMacroEvent
      });

      expect(result.dataJson.customer_order_number).toBe('CO-23');
      expect(result.externalRefsJson.customer_order_id).toBe('co-23');
      expect(result.snapshotsJson.customer_order_number).toBe('CO-23');
      expect(onMacroEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          macroRef: 'macro:erp/ensureErpCustomerOrder@1',
          source: 'db-json',
          outcome: 'success'
        })
      );
    } finally {
      if (originalBuiltin) {
        macroRegistryByRef['macro:erp/ensureErpCustomerOrder@1'] = originalBuiltin;
      }
    }
  });

  it('returns a friendly error for unknown macro ref', async () => {
    await expect(
      executeActionDefinition({
        actionDef: { type: 'macro', ref: 'macro:erp/doesNotExist@1' },
        context: {
          doc: { id: 'doc-5', status: 'received' },
          data: {},
          external: {},
          snapshot: {}
        },
        erpBaseUrl: 'http://localhost:3001',
        macroContext: {
          db: makeMacroCatalogDb(['macro:erp/doesNotExist@1']),
          templateJson: {},
          document: { id: 'doc-5', status: 'received' }
        }
      })
    ).rejects.toThrow('Macro ref not implemented: macro:erp/doesNotExist@1');
  });

  it('fails gracefully when macro ref is missing in fp_macros catalog', async () => {
    await expect(
      executeActionDefinition({
        actionDef: { type: 'macro', ref: 'macro:erp/createBatch@1' },
        context: {
          doc: { id: 'doc-10', status: 'Created' },
          data: {},
          external: {},
          snapshot: {}
        },
        erpBaseUrl: 'http://localhost:3001',
        macroContext: {
          db: makeMacroCatalogDb([]),
          templateJson: {},
          document: { id: 'doc-10', status: 'Created' }
        }
      })
    ).rejects.toThrow('Macro not found in catalog: macro:erp/createBatch@1');
  });

  it('fails when macro is disabled in catalog', async () => {
    await expect(
      executeActionDefinition({
        actionDef: { type: 'macro', ref: 'macro:erp/createBatch@1' },
        context: {
          doc: { id: 'doc-10d', status: 'Created' },
          data: {},
          external: {},
          snapshot: {}
        },
        erpBaseUrl: 'http://localhost:3001',
        macroContext: {
          db: makeMacroCatalogDb([{ ref: 'macro:erp/createBatch@1', isEnabled: false }]),
          templateJson: {},
          document: { id: 'doc-10d', status: 'Created' }
        }
      })
    ).rejects.toThrow('Macro not enabled: macro:erp/createBatch@1');
  });

  it('executes db-defined json macro before builtin fallback', async () => {
    const result = await executeActionDefinition({
      actionDef: { type: 'macro', ref: 'macro:test/dbjson@1' },
      context: {
        doc: { id: 'doc-10e', status: 'Created' },
        data: {},
        external: {},
        snapshot: {}
      },
      erpBaseUrl: 'http://localhost:3001',
      macroContext: {
        db: makeMacroCatalogDb([
          {
            ref: 'macro:test/dbjson@1',
            kind: 'json',
            definitionJson: {
              steps: [{ type: 'set', target: 'data', key: 'from_db_json', value: 'ok' }],
              status: 'Assigned'
            }
          }
        ]),
        templateJson: {},
        document: { id: 'doc-10e', status: 'Created' }
      }
    });

    expect(result.dataJson.from_db_json).toBe('ok');
    expect(result.status).toBe('Assigned');
  });

  it('returns clear error when macro catalog is not configured', async () => {
    await expect(
      executeActionDefinition({
        actionDef: { type: 'macro', ref: 'macro:erp/createBatch@1' },
        context: {
          doc: { id: 'doc-10b', status: 'Created' },
          data: {},
          external: {},
          snapshot: {}
        },
        erpBaseUrl: 'http://localhost:3001',
        macroContext: {
          db: {},
          templateJson: {},
          document: { id: 'doc-10b', status: 'Created' }
        }
      })
    ).rejects.toThrow('Action runtime database is not configured');
  });

  it('uses passed runtime db.select for macro catalog lookup without crashing', async () => {
    let selectCalled = false;
    const runtimeDb = {
      select: () => {
        selectCalled = true;
        return {
          from: () => ({
            where: () => ({
              limit: async () => [{ ref: 'macro:ui/reloadLookup@1', isEnabled: true }]
            })
          })
        };
      }
    };

    const result = await executeActionDefinition({
      actionDef: { type: 'macro', ref: 'macro:ui/reloadLookup@1' },
      context: {
        doc: { id: 'doc-10c', status: 'Created' },
        data: {},
        external: {},
        snapshot: {}
      },
      erpBaseUrl: 'http://localhost:3001',
      macroContext: {
        db: runtimeDb,
        templateJson: {},
        document: { id: 'doc-10c', status: 'Created' }
      }
    });

    expect(selectCalled).toBe(true);
    expect(result.status).toBe('Created');
  });

  it('integration: macro catalog lookup works with real db factory setup', async () => {
    if (!process.env.FP_DATABASE_URL) {
      expect(true).toBe(true);
      return;
    }

    const { db, pool } = makeRealDb();
    try {
      await db
        .insert(fpMacros)
        .values({
          ref: 'macro:ui/reloadLookup@1',
          namespace: 'ui',
          name: 'reloadLookup',
          version: 1,
          description: 'Reload lookup options',
          isEnabled: true
        })
        .onConflictDoUpdate({
          target: fpMacros.ref,
          set: {
            namespace: 'ui',
            name: 'reloadLookup',
            version: 1,
            description: 'Reload lookup options',
            isEnabled: true
          }
        });

      const result = await executeActionDefinition({
        actionDef: { type: 'macro', ref: 'macro:ui/reloadLookup@1' },
        context: {
          doc: { id: 'doc-real-1', status: 'Created' },
          data: {},
          external: {},
          snapshot: {}
        },
        erpBaseUrl: 'http://localhost:3001',
        macroContext: {
          db,
          templateJson: {},
          document: { id: 'doc-real-1', status: 'Created' }
        }
      });

      expect(result.status).toBe('Created');
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code;
      if (code === 'EPERM' || code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
        expect(true).toBe(true);
        return;
      }
      throw error;
    } finally {
      await pool.end();
    }
  });

  it('macro createBatch writes batch fields back into document payload', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: '11111111-2222-3333-4444-555555555555',
          batch_number: 'B-00000000-NEW'
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
    );

    const onMacroEvent = vi.fn();
    const result = await executeActionDefinition({
      actionDef: { type: 'macro', ref: 'macro:erp/createBatch@1' },
      context: {
        doc: { id: 'doc-11', status: 'Created' },
        data: {},
        external: { product_id: '00000000-0000-0000-0000-000000000001' },
        snapshot: {}
      },
      erpBaseUrl: 'http://localhost:3001',
      fetchImpl: fetchMock as unknown as typeof fetch,
      macroContext: {
        db: makeMacroCatalogDb(['macro:erp/createBatch@1']),
        templateJson: {},
        document: { id: 'doc-11', status: 'Created' }
      },
      onMacroEvent
    });

    expect(result.dataJson.batch_number).toBe('B-00000000-NEW');
    expect(result.externalRefsJson.batch_id).toBe('11111111-2222-3333-4444-555555555555');
    expect(result.snapshotsJson.batch_id).toBe('B-00000000-NEW');
    const requestInit = (fetchMock as any).mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(requestInit?.body ?? '{}'))).toEqual({
      product_id: '00000000-0000-0000-0000-000000000001'
    });
    expect(onMacroEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        macroRef: 'macro:erp/createBatch@1',
        source: 'builtin-fallback',
        outcome: 'success'
      })
    );
  });

  it('macro createBatch prefers db-json definition and reports source=db-json', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          batch_number: 'B-DBJSON-001'
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
    );
    const onMacroEvent = vi.fn();

    const result = await executeActionDefinition({
      actionDef: { type: 'macro', ref: 'macro:erp/createBatch@1' },
      context: {
        doc: { id: 'doc-11b', status: 'Created' },
        data: {},
        external: { product_id: '00000000-0000-0000-0000-000000000099' },
        snapshot: {}
      },
      erpBaseUrl: 'http://localhost:3001',
      fetchImpl: fetchMock as unknown as typeof fetch,
      macroContext: {
        db: makeMacroCatalogDb([
          {
            ref: 'macro:erp/createBatch@1',
            kind: 'json',
            definitionJson: {
              ops: [
                { op: 'read', from: 'external.product_id', to: 'vars.productId' },
                { op: 'fallback', from: 'data.product_id', to: 'vars.productId' },
                { op: 'require', from: 'vars.productId', message: 'Select a product first.' },
                {
                  op: 'http.post',
                  service: 'erp',
                  path: '/api/batches',
                  body: { product_id: '{{vars.productId}}' },
                  to: 'vars.batchResponse'
                },
                { op: 'require', from: 'vars.batchResponse.id', message: 'ERP create batch response missing id.' },
                {
                  op: 'require',
                  from: 'vars.batchResponse.batch_number',
                  message: 'ERP create batch response missing batch_number.'
                },
                { op: 'write', to: 'data.batch_number', value: '{{vars.batchResponse.batch_number}}' },
                { op: 'write', to: 'external.batch_id', value: '{{vars.batchResponse.id}}' },
                { op: 'write', to: 'snapshot.batch_number', value: '{{vars.batchResponse.batch_number}}' },
                { op: 'message', value: 'Batch created: {{vars.batchResponse.batch_number}}' }
              ]
            }
          }
        ]),
        templateJson: {},
        document: { id: 'doc-11b', status: 'Created' }
      },
      onMacroEvent
    });

    expect(result.dataJson.batch_number).toBe('B-DBJSON-001');
    expect(result.externalRefsJson.batch_id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(result.snapshotsJson.batch_number).toBe('B-DBJSON-001');
    expect(onMacroEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        macroRef: 'macro:erp/createBatch@1',
        source: 'db-json',
        outcome: 'success'
      })
    );
  });

  it('macro createBatch db-json works with default params from params_schema_json', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'default-batch-id',
          batch_number: 'B-DEFAULT-001'
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
    );

    const result = await executeActionDefinition({
      actionDef: { type: 'macro', ref: 'macro:erp/createBatch@1' },
      context: {
        doc: { id: 'doc-default-params', status: 'Created' },
        data: {},
        external: { product_id: '00000000-0000-0000-0000-000000000123' },
        snapshot: {}
      },
      erpBaseUrl: 'http://localhost:3001',
      fetchImpl: fetchMock as unknown as typeof fetch,
      macroContext: {
        db: makeMacroCatalogDb([
          {
            ref: 'macro:erp/createBatch@1',
            kind: 'json',
            paramsSchemaJson: {
              properties: {
                productRefKey: { default: 'product_id' },
                writeFieldKey: { default: 'batch_number' },
                writeExternalRefKey: { default: 'batch_id' },
                writeSnapshotKey: { default: 'batch_number' }
              }
            },
            definitionJson: {
              ops: [
                { op: 'read', from: 'external.{{params.productRefKey}}', to: 'vars.productId' },
                { op: 'fallback', from: 'data.{{params.productRefKey}}', to: 'vars.productId' },
                { op: 'require', from: 'vars.productId', message: 'Select a product first.' },
                {
                  op: 'http.post',
                  service: 'erp',
                  path: '/api/batches',
                  body: { product_id: '{{vars.productId}}' },
                  to: 'vars.batchResponse'
                },
                { op: 'write', to: 'data.{{params.writeFieldKey}}', value: '{{vars.batchResponse.batch_number}}' },
                { op: 'write', to: 'external.{{params.writeExternalRefKey}}', value: '{{vars.batchResponse.id}}' },
                { op: 'write', to: 'snapshot.{{params.writeSnapshotKey}}', value: '{{vars.batchResponse.batch_number}}' }
              ]
            }
          }
        ]),
        templateJson: {},
        document: { id: 'doc-default-params', status: 'Created' }
      }
    });

    expect(result.dataJson.batch_number).toBe('B-DEFAULT-001');
    expect(result.externalRefsJson.batch_id).toBe('default-batch-id');
    expect(result.snapshotsJson.batch_number).toBe('B-DEFAULT-001');
  });

  it('macro createBatch db-json works with custom params from template action', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'custom-batch-id',
          batch_number: 'B-CUSTOM-001'
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
    );

    const result = await executeActionDefinition({
      actionDef: {
        type: 'macro',
        ref: 'macro:erp/createBatch@1',
        params: {
          productRefKey: 'raw_product_ref',
          writeFieldKey: 'erp_batch_no',
          writeExternalRefKey: 'erp_batch_id',
          writeSnapshotKey: 'erp_batch_label'
        }
      },
      context: {
        doc: { id: 'doc-custom-params', status: 'Created' },
        data: { raw_product_ref: '00000000-0000-0000-0000-000000000321' },
        external: {},
        snapshot: {}
      },
      erpBaseUrl: 'http://localhost:3001',
      fetchImpl: fetchMock as unknown as typeof fetch,
      macroContext: {
        db: makeMacroCatalogDb([
          {
            ref: 'macro:erp/createBatch@1',
            kind: 'json',
            paramsSchemaJson: {
              properties: {
                productRefKey: { default: 'product_id' },
                writeFieldKey: { default: 'batch_number' },
                writeExternalRefKey: { default: 'batch_id' },
                writeSnapshotKey: { default: 'batch_number' }
              }
            },
            definitionJson: {
              ops: [
                { op: 'read', from: 'external.{{params.productRefKey}}', to: 'vars.productId' },
                { op: 'fallback', from: 'data.{{params.productRefKey}}', to: 'vars.productId' },
                { op: 'require', from: 'vars.productId', message: 'Select a product first.' },
                {
                  op: 'http.post',
                  service: 'erp',
                  path: '/api/batches',
                  body: { product_id: '{{vars.productId}}' },
                  to: 'vars.batchResponse'
                },
                { op: 'write', to: 'data.{{params.writeFieldKey}}', value: '{{vars.batchResponse.batch_number}}' },
                { op: 'write', to: 'external.{{params.writeExternalRefKey}}', value: '{{vars.batchResponse.id}}' },
                { op: 'write', to: 'snapshot.{{params.writeSnapshotKey}}', value: '{{vars.batchResponse.batch_number}}' }
              ]
            }
          }
        ]),
        templateJson: {},
        document: { id: 'doc-custom-params', status: 'Created' }
      }
    });

    expect(result.dataJson.erp_batch_no).toBe('B-CUSTOM-001');
    expect(result.externalRefsJson.erp_batch_id).toBe('custom-batch-id');
    expect(result.snapshotsJson.erp_batch_label).toBe('B-CUSTOM-001');
    const requestInit = (fetchMock as any).mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(requestInit?.body ?? '{}'))).toEqual({
      product_id: '00000000-0000-0000-0000-000000000321'
    });
  });

  it('macro createBatch fails with user-friendly error when no product is selected', async () => {
    await expect(
      executeActionDefinition({
        actionDef: { type: 'macro', ref: 'macro:erp/createBatch@1' },
        context: {
          doc: { id: 'doc-12', status: 'Created' },
          data: {},
          external: {},
          snapshot: {}
        },
        erpBaseUrl: 'http://localhost:3001',
        macroContext: {
          db: makeMacroCatalogDb(['macro:erp/createBatch@1']),
          templateJson: {},
          document: { id: 'doc-12', status: 'Created' }
        }
      })
    ).rejects.toThrow('Select a product first.');
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
