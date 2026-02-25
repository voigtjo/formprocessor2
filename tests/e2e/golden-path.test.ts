import { describe, expect, it } from 'vitest';

const APP_BASE_URL = process.env.FP_BASE_URL ?? 'http://localhost:3000';
const ERP_BASE_URL = process.env.ERP_BASE_URL ?? 'http://localhost:3001';
const UUID_RE = '[0-9a-fA-F-]{36}';

async function getText(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  return { res, text };
}

async function getJson(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  return { res, json: JSON.parse(text) as any, text };
}

function extractTemplateId(html: string) {
  const customerOrderMatch = html.match(
    new RegExp(`customer-order[\\s\\S]{0,1200}/documents/new\\?templateId=(${UUID_RE})`, 'i')
  );
  if (customerOrderMatch?.[1]) {
    return customerOrderMatch[1];
  }

  const fallback = html.match(new RegExp(`/documents/new\\?templateId=(${UUID_RE})`, 'i'));
  if (fallback?.[1]) {
    return fallback[1];
  }

  return undefined;
}

function extractFirstRealOptionValue(optionsHtml: string) {
  const optionRegex = /<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi;
  let match: RegExpExecArray | null;

  while ((match = optionRegex.exec(optionsHtml)) !== null) {
    const value = match[1]?.trim() ?? '';
    const label = match[2]?.replace(/<[^>]+>/g, '').trim() ?? '';

    if (!value) continue;
    if (!label) continue;

    const lowerLabel = label.toLowerCase();
    if (
      lowerLabel.includes('please choose') ||
      lowerLabel.includes('invalid lookup') ||
      lowerLabel.includes('template not found') ||
      lowerLabel.includes('lookup unavailable') ||
      lowerLabel.includes('lookup field not found')
    ) {
      continue;
    }

    return value;
  }

  return undefined;
}

function extractDocumentIdFromLocation(location: string | null) {
  if (!location) return undefined;
  const match = location.match(new RegExp(`/documents/(${UUID_RE})`));
  return match?.[1];
}

describe('E2E golden path: create + create_offer + complete', () => {
  it('runs complete flow over HTTP', async () => {
    const templatesPage = await getText(`${APP_BASE_URL}/templates`);
    expect(templatesPage.res.status).toBe(200);

    const templateId = extractTemplateId(templatesPage.text);
    expect(templateId).toBeTruthy();

    const newDocPage = await getText(`${APP_BASE_URL}/documents/new?templateId=${encodeURIComponent(templateId!)}`);
    expect(newDocPage.res.status).toBe(200);

    const productLookup = await getText(
      `${APP_BASE_URL}/api/lookup?templateId=${encodeURIComponent(templateId!)}&fieldKey=product_id`
    );
    expect(productLookup.res.status).toBe(200);
    expect(productLookup.text).toContain('<option');

    const productId = extractFirstRealOptionValue(productLookup.text);
    expect(productId).toBeTruthy();

    const customerLookup = await getText(
      `${APP_BASE_URL}/api/lookup?templateId=${encodeURIComponent(templateId!)}&fieldKey=customer_id`
    );
    expect(customerLookup.res.status).toBe(200);
    expect(customerLookup.text).toContain('<option');

    const customerId = extractFirstRealOptionValue(customerLookup.text);
    expect(customerId).toBeTruthy();

    const createBody = new URLSearchParams({
      templateId: templateId!,
      'lookup:product_id': productId!,
      'lookup:customer_id': customerId!,
      'data:order_notes': 'e2e'
    });

    const createRes = await fetch(`${APP_BASE_URL}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: createBody.toString(),
      redirect: 'manual'
    });

    expect([302, 303]).toContain(createRes.status);

    const createdDocumentId = extractDocumentIdFromLocation(createRes.headers.get('location'));
    expect(createdDocumentId).toBeTruthy();

    const createOfferRes = await fetch(`${APP_BASE_URL}/documents/${createdDocumentId}/action/create_offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
      redirect: 'manual'
    });
    expect([302, 303]).toContain(createOfferRes.status);

    const afterCreateOffer = await getText(`${APP_BASE_URL}/documents/${createdDocumentId}`);
    expect(afterCreateOffer.res.status).toBe(200);
    expect(afterCreateOffer.text.toLowerCase()).toContain('offer_created');

    const completeRes = await fetch(`${APP_BASE_URL}/documents/${createdDocumentId}/action/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
      redirect: 'manual'
    });
    expect([302, 303]).toContain(completeRes.status);

    const afterComplete = await getText(`${APP_BASE_URL}/documents/${createdDocumentId}`);
    expect(afterComplete.res.status).toBe(200);
    expect(afterComplete.text.toLowerCase()).toContain('completed');

    // Optional ERP-side check for completed order of selected customer.
    const erpCheck = await getJson(
      `${ERP_BASE_URL}/api/customer-orders?status=completed&customer_id=${encodeURIComponent(customerId!)}`
    );
    expect(erpCheck.res.status).toBe(200);
    const items = Array.isArray(erpCheck.json?.items) ? erpCheck.json.items : [];
    if (items.length > 0) {
      expect(items.some((item: any) => item.status === 'completed')).toBe(true);
    }
  });
});
