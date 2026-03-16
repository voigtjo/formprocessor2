import { resolveServiceBaseUrl } from '../services/service-registry.js';
import { eq } from 'drizzle-orm';
import { fpApis } from '../db/schema.js';

/**
 * Transition architecture note:
 * - Legacy model: macros + callExternal with direct ERP endpoint knowledge in templates.
 * - Target model: template/system actions that reference centrally managed APIs.
 * - This in-code catalog is a P0 bridge and can later be moved to DB-backed API administration.
 */
export type ApiCatalogEntry = {
  key: string;
  ref: string;
  name: string;
  description?: string;
  serviceKey: 'erp' | 'erp-sim' | 'custom';
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  baseUrl?: string;
  path: string;
  requestSchemaJson?: Record<string, unknown> | null;
  responseSchemaJson?: Record<string, unknown> | null;
  handlerCode?: string | null;
};

const transitionApiCatalog: Record<string, ApiCatalogEntry> = {
  'api:erp/createBatch@1': {
    key: 'erp.createBatch',
    ref: 'api:erp/createBatch@1',
    name: 'Create Batch',
    description: 'Creates ERP batch for a batch-capable product',
    serviceKey: 'erp',
    method: 'POST',
    path: '/api/batches'
  },
  'api:erp/createCustomerOrder@1': {
    key: 'erp.createCustomerOrder',
    ref: 'api:erp/createCustomerOrder@1',
    name: 'Create Customer Order',
    description: 'Creates ERP customer order for customer reference',
    serviceKey: 'erp',
    method: 'POST',
    path: '/api/customer-orders'
  }
};

function normalizeApiLookupKeys(raw: string) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return [];
  const keys = new Set<string>();
  keys.add(trimmed);
  if (trimmed.startsWith('api:')) keys.add(trimmed.slice('api:'.length));
  const withoutVersion = trimmed.replace(/@\d+$/, '');
  keys.add(withoutVersion);
  if (withoutVersion.startsWith('api:')) keys.add(withoutVersion.slice('api:'.length));
  return Array.from(keys).filter((item) => item.length > 0);
}

export function resolveApiBaseUrl(serviceKey: string, defaultErpBaseUrl: string) {
  return resolveServiceBaseUrl(serviceKey, defaultErpBaseUrl);
}

async function resolveApiCatalogEntryFromDb(db: unknown, apiRef: string): Promise<ApiCatalogEntry | null> {
  const runtimeDb = db as { select?: (...args: unknown[]) => any } | null | undefined;
  if (!runtimeDb || typeof runtimeDb.select !== 'function') return null;
  const candidates = normalizeApiLookupKeys(apiRef);
  for (const key of candidates) {
    const rows = await runtimeDb
      .select({
        key: fpApis.key,
        name: fpApis.name,
        description: fpApis.description,
        state: fpApis.state,
        method: fpApis.method,
        baseUrl: fpApis.baseUrl,
        path: fpApis.path,
        requestSchemaJson: fpApis.requestSchemaJson,
        responseSchemaJson: fpApis.responseSchemaJson,
        handlerCode: fpApis.handlerCode
      })
      .from(fpApis)
      .where(eq(fpApis.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) continue;
    if (String(row.state).trim().toLowerCase() !== 'active') {
      throw new Error(`API is inactive: ${key}`);
    }
    const rawBaseUrl = typeof row.baseUrl === 'string' ? row.baseUrl.trim() : '';
    return {
      key: row.key,
      ref: `api:${row.key}`,
      name: row.name,
      description: row.description ?? undefined,
      serviceKey: rawBaseUrl.includes('localhost:3001') ? 'erp' : 'custom',
      method: String(row.method).trim().toUpperCase() as ApiCatalogEntry['method'],
      baseUrl: rawBaseUrl || undefined,
      path: row.path,
      requestSchemaJson: (row.requestSchemaJson as Record<string, unknown> | null) ?? null,
      responseSchemaJson: (row.responseSchemaJson as Record<string, unknown> | null) ?? null,
      handlerCode: (row.handlerCode as string | null) ?? null
    };
  }
  return null;
}

export async function resolveApiCatalogEntry(apiRef: string, db?: unknown): Promise<ApiCatalogEntry> {
  const normalized = String(apiRef ?? '').trim();
  if (!normalized) throw new Error('callApi step requires apiRef');
  const fromDb = db ? await resolveApiCatalogEntryFromDb(db, normalized) : null;
  if (fromDb) return fromDb;

  const candidates = normalizeApiLookupKeys(normalized);
  const entry = candidates.map((candidate) => transitionApiCatalog[candidate]).find(Boolean);
  if (!entry) throw new Error(`API ref not found in catalog: ${normalized}`);
  return entry;
}

export function listTransitionApiCatalog() {
  return Object.values(transitionApiCatalog);
}
