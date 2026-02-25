export type MacroResult = {
  status?: string;
  dataJson?: Record<string, unknown>;
  externalRefsJson?: Record<string, unknown>;
  snapshotsJson?: Record<string, unknown>;
};

export type MacroCtx = {
  db: unknown;
  erpBaseUrl: string;
  templateJson: unknown;
  document: { id: string; status: string };
  dataJson: Record<string, unknown>;
  externalRefsJson: Record<string, unknown>;
  snapshotsJson: Record<string, unknown>;
  form?: Record<string, unknown>;
  fetchImpl: typeof fetch;
};

export type MacroExecutionContext = MacroCtx;
export type MacroHandler = (ctx: MacroCtx, params?: Record<string, unknown>) => Promise<MacroResult | void>;

const ensureErpCustomerOrder: MacroHandler = async (ctx) => {
  const existing = ctx.externalRefsJson.customer_order_id;
  if (typeof existing === 'string' && existing.length > 0) {
    return;
  }

  const rawCustomerId = ctx.externalRefsJson.customer_id;
  const customerId = typeof rawCustomerId === 'string' && rawCustomerId.length > 0 ? rawCustomerId : null;

  const response = await ctx.fetchImpl(new URL('/api/customer-orders', ctx.erpBaseUrl).toString(), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ customer_id: customerId })
  });

  if (!response.ok) {
    throw new Error(`Macro ensureErpCustomerOrder failed (${response.status})`);
  }

  const payload = (await response.json()) as {
    id?: string;
    order_number?: string;
  };

  if (!payload.id || !payload.order_number) {
    throw new Error('Macro ensureErpCustomerOrder received incomplete ERP response');
  }

  ctx.externalRefsJson.customer_order_id = payload.id;
  ctx.snapshotsJson.customer_order_id = payload.order_number;
  ctx.dataJson.erp_customer_order_id = payload.order_number;
  ctx.dataJson.erp_customer_order_ref = payload.id;
};

const reloadLookup: MacroHandler = async () => {
  // P0 no-op: this macro exists to allow templates to reference it safely.
};

export const registry: Record<string, MacroHandler> = {
  ensureErpCustomerOrder,
  reloadLookup
};

export const macroRegistry = registry;
