import { describe, expect, it } from 'vitest';
import { executeJsonMacroDefinition } from './json-runtime.js';
import type { MacroCtx } from './index.js';

function makeCtx(seed?: {
  data?: Record<string, unknown>;
  external?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
}) {
  const dataJson = { ...(seed?.data ?? {}) };
  const externalRefsJson = { ...(seed?.external ?? {}) };
  const snapshotsJson = { ...(seed?.snapshot ?? {}) };
  const patchState: { status?: string } = {};

  const ctx: MacroCtx = {
    db: {},
    doc: { id: 'doc-json-runtime-1', status: 'assigned' },
    template: {},
    data: { get: (key) => dataJson[key] },
    external: { get: (key) => externalRefsJson[key] },
    snapshot: { get: (key) => snapshotsJson[key] },
    patch: {
      data: (key, value) => {
        dataJson[key] = value;
      },
      external: (key, value) => {
        externalRefsJson[key] = value;
      },
      snapshot: (key, value) => {
        snapshotsJson[key] = value;
      },
      status: (status) => {
        patchState.status = status;
      }
    },
    http: {
      erp: {
        post: async (_path, body) => ({ id: 'batch-1', batch_number: `B-${String((body as any).product_id ?? '')}` })
      }
    },
    dataJson,
    externalRefsJson,
    snapshotsJson
  };

  return { ctx, dataJson, externalRefsJson, snapshotsJson, patchState };
}

describe('json macro runtime', () => {
  it('executes read -> require -> http.post -> write flow', async () => {
    const { ctx, dataJson, externalRefsJson, snapshotsJson } = makeCtx({
      external: { product_id: 'P-100' }
    });

    const result = await executeJsonMacroDefinition(
      {
        ops: [
          { op: 'read', from: 'external.product_id', to: 'vars.productId' },
          { op: 'require', from: 'vars.productId', message: 'Select a product first.' },
          {
            op: 'http.post',
            service: 'erp',
            path: '/api/batches',
            body: { product_id: '{{vars.productId}}' },
            to: 'vars.batch'
          },
          { op: 'write', to: 'data.batch_number', value: '{{vars.batch.batch_number}}' },
          { op: 'write', to: 'external.batch_id', value: '{{vars.batch.id}}' },
          { op: 'write', to: 'snapshot.batch_id', value: '{{vars.batch.batch_number}}' },
          { op: 'message', value: 'Batch created: {{vars.batch.batch_number}}' }
        ]
      },
      ctx
    );

    expect(dataJson.batch_number).toBe('B-P-100');
    expect(externalRefsJson.batch_id).toBe('batch-1');
    expect(snapshotsJson.batch_id).toBe('B-P-100');
    expect(result?.message).toBe('Batch created: B-P-100');
  });

  it('supports fallback to fill vars only when target is empty', async () => {
    const withExternal = makeCtx({
      external: { product_id: 'P-EXT-1' },
      data: { product_id: 'P-DATA-1' }
    });
    await executeJsonMacroDefinition(
      {
        ops: [
          { op: 'read', from: 'external.product_id', to: 'vars.productId' },
          { op: 'fallback', from: 'data.product_id', to: 'vars.productId' },
          { op: 'write', to: 'data.result_product', value: '{{vars.productId}}' }
        ]
      },
      withExternal.ctx
    );
    expect(withExternal.dataJson.result_product).toBe('P-EXT-1');

    const withoutExternal = makeCtx({
      data: { product_id: 'P-DATA-2' }
    });
    await executeJsonMacroDefinition(
      {
        ops: [
          { op: 'read', from: 'external.product_id', to: 'vars.productId' },
          { op: 'fallback', from: 'data.product_id', to: 'vars.productId' },
          { op: 'write', to: 'data.result_product', value: '{{vars.productId}}' }
        ]
      },
      withoutExternal.ctx
    );
    expect(withoutExternal.dataJson.result_product).toBe('P-DATA-2');
  });

  it('throws clear error for missing required value', async () => {
    const { ctx } = makeCtx();
    await expect(
      executeJsonMacroDefinition(
        {
          ops: [{ op: 'require', from: 'external.product_id', message: 'Select a product first.' }]
        },
        ctx
      )
    ).rejects.toThrow('Select a product first.');
  });

  it('supports setStatus alias and log op', async () => {
    const { ctx, patchState } = makeCtx();
    const result = await executeJsonMacroDefinition(
      {
        ops: [{ op: 'log', value: 'moving to submitted' }, { op: 'setStatus', to: 'submitted' }, { op: 'message', value: 'ok' }]
      },
      ctx
    );
    expect(patchState.status).toBe('submitted');
    expect(result?.message).toBe('ok');
  });

  it('returns TODO-style error for http.get', async () => {
    const { ctx } = makeCtx();
    await expect(
      executeJsonMacroDefinition(
        {
          ops: [{ op: 'http.get', service: 'erp', path: '/api/products', to: 'vars.products' }]
        },
        ctx
      )
    ).rejects.toThrow('JSON macro op http.get is not implemented yet');
  });

  it('throws a clear interpolation error when referenced value is missing', async () => {
    const { ctx } = makeCtx();
    await expect(
      executeJsonMacroDefinition(
        {
          ops: [{ op: 'write', to: 'data.batch_number', value: '{{vars.batch.batch_number}}' }]
        },
        ctx
      )
    ).rejects.toThrow('Missing interpolation value for vars.batch.batch_number');
  });
});
