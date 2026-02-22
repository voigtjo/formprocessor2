import { describe, it, expect } from 'vitest';

const FP = process.env.FP_BASE_URL ?? 'http://localhost:4000';
const ERP = process.env.ERP_BASE_URL ?? 'http://localhost:4001';

async function getJson(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { res, json, text };
}

describe('smoke', () => {
  it('health endpoints', async () => {
    const fp = await getJson(`${FP}/health`);
    expect(fp.res.status).toBe(200);
    expect(fp.json).toEqual({ ok: true });

    const erp = await getJson(`${ERP}/health`);
    expect(erp.res.status).toBe(200);
    expect(erp.json).toEqual({ ok: true });
  });

  it('erp list endpoints respond', async () => {
    const products = await getJson(`${ERP}/api/products?valid=true`);
    expect(products.res.status).toBe(200);

    const customers = await getJson(`${ERP}/api/customers?valid=true`);
    expect(customers.res.status).toBe(200);
  });
});
