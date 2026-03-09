export type MacroResult = {
  status?: string;
  message?: string;
  dataJson?: Record<string, unknown>;
  externalRefsJson?: Record<string, unknown>;
  snapshotsJson?: Record<string, unknown>;
};

type MacroPatch = {
  status?: string;
  message?: string;
  dataJson: Record<string, unknown>;
  externalRefsJson: Record<string, unknown>;
  snapshotsJson: Record<string, unknown>;
};

export type MacroCtx = {
  db: unknown;
  doc: { id: string; status: string };
  template: unknown;
  templateDefinition?: {
    fullSchema?: unknown;
    template?: unknown;
  };
  schema?: unknown;
  data: {
    get: (key: string) => unknown;
  };
  external: {
    get: (key: string) => unknown;
  };
  snapshot: {
    get: (key: string) => unknown;
  };
  patch: {
    data: (key: string, value: unknown) => void;
    external: (key: string, value: unknown) => void;
    snapshot: (key: string, value: unknown) => void;
    status: (status: string) => void;
  };
  http: {
    erp: {
      post: <T = unknown>(path: string, body: unknown) => Promise<T>;
    };
  };
  // Backward compatible read/write fields for existing macros.
  dataJson: Record<string, unknown>;
  externalRefsJson: Record<string, unknown>;
  snapshotsJson: Record<string, unknown>;
  form?: Record<string, unknown>;
};

export type MacroExecutionContext = MacroCtx;
export type MacroHandler = (ctx: MacroCtx, params?: Record<string, unknown>) => Promise<MacroResult | void>;
export type MacroPatchContext = MacroPatch;

const ensureErpCustomerOrder: MacroHandler = async (ctx) => {
  const existing = ctx.external.get('customer_order_id');
  if (typeof existing === 'string' && existing.length > 0) {
    return;
  }

  const rawCustomerId = ctx.external.get('customer_id');
  const customerId = typeof rawCustomerId === 'string' && rawCustomerId.length > 0 ? rawCustomerId : null;

  const payload = (await ctx.http.erp.post('/api/customer-orders', {
    customer_id: customerId
  })) as {
    id?: string;
    order_number?: string;
  };

  if (!payload.id || !payload.order_number) {
    throw new Error('Macro ensureErpCustomerOrder received incomplete ERP response');
  }

  ctx.patch.external('customer_order_id', payload.id);
  ctx.patch.snapshot('customer_order_id', payload.order_number);
  ctx.patch.data('erp_customer_order_id', payload.order_number);
  ctx.patch.data('erp_customer_order_ref', payload.id);
};

const createBatch: MacroHandler = async (ctx, params) => {
  const productRefKey =
    typeof params?.productRefKey === 'string' && params.productRefKey.trim().length > 0
      ? params.productRefKey.trim()
      : 'product_id';
  const writeFieldKey =
    typeof params?.writeFieldKey === 'string' && params.writeFieldKey.trim().length > 0
      ? params.writeFieldKey.trim()
      : 'batch_number';

  const fromExternal = ctx.external.get(productRefKey);
  const fromData = ctx.data.get(productRefKey);
  const productId =
    typeof fromExternal === 'string' && fromExternal.trim().length > 0
      ? fromExternal.trim()
      : typeof fromData === 'string' && fromData.trim().length > 0
        ? fromData.trim()
        : '';
  if (!productId) {
    throw new Error('Select a product first.');
  }

  const payload = (await ctx.http.erp.post('/api/batches', {
    product_id: productId
  })) as {
    id?: string;
    batch_number?: string;
  };

  if (!payload.id || !payload.batch_number) {
    throw new Error('Macro createBatch received incomplete ERP response');
  }

  ctx.patch.data(writeFieldKey, payload.batch_number);
  if (typeof payload.id === 'string' && payload.id.trim().length > 0) {
    ctx.patch.external('batch_id', payload.id);
  }
  ctx.patch.snapshot('batch_id', payload.batch_number);
  return { message: `Batch created: ${payload.batch_number}` };
};

const reloadLookup: MacroHandler = async () => {
  // P0 no-op: this macro exists to allow templates to reference it safely.
};

export const macroRegistryByRef: Record<string, MacroHandler> = {
  'macro:erp/ensureErpCustomerOrder@1': ensureErpCustomerOrder,
  'macro:erp/createBatch@1': createBatch,
  'macro:ui/reloadLookup@1': reloadLookup
};

export const macroLegacyNameToRef: Record<string, string> = {
  ensureErpCustomerOrder: 'macro:erp/ensureErpCustomerOrder@1',
  createBatch: 'macro:erp/createBatch@1',
  reloadLookup: 'macro:ui/reloadLookup@1'
};

export const macroRegistry = macroRegistryByRef;
