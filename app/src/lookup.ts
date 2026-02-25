import { z } from 'zod';

const templateTokenRegex = /\{\{external\.([a-zA-Z0-9_]+)\}\}/g;
const templateTokenDetectRegex = /\{\{external\.[a-zA-Z0-9_]+\}\}/;

const sourceSchema = z.object({
  path: z.string(),
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
      path,
      query: normalizedQuery,
      valueField: directSource.valueField,
      labelField: directSource.labelField,
      valueKey: directSource.valueKey,
      labelKey: directSource.labelKey
    });
  }

  const lookup = field?.lookup;
  if (!lookup?.endpoint || typeof lookup.endpoint !== 'string') {
    throw new Error('Lookup field source is missing');
  }

  const endpointUrl = new URL(lookup.endpoint, 'http://placeholder.local');
  const query: Record<string, string> = {};
  endpointUrl.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  return sourceSchema.parse({
    path: endpointUrl.pathname,
    query,
    valueField: lookup.valueField,
    labelField: lookup.labelField,
    valueKey: lookup.valueKey,
    labelKey: lookup.labelKey
  });
}

export async function fetchLookupOptions(
  baseUrl: string,
  source: LookupSource,
  externalRefs: Record<string, string>,
  valueField = 'id',
  labelField = 'name'
): Promise<LookupOption[]> {
  const url = buildLookupUrl(baseUrl, source, externalRefs);
  const response = await fetch(url, {
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

  return items
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
}
