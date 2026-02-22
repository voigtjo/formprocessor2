import { describe, expect, it } from 'vitest';

const ERP_BASE_URL = process.env.ERP_BASE_URL ?? 'http://localhost:3001';
const APP_BASE_URL = process.env.FP_BASE_URL ?? 'http://localhost:3000';

async function getText(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  return { res, text };
}

async function getJson(url: string) {
  const { res, text } = await getText(url);
  let json: unknown = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { res, json, text };
}

describe('E2E smoke: erp-sim + app over HTTP', () => {
  it('GET erp-sim /health returns 200', async () => {
    const erpHealth = await getJson(`${ERP_BASE_URL}/health`);
    expect(erpHealth.res.status).toBe(200);
    expect(erpHealth.json).toEqual({ ok: true });
  });

  it('GET erp-sim /api/products?valid=true returns 200 and non-empty items', async () => {
    const products = await getJson(`${ERP_BASE_URL}/api/products?valid=true`);
    expect(products.res.status).toBe(200);

    const parsed = products.json as { items?: unknown[] } | null;
    expect(Array.isArray(parsed?.items)).toBe(true);
    expect((parsed?.items ?? []).length).toBeGreaterThan(0);
  });

  it('GET app /health returns 200', async () => {
    const appHealth = await getJson(`${APP_BASE_URL}/health`);
    expect(appHealth.res.status).toBe(200);
    expect(appHealth.json).toEqual({ ok: true });
  });

  it('GET app /templates returns 200 and contains template marker', async () => {
    const templatesPage = await getText(`${APP_BASE_URL}/templates`);
    expect(templatesPage.res.status).toBe(200);
    expect(
      templatesPage.text.includes('customer-order') || templatesPage.text.includes('Templates')
    ).toBe(true);
  });

  it('optionally opens /documents/new using a templateId parsed from /templates', async () => {
    const templatesPage = await getText(`${APP_BASE_URL}/templates`);
    expect(templatesPage.res.status).toBe(200);

    const match = templatesPage.text.match(/\/documents\/new\?templateId=([0-9a-fA-F-]{36})/);
    if (!match) {
      return;
    }

    const templateId = match[1];
    const newDocumentPage = await getText(
      `${APP_BASE_URL}/documents/new?templateId=${encodeURIComponent(templateId)}`
    );

    expect(newDocumentPage.res.status).toBe(200);
  });
});
