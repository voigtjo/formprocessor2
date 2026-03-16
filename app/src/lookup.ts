import { z } from 'zod';
import { resolveApiCatalogEntry } from './actions/api-catalog.js';
import { resolveServiceBaseUrl } from './services/service-registry.js';

const templateTokenRegex = /\{\{external\.([a-zA-Z0-9_]+)\}\}/g;
const templateTokenDetectRegex = /\{\{external\.[a-zA-Z0-9_]+\}\}/;

const sourceSchema = z.object({
  service: z.enum(['erp-sim', 'erp', 'custom']).default('erp-sim'),
  method: z.literal('GET').default('GET'),
  path: z.string(),
  baseUrl: z.string().optional(),
  query: z.record(z.string()).optional(),
  valueField: z.string().optional(),
  labelField: z.string().optional(),
  valueKey: z.string().optional(),
  labelKey: z.string().optional()
});

export type LookupSource = z.infer<typeof sourceSchema>;

export type LookupOption = {
  value: string;
  label: string;
};

export type LookupFetchResult = {
  options: LookupOption[];
  rawCount: number;
  url: string;
  source: LookupSource;
};

export type LookupResolveContext = {
  db?: unknown;
};

function normalizeQueryValue(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return String(value ?? '');
}

function substituteTokens(value: string, externalRefs: Record<string, string>) {
  return value.replace(templateTokenRegex, (_match, key: string) => externalRefs[key] ?? '');
}

function hasExternalPlaceholder(value: string) {
  return templateTokenDetectRegex.test(value);
}

export function buildLookupUrl(baseUrl: string, source: LookupSource, externalRefs: Record<string, string>) {
  const url = new URL(substituteTokens(source.path, externalRefs), baseUrl);

  for (const [key, rawValue] of Object.entries(source.query ?? {})) {
    const stringValue = String(rawValue);
    const containsPlaceholder = hasExternalPlaceholder(stringValue);
    const resolved = substituteTokens(stringValue, externalRefs).trim();

    if (containsPlaceholder && resolved.length === 0) {
      continue;
    }

    url.searchParams.set(key, resolved);
  }

  return url.toString();
}

export function normalizeLookupSource(field: any): LookupSource {
  const directSource = field?.source;
  if (directSource && typeof directSource === 'object') {
    const path = typeof directSource.path === 'string' ? directSource.path : undefined;
    if (!path) {
      throw new Error('Lookup field source path is missing');
    }

    const normalizedQuery: Record<string, string> = {};
    const rawQuery = directSource.query;
    if (rawQuery && typeof rawQuery === 'object') {
      for (const [key, value] of Object.entries(rawQuery)) {
        normalizedQuery[key] = normalizeQueryValue(value);
      }
    }

    return sourceSchema.parse({
      service: typeof directSource.service === 'string' ? directSource.service.trim().toLowerCase() : directSource.service,
      method: typeof directSource.method === 'string' ? directSource.method.trim().toUpperCase() : directSource.method,
      path,
      query: normalizedQuery,
      valueField: directSource.valueField,
      labelField: directSource.labelField,
      valueKey: directSource.valueKey,
      labelKey: directSource.labelKey
    });
  }

  const lookup = field?.lookup;
  // Legacy fallback: historical templates used `lookup.endpoint` instead of `source`.
  if (!lookup?.endpoint || typeof lookup.endpoint !== 'string') {
    throw new Error('Lookup field source is missing (use apiRef as primary model)');
  }

  const endpointUrl = new URL(lookup.endpoint, 'http://placeholder.local');
  const query: Record<string, string> = {};
  endpointUrl.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  return sourceSchema.parse({
    service: 'erp-sim',
    method: 'GET',
    path: endpointUrl.pathname,
    query,
    valueField: lookup.valueField,
    labelField: lookup.labelField,
    valueKey: lookup.valueKey,
    labelKey: lookup.labelKey
  });
}

function inferLookupService(baseUrl: string | undefined) {
  const normalized = String(baseUrl ?? '').toLowerCase();
  if (normalized.includes('localhost:3001')) return 'erp' as const;
  if (normalized.length > 0) return 'custom' as const;
  return 'erp-sim' as const;
}

export async function resolveLookupSource(field: any, context?: LookupResolveContext): Promise<LookupSource> {
  // Primary model: lookup fields should use apiRef.
  // Legacy compatibility (fallback only): source / lookup.endpoint.
  const apiRef = typeof field?.apiRef === 'string' ? field.apiRef.trim() : '';
  if (!apiRef) {
    return normalizeLookupSource(field);
  }

  const entry = await resolveApiCatalogEntry(apiRef, context?.db);
  const method = String(entry.method ?? 'GET')
    .trim()
    .toUpperCase();
  if (method !== 'GET') {
    throw new Error(`Lookup apiRef must use GET: ${apiRef}`);
  }

  const requestSchema = entry.requestSchemaJson;
  const rawQuery =
    requestSchema && typeof requestSchema === 'object' && !Array.isArray(requestSchema)
      ? (requestSchema as Record<string, unknown>).query
      : undefined;
  const query: Record<string, string> = {};
  if (rawQuery && typeof rawQuery === 'object' && !Array.isArray(rawQuery)) {
    for (const [key, value] of Object.entries(rawQuery as Record<string, unknown>)) {
      query[key] = normalizeQueryValue(value);
    }
  }

  return sourceSchema.parse({
    service: inferLookupService(entry.baseUrl),
    method: 'GET',
    path: entry.path,
    baseUrl: entry.baseUrl,
    query,
    valueField: field?.valueField,
    labelField: field?.labelField,
    valueKey: field?.valueKey,
    labelKey: field?.labelKey
  });
}

export async function fetchLookupOptionsDetailed(
  baseUrl: string,
  source: LookupSource,
  externalRefs: Record<string, string>,
  valueField = 'id',
  labelField = 'name'
): Promise<LookupFetchResult> {
  const configuredBaseUrl = typeof source.baseUrl === 'string' ? source.baseUrl.trim() : '';
  const serviceBaseUrl =
    configuredBaseUrl.length > 0
      ? configuredBaseUrl
      : source.service === 'custom'
        ? (() => {
            throw new Error('Lookup source baseUrl is missing for custom service');
          })()
        : resolveServiceBaseUrl(source.service, baseUrl);
  const method = String(source.method ?? 'GET').toUpperCase();
  if (method !== 'GET') {
    throw new Error(`Unsupported lookup method: ${source.method}`);
  }
  const url = buildLookupUrl(serviceBaseUrl, source, externalRefs);
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Lookup request failed (status ${response.status})`);
  }

  const data = (await response.json()) as unknown;
  const items = Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : Array.isArray((data as { items?: unknown[] })?.items)
      ? ((data as { items: Record<string, unknown>[] }).items ?? [])
      : [];

  const options = items
    .map((item) => {
      const rawValue = item[valueField] ?? item.id;
      const rawLabel = item[labelField] ?? item.name;
      if (rawValue === undefined || rawLabel === undefined || rawValue === null || rawLabel === null) {
        return undefined;
      }

      return {
        value: String(rawValue),
        label: String(rawLabel)
      };
    })
    .filter((item): item is LookupOption => item !== undefined);

  return {
    options,
    rawCount: items.length,
    url,
    source
  };
}

export async function fetchLookupOptions(
  baseUrl: string,
  source: LookupSource,
  externalRefs: Record<string, string>,
  valueField = 'id',
  labelField = 'name'
): Promise<LookupOption[]> {
  const result = await fetchLookupOptionsDetailed(baseUrl, source, externalRefs, valueField, labelField);
  return result.options;
}
