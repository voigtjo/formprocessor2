import { eq } from 'drizzle-orm';
import { fpMacros } from '../db/schema.js';
import { resolveApiBaseUrl, resolveApiCatalogEntry } from './api-catalog.js';
import { normalizeDocumentStatus } from '../domain/status-model.js';
import {
  macroLegacyNameToRef,
  macroRegistryByRef,
  type MacroCtx,
  type MacroPatchContext,
  type MacroResult
} from './macros/index.js';
import { executeJsonMacroDefinition } from './macros/json-runtime.js';

export type ActionContext = {
  doc: { id: string; status: string };
  data: Record<string, unknown>;
  external: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  vars: Record<string, unknown>;
};

export type ActionStep =
  | {
      type: 'system';
      action:
        | 'setStatus'
        | 'showMessage'
        | 'requireValue'
        | 'saveDocument'
        | 'archiveDocument'
        | 'assignEditor'
        | 'assignApprover';
      to?: string;
      status?: string;
      key?: string;
      from?: string;
      value?: unknown;
      message?: string;
    }
  | { type: 'setStatus'; to?: string; status?: string }
  | { type: 'setField'; key: string; value: unknown }
  | { type: 'requireField'; key: string; message?: string }
  | { type: 'require'; from: string; message?: string }
  | { type: 'write'; to: string; value: unknown }
  | { type: 'message'; value: string }
  | {
      type: 'callExternal';
      service: string;
      method?: string;
      path: string;
      body?: unknown;
    }
  | {
      type: 'callApi';
      apiRef: string;
      method?: string;
      request?: unknown;
      body?: unknown;
      to?: string;
    }
  | {
      type: 'api';
      apiRef: string;
      method?: string;
      requestMapping?: unknown;
      responseMapping?: {
        data?: Record<string, string>;
        external?: Record<string, string>;
        snapshot?: Record<string, string>;
        status?: string;
      } & Record<string, unknown>;
      successMessage?: string;
      failureMessage?: string;
    }
  | {
      type: 'macro';
      ref?: string;
      name?: string;
      params?: Record<string, unknown>;
    };

export type ActionDefinition =
  | { type: 'composite'; steps: ActionStep[] }
  | { steps: ActionStep[] }
  | ActionStep;

type SystemActionStep = Extract<ActionStep, { type: 'setStatus' | 'system' }>;
type TemplateActionStep = Extract<ActionStep, { type: 'setField' | 'requireField' | 'require' | 'write' | 'message' }>;
type ApiActionStep = Extract<ActionStep, { type: 'callExternal' | 'callApi' | 'api' }>;

export type ActionExecutionResult = {
  status: string;
  message?: string;
  dataJson: Record<string, unknown>;
  externalRefsJson: Record<string, unknown>;
  snapshotsJson: Record<string, unknown>;
  macroLogs?: Array<{
    ref: string;
    patchKeys: {
      data: string[];
      external: string[];
      snapshot: string[];
      status?: string;
    };
  }>;
};

export class ExternalCallError extends Error {
  status: number;
  service: string;
  method: string;
  path: string;
  detail: string;

  constructor(params: {
    status: number;
    service: string;
    method: string;
    path: string;
    detail?: string;
  }) {
    const detailText = params.detail ? `: ${params.detail}` : '';
    super(`External call failed (${params.status}) ${params.method} ${params.path}${detailText}`);
    this.name = 'ExternalCallError';
    this.status = params.status;
    this.service = params.service;
    this.method = params.method;
    this.path = params.path;
    this.detail = params.detail ?? '';
  }
}

const interpolationRegex = /\{\{\s*([^}]+)\s*\}\}/g;

function getScopedPathValue(source: Record<string, unknown>, path: string) {
  const segments = String(path)
    .split('.')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (segments.length === 0) return undefined;
  let current: unknown = source;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function resolveToken(token: string, context: ActionContext) {
  const [scope, ...rest] = token.split('.');
  const key = rest.join('.');

  if (!scope || !key) {
    throw new Error(`Invalid interpolation token: ${token}`);
  }

  const source =
    scope === 'doc'
      ? context.doc
      : scope === 'data'
        ? context.data
        : scope === 'external'
          ? context.external
          : scope === 'snapshot'
            ? context.snapshot
            : scope === 'vars'
              ? context.vars
            : undefined;

  if (!source) {
    throw new Error(`Unsupported interpolation scope: ${scope}`);
  }

  const value = getScopedPathValue(source as Record<string, unknown>, key);
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing interpolation value for ${token}`);
  }

  return String(value);
}

export function interpolateString(template: string, context: ActionContext) {
  return template.replace(interpolationRegex, (_match, rawToken: string) => {
    const token = rawToken.trim();
    return resolveToken(token, context);
  });
}

export function interpolateValue(value: unknown, context: ActionContext): unknown {
  if (typeof value === 'string') {
    return interpolateString(value, context);
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolateValue(item, context));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, val]) => [
      key,
      interpolateValue(val, context)
    ]);
    return Object.fromEntries(entries);
  }

  return value;
}

function normalizeSteps(actionDef: ActionDefinition): ActionStep[] {
  if ((actionDef as { type?: string }).type === 'composite' && Array.isArray((actionDef as any).steps)) {
    return (actionDef as any).steps;
  }

  if (Array.isArray((actionDef as any).steps)) {
    return (actionDef as any).steps;
  }

  return [actionDef as ActionStep];
}

function resolveActionStepDomain(step: ActionStep): 'system' | 'template' | 'api' | 'legacy-macro' {
  if (step.type === 'setStatus' || step.type === 'system') return 'system';
  if (
    step.type === 'setField' ||
    step.type === 'requireField' ||
    step.type === 'require' ||
    step.type === 'write' ||
    step.type === 'message'
  ) {
    return 'template';
  }
  if (step.type === 'callExternal' || step.type === 'callApi' || step.type === 'api') return 'api';
  return 'legacy-macro';
}

async function resolveApiInvocation(
  step: ApiActionStep,
  context: ActionContext,
  runtimeDb?: unknown
):
  | {
      source: 'template-api';
      service: string;
      method: string;
      path: string;
      body: unknown;
      baseUrl?: string;
    }
  | {
      source: 'legacy-external';
      service: string;
      method: string;
      path: string;
      body: unknown;
    } {
  if (step.type === 'callApi' || step.type === 'api') {
    const entry = await resolveApiCatalogEntry(step.apiRef, runtimeDb);
    const requestBody = step.type === 'api' ? step.requestMapping : (step.request ?? step.body);
    return {
      source: 'template-api',
      service: entry.serviceKey,
      method: (step.method ?? entry.method).toUpperCase(),
      path: interpolateString(entry.path, context),
      body: requestBody,
      baseUrl: entry.baseUrl
    };
  }

  return {
    source: 'legacy-external',
    service: step.service,
    method: (step.method ?? 'POST').toUpperCase(),
    path: interpolateString(step.path, context),
    body: step.body
  };
}

async function executeApiAction(
  step: ApiActionStep,
  context: ActionContext,
  erpBaseUrl: string,
  fetchImpl: typeof fetch,
  initialDocStatus: string,
  runtimeDb?: unknown
) {
  const invocation = await resolveApiInvocation(step, context, runtimeDb);
  const method = invocation.method;
  const path = invocation.path;
  if (invocation.service === 'custom' && !invocation.baseUrl) {
    throw new Error('API base_url is required for custom apiRef');
  }
  const baseUrl = invocation.baseUrl ?? resolveApiBaseUrl(invocation.service, erpBaseUrl);
  const url = new URL(path, baseUrl).toString();

  const hasBody = invocation.body !== undefined && method !== 'GET' && method !== 'HEAD';
  const interpolatedBody = hasBody ? interpolateValue(invocation.body, context) : undefined;
  const normalizedBody = normalizeCustomerOrderPatchBody({
    method,
    path,
    body: interpolatedBody,
    initialDocStatus
  });

  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {})
    },
    ...(hasBody ? { body: JSON.stringify(normalizedBody) } : {})
  });

  const contentType = response.headers.get('content-type') ?? '';
  const raw = await response.text();

  if (!response.ok) {
    const configuredFailureMessage =
      step.type === 'api' && typeof step.failureMessage === 'string' && step.failureMessage.trim().length > 0
        ? step.failureMessage.trim()
        : '';
    if (configuredFailureMessage) {
      throw new Error(configuredFailureMessage);
    }
    throw new ExternalCallError({
      status: response.status,
      service: invocation.service,
      method,
      path,
      detail: raw.slice(0, 200)
    });
  }

  const responsePayload =
    raw && contentType.includes('application/json') ? (JSON.parse(raw) as Record<string, unknown>) : undefined;

  const patch: {
    dataJson?: Record<string, unknown>;
    externalRefsJson?: Record<string, unknown>;
    snapshotsJson?: Record<string, unknown>;
    status?: string;
  } = {};

  if (step.type === 'api' && responsePayload && step.responseMapping && typeof step.responseMapping === 'object') {
    const mappedPatch = applyApiResponseMapping(step.responseMapping, responsePayload);
    if (Object.keys(mappedPatch.dataJson).length > 0) patch.dataJson = mappedPatch.dataJson;
    if (Object.keys(mappedPatch.externalRefsJson).length > 0) patch.externalRefsJson = mappedPatch.externalRefsJson;
    if (Object.keys(mappedPatch.snapshotsJson).length > 0) patch.snapshotsJson = mappedPatch.snapshotsJson;
    if (typeof mappedPatch.status === 'string' && mappedPatch.status.trim().length > 0) {
      patch.status = mappedPatch.status;
    }
  }

  const message =
    step.type === 'api' && typeof step.successMessage === 'string' && step.successMessage.trim().length > 0
      ? interpolateResponseString(step.successMessage, responsePayload ?? {})
      : undefined;

  console.info('[fp] api action executed', {
    source: invocation.source,
    service: invocation.service,
    method,
    path
  });

  return {
    ...(message ? { message } : {}),
    patch,
    responsePayload
  };
}

function getPathValue(record: Record<string, unknown>, path: string): unknown {
  return getScopedPathValue(record, path);
}

function resolveMappingValue(mappingValue: string, responsePayload: Record<string, unknown>) {
  const trimmed = mappingValue.trim();
  if (trimmed.length === 0) return '';
  if (trimmed.includes('{{')) {
    return interpolateResponseString(trimmed, responsePayload);
  }
  const byPath = getPathValue(responsePayload, trimmed);
  if (byPath !== undefined) return byPath;
  return trimmed;
}

function applyApiMappingScope(
  mapping: Record<string, string> | undefined,
  responsePayload: Record<string, unknown>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (!mapping || typeof mapping !== 'object') return patch;
  for (const [targetKey, sourcePath] of Object.entries(mapping)) {
    if (typeof sourcePath !== 'string' || sourcePath.trim().length === 0) continue;
    const value = resolveMappingValue(sourcePath, responsePayload);
    patch[targetKey] = value;
  }
  return patch;
}

function applyApiResponseMapping(mapping: Record<string, unknown>, responsePayload: Record<string, unknown>) {
  const patch = {
    dataJson: {} as Record<string, unknown>,
    externalRefsJson: {} as Record<string, unknown>,
    snapshotsJson: {} as Record<string, unknown>,
    status: undefined as string | undefined
  };

  const scopedDataPatch = applyApiMappingScope(mapping.data as Record<string, string> | undefined, responsePayload);
  const scopedExternalPatch = applyApiMappingScope(mapping.external as Record<string, string> | undefined, responsePayload);
  const scopedSnapshotPatch = applyApiMappingScope(mapping.snapshot as Record<string, string> | undefined, responsePayload);
  Object.assign(patch.dataJson, scopedDataPatch);
  Object.assign(patch.externalRefsJson, scopedExternalPatch);
  Object.assign(patch.snapshotsJson, scopedSnapshotPatch);
  if (typeof mapping.status === 'string' && mapping.status.trim().length > 0) {
    patch.status = String(resolveMappingValue(mapping.status, responsePayload));
  }

  for (const [targetPath, sourcePath] of Object.entries(mapping)) {
    if (targetPath === 'data' || targetPath === 'external' || targetPath === 'snapshot' || targetPath === 'status') {
      continue;
    }
    if (typeof sourcePath !== 'string') continue;
    const value = resolveMappingValue(sourcePath, responsePayload);
    if (targetPath.startsWith('data.')) {
      patch.dataJson[targetPath.slice('data.'.length)] = value;
      continue;
    }
    if (targetPath.startsWith('external.')) {
      patch.externalRefsJson[targetPath.slice('external.'.length)] = value;
      continue;
    }
    if (targetPath.startsWith('snapshot.')) {
      patch.snapshotsJson[targetPath.slice('snapshot.'.length)] = value;
      continue;
    }
    if (targetPath === 'status') {
      patch.status = String(value);
    }
  }

  return patch;
}

function interpolateResponseString(template: string, responsePayload: Record<string, unknown>) {
  return template.replace(interpolationRegex, (_match, rawToken: string) => {
    const token = rawToken.trim();
    if (!token.startsWith('response.')) {
      return `{{${token}}}`;
    }
    const value = getPathValue(responsePayload, token.slice('response.'.length));
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

function toErpCustomerOrderStatus(value: unknown): 'received' | 'offer_created' | 'completed' | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();

  if (normalized === 'received' || normalized === 'assigned' || normalized === 'started' || normalized === 'draft') {
    return 'received';
  }
  if (normalized === 'offer_created' || normalized === 'submitted') {
    return 'offer_created';
  }
  if (normalized === 'completed' || normalized === 'approved' || normalized === 'rejected') {
    return 'completed';
  }

  return undefined;
}

function statusRank(status: 'received' | 'offer_created' | 'completed') {
  return status === 'received' ? 0 : status === 'offer_created' ? 1 : 2;
}

function normalizeCustomerOrderPatchBody(params: {
  method: string;
  path: string;
  body: unknown;
  initialDocStatus: string;
}) {
  const isCustomerOrderStatusPatch =
    params.method === 'PATCH' && /^\/api\/customer-orders\/[^/]+\/status$/.test(params.path);

  if (!isCustomerOrderStatusPatch || !params.body || typeof params.body !== 'object') {
    return params.body;
  }

  const nextBody = { ...(params.body as Record<string, unknown>) };
  const requested = toErpCustomerOrderStatus(nextBody.status);
  const current = toErpCustomerOrderStatus(params.initialDocStatus) ?? 'received';

  if (!requested) {
    return nextBody;
  }

  const currentRank = statusRank(current);
  const requestedRank = statusRank(requested);
  const normalizedRank = requestedRank > currentRank + 1 ? currentRank + 1 : requestedRank;
  nextBody.status = normalizedRank === 0 ? 'received' : normalizedRank === 1 ? 'offer_created' : 'completed';

  return nextBody;
}

function resolveScopedValue(actionContext: ActionContext, from: string) {
  const [scope, ...rest] = String(from)
    .trim()
    .split('.');
  const path = rest.join('.');
  if (!scope || !path) return undefined;

  const source =
    scope === 'data'
      ? actionContext.data
      : scope === 'external'
        ? actionContext.external
        : scope === 'snapshot'
          ? actionContext.snapshot
          : scope === 'doc'
            ? (actionContext.doc as unknown as Record<string, unknown>)
            : scope === 'vars'
              ? actionContext.vars
              : undefined;
  if (!source) return undefined;
  return getPathValue(source, path);
}

function writeScopedValue(actionContext: ActionContext, to: string, value: unknown) {
  const [scope, ...rest] = String(to)
    .trim()
    .split('.');
  const path = rest.join('.');
  if (!scope) {
    throw new Error(`Invalid write target: ${to}`);
  }
  if (scope === 'status' && rest.length === 0) {
    actionContext.doc.status = normalizeDocumentStatus(value);
    return;
  }
  if (!path) {
    throw new Error(`Invalid write target: ${to}`);
  }

  const target =
    scope === 'data'
      ? actionContext.data
      : scope === 'external'
        ? actionContext.external
        : scope === 'snapshot'
          ? actionContext.snapshot
          : scope === 'vars'
            ? actionContext.vars
            : undefined;
  if (!target) {
    throw new Error(`Unsupported write scope: ${scope}`);
  }

  const segments = path.split('.').filter((item) => item.length > 0);
  let current: Record<string, unknown> = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const next = current[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      const created: Record<string, unknown> = {};
      current[segment] = created;
      current = created;
      continue;
    }
    current = next as Record<string, unknown>;
  }
  current[segments[segments.length - 1]] = value;
}

function executeSystemAction(step: SystemActionStep, actionContext: ActionContext) {
  if (step.type === 'system') {
    const action = String(step.action ?? '').trim();
    if (action === 'setStatus') {
      const nextStatus = step.to ?? step.status;
      if (!nextStatus) {
        throw new Error('system.setStatus is missing "to"');
      }
      const normalizedStatus = normalizeDocumentStatus(nextStatus);
      actionContext.doc.status = normalizedStatus;
      return { status: normalizedStatus };
    }
    if (action === 'showMessage') {
      const message = String(step.message ?? '').trim();
      return message.length > 0 ? { message } : {};
    }
    if (action === 'requireValue') {
      const from = typeof step.from === 'string' ? step.from.trim() : '';
      if (!from) {
        throw new Error('system.requireValue is missing "from"');
      }
      const value = resolveScopedValue(actionContext, from);
      const missing = value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0);
      if (missing) {
        throw new Error(step.message || `Missing required value: ${from}`);
      }
      return {};
    }
    return {};
  }

  const to = step.to ?? step.status;
  if (!to) {
    throw new Error('setStatus step is missing "to"');
  }
  const normalizedStatus = normalizeDocumentStatus(to);
  actionContext.doc.status = normalizedStatus;
  return { status: normalizedStatus };
}

function applyTemplateActionStep(step: TemplateActionStep, actionContext: ActionContext) {
  if (step.type === 'setField') {
    if (!step.key) {
      throw new Error('setField step is missing "key"');
    }
    actionContext.data[step.key] = interpolateValue(step.value, actionContext);
    return {};
  }

  if (step.type === 'require') {
    const from = typeof step.from === 'string' ? step.from.trim() : '';
    if (!from) {
      throw new Error('require step is missing "from"');
    }
    const value = resolveScopedValue(actionContext, from);
    const missing = value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0);
    if (missing) {
      throw new Error(step.message || `Missing required value: ${from}`);
    }
    return {};
  }

  if (step.type === 'write') {
    const to = typeof step.to === 'string' ? step.to.trim() : '';
    if (!to) {
      throw new Error('write step is missing "to"');
    }
    const resolved = interpolateValue(step.value, actionContext);
    writeScopedValue(actionContext, to, resolved);
    return {};
  }

  if (step.type === 'message') {
    const resolved = interpolateValue(step.value, actionContext);
    const message = String(resolved ?? '').trim();
    return message.length > 0 ? { message } : {};
  }

  if (!step.key) {
    throw new Error('requireField step is missing "key"');
  }
  const value = actionContext.data[step.key];
  const missing = value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0);
  if (missing) {
    throw new Error(step.message || `Missing required field: ${step.key}`);
  }
  return {};
}

function applyMacroResult(
  result: MacroResult | void,
  nextData: Record<string, unknown>,
  nextExternal: Record<string, unknown>,
  nextSnapshot: Record<string, unknown>
) {
  if (!result) return;

  if (result.dataJson) {
    Object.assign(nextData, result.dataJson);
  }
  if (result.externalRefsJson) {
    Object.assign(nextExternal, result.externalRefsJson);
  }
  if (result.snapshotsJson) {
    Object.assign(nextSnapshot, result.snapshotsJson);
  }
}

function applyMacroPatch(
  patch: MacroPatchContext,
  nextData: Record<string, unknown>,
  nextExternal: Record<string, unknown>,
  nextSnapshot: Record<string, unknown>
) {
  Object.assign(nextData, patch.dataJson);
  Object.assign(nextExternal, patch.externalRefsJson);
  Object.assign(nextSnapshot, patch.snapshotsJson);
}

function resolveMacroRef(step: Extract<ActionStep, { type: 'macro' }>) {
  if (typeof step.ref === 'string' && step.ref.trim().length > 0) {
    return step.ref.trim();
  }
  const legacyName = typeof step.name === 'string' ? step.name.trim() : '';
  if (legacyName.length > 0 && macroLegacyNameToRef[legacyName]) {
    return macroLegacyNameToRef[legacyName];
  }
  return legacyName.length > 0 ? `macro:legacy/${legacyName}@1` : '';
}

type MacroCatalogRow = {
  ref: string;
  isEnabled: boolean;
  kind: string | null;
  definitionJson: unknown;
  paramsSchemaJson: unknown;
};

function extractMacroParamDefaults(paramsSchemaJson: unknown) {
  if (!paramsSchemaJson || typeof paramsSchemaJson !== 'object') return {} as Record<string, unknown>;
  const schema = paramsSchemaJson as Record<string, unknown>;
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object') return {} as Record<string, unknown>;
  const defaults: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    if (Object.prototype.hasOwnProperty.call(value, 'default')) {
      defaults[key] = (value as Record<string, unknown>).default;
    }
  }
  return defaults;
}

async function loadMacroCatalogRow(db: unknown, ref: string): Promise<MacroCatalogRow> {
  const runtimeDb = db as { select?: (...args: unknown[]) => any } | null | undefined;
  if (!runtimeDb || typeof runtimeDb !== 'object' || typeof runtimeDb.select !== 'function') {
    throw new Error('Action runtime database is not configured');
  }

  let rows: MacroCatalogRow[];
  try {
    rows = (await runtimeDb
      .select({
        ref: fpMacros.ref,
        isEnabled: fpMacros.isEnabled,
        kind: fpMacros.kind,
        definitionJson: fpMacros.definitionJson,
        paramsSchemaJson: fpMacros.paramsSchemaJson
      })
      .from(fpMacros)
      .where(eq(fpMacros.ref, ref))
      .limit(1)) as MacroCatalogRow[];
  } catch (error) {
    throw new Error('Action runtime database is not configured');
  }

  const row = rows[0];
  if (!row) {
    console.info('[fp] macro catalog lookup', { macroRef: ref, found: false, enabled: false });
    throw new Error(`Macro not found in catalog: ${ref}`);
  }

  if (!row.isEnabled) {
    console.info('[fp] macro catalog lookup', { macroRef: ref, found: true, enabled: false });
    throw new Error(`Macro not enabled: ${ref}`);
  }

  console.info('[fp] macro catalog lookup', { macroRef: ref, found: true, enabled: true });
  return row;
}

async function executeLegacyMacroAction(params: {
  step: Extract<ActionStep, { type: 'macro' }>;
  context: ActionContext;
  erpBaseUrl: string;
  fetchImpl: typeof fetch;
  macroContext?: {
    db: unknown;
    templateJson: unknown;
    templateDefinition?: {
      fullSchema?: unknown;
      template?: unknown;
    };
    schema?: unknown;
    document: { id: string; status: string };
    form?: Record<string, unknown>;
  };
  onMacroEvent?: (event: {
    macroRef: string;
    namespace: string;
    name: string;
    version: number | null;
    source?: 'db-json' | 'builtin-fallback';
    outcome: 'success' | 'error';
    errorMessage?: string;
  }) => void;
}) {
  const macroRef = resolveMacroRef(params.step);
  if (!macroRef) {
    throw new Error('Macro step requires ref (or legacy name).');
  }
  const runtimeDb = params.macroContext?.db as { select?: unknown; query?: unknown } | undefined;
  console.info('[fp] action macro runtime db', {
    macroRef,
    dbType: typeof runtimeDb,
    dbExists: !!runtimeDb,
    hasSelect: typeof runtimeDb?.select === 'function',
    hasQuery: !!runtimeDb?.query
  });
  const macroRow = await loadMacroCatalogRow(params.macroContext?.db, macroRef);
  const parsed = /^macro:([^/]+)\/([^@]+)@(\d+)$/.exec(macroRef);
  const macroNamespace = parsed?.[1] ?? 'unknown';
  const macroName = parsed?.[2] ?? macroRef;
  const macroVersion = parsed?.[3] ? Number(parsed[3]) : null;

  const macroPatch: MacroPatchContext = {
    dataJson: {},
    externalRefsJson: {},
    snapshotsJson: {}
  };
  const erpPost = async <T = unknown>(path: string, body: unknown) => {
    const url = new URL(path, params.erpBaseUrl).toString();
    const response = await params.fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body ?? {})
    });
    const raw = await response.text();
    if (!response.ok) {
      let detail = raw.slice(0, 200);
      try {
        const parsed = JSON.parse(raw) as { message?: unknown };
        if (typeof parsed.message === 'string' && parsed.message.trim().length > 0) {
          detail = parsed.message;
        }
      } catch {
        // keep detail fallback
      }
      throw new Error(`Macro ${macroRef} failed (${response.status}): ${detail}`);
    }
    if (!raw) return {} as T;
    return JSON.parse(raw) as T;
  };

  const macroCtx: MacroCtx = {
    db: params.macroContext?.db,
    doc: {
      id: params.macroContext?.document.id ?? params.context.doc.id,
      status: params.context.doc.status
    },
    template: params.macroContext?.templateJson,
    templateDefinition: params.macroContext?.templateDefinition,
    schema: params.macroContext?.schema,
    data: {
      get: (key: string) => params.context.data[key]
    },
    external: {
      get: (key: string) => params.context.external[key]
    },
    snapshot: {
      get: (key: string) => params.context.snapshot[key]
    },
    patch: {
      data: (key: string, value: unknown) => {
        macroPatch.dataJson[key] = value;
      },
      external: (key: string, value: unknown) => {
        macroPatch.externalRefsJson[key] = value;
      },
      snapshot: (key: string, value: unknown) => {
        macroPatch.snapshotsJson[key] = value;
      },
      status: (status: string) => {
        macroPatch.status = status;
      }
    },
    http: {
      erp: {
        post: erpPost
      }
    },
    dataJson: params.context.data,
    externalRefsJson: params.context.external,
    snapshotsJson: params.context.snapshot,
    form: params.macroContext?.form
  };

  const hasDbJsonDefinition =
    String(macroRow.kind ?? '').trim().toLowerCase() === 'json' &&
    !!macroRow.definitionJson &&
    typeof macroRow.definitionJson === 'object';
  const builtInMacro = macroRegistryByRef[macroRef];
  const macroSource: 'db-json' | 'builtin-fallback' = hasDbJsonDefinition ? 'db-json' : 'builtin-fallback';
  if (!hasDbJsonDefinition && !builtInMacro) {
    throw new Error(`Macro ref not implemented: ${macroRef}`);
  }

  console.info('[fp] macro execution source', { macroRef, source: macroSource });

  let macroResult: MacroResult | void;
  try {
    const macroDefaultParams = extractMacroParamDefaults(macroRow.paramsSchemaJson);
    const macroRuntimeParams = {
      ...macroDefaultParams,
      ...((params.step.params ?? {}) as Record<string, unknown>)
    };
    macroResult = hasDbJsonDefinition
      ? await executeJsonMacroDefinition(macroRow.definitionJson, macroCtx, macroRuntimeParams)
      : await builtInMacro!(macroCtx, macroRuntimeParams);
  } catch (error) {
    params.onMacroEvent?.({
      macroRef,
      namespace: macroNamespace,
      name: macroName,
      version: macroVersion,
      source: macroSource,
      outcome: 'error',
      errorMessage: error instanceof Error ? error.message : 'Macro execution failed'
    });
    throw error;
  }

  params.onMacroEvent?.({
    macroRef,
    namespace: macroNamespace,
    name: macroName,
    version: macroVersion,
    source: macroSource,
    outcome: 'success'
  });

  return {
    macroRef,
    macroPatch,
    macroResult,
    macroSource
  };
}

async function executeCompositeAction(params: {
  actionDef: ActionDefinition;
  context: ActionContext;
  erpBaseUrl: string;
  fetchImpl?: typeof fetch;
  macroContext?: {
    db: unknown;
    templateJson: unknown;
    templateDefinition?: {
      fullSchema?: unknown;
      template?: unknown;
    };
    schema?: unknown;
    document: { id: string; status: string };
    form?: Record<string, unknown>;
  };
  onMacroEvent?: (event: {
    macroRef: string;
    namespace: string;
    name: string;
    version: number | null;
    source?: 'db-json' | 'builtin-fallback';
    outcome: 'success' | 'error';
    errorMessage?: string;
  }) => void;
}): Promise<ActionExecutionResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const nextData = { ...params.context.data };
  const nextExternal = { ...params.context.external };
  const nextSnapshot = { ...params.context.snapshot };
  const macroLogs: NonNullable<ActionExecutionResult['macroLogs']> = [];
  let nextStatus = params.context.doc.status;
  let resultMessage: string | undefined;

  const actionContext: ActionContext = {
    doc: { id: params.context.doc.id, status: nextStatus },
    data: nextData,
    external: nextExternal,
    snapshot: nextSnapshot,
    vars: {}
  };

  // Transition architecture:
  // - target: template/system/api actions
  // - legacy bridge: macro steps remain supported until templates migrate
  for (const step of normalizeSteps(params.actionDef)) {
    const domain = resolveActionStepDomain(step);

    if (domain === 'system') {
      const systemResult = executeSystemAction(step as SystemActionStep, actionContext);
      nextStatus = actionContext.doc.status;
      if (typeof systemResult?.message === 'string' && systemResult.message.trim().length > 0) {
        resultMessage = systemResult.message.trim();
      }
      continue;
    }

    if (domain === 'template') {
      const templateResult = applyTemplateActionStep(step as TemplateActionStep, actionContext);
      if (typeof templateResult?.message === 'string' && templateResult.message.trim().length > 0) {
        resultMessage = templateResult.message.trim();
      }
      continue;
    }

    if (domain === 'api') {
      const apiResult = await executeApiAction(
        step as ApiActionStep,
        actionContext,
        params.erpBaseUrl,
        fetchImpl,
        params.context.doc.status,
        params.macroContext?.db
      );
      if (apiResult?.patch?.dataJson) Object.assign(nextData, apiResult.patch.dataJson);
      if (apiResult?.patch?.externalRefsJson) Object.assign(nextExternal, apiResult.patch.externalRefsJson);
      if (apiResult?.patch?.snapshotsJson) Object.assign(nextSnapshot, apiResult.patch.snapshotsJson);
      if (typeof apiResult?.patch?.status === 'string' && apiResult.patch.status.trim().length > 0) {
        nextStatus = normalizeDocumentStatus(apiResult.patch.status);
        actionContext.doc.status = nextStatus;
      }
      if (typeof apiResult?.message === 'string' && apiResult.message.trim().length > 0) {
        resultMessage = apiResult.message.trim();
      }
      if (
        step.type === 'callApi' &&
        typeof step.to === 'string' &&
        step.to.trim().length > 0 &&
        apiResult?.responsePayload
      ) {
        writeScopedValue(actionContext, step.to.trim(), apiResult.responsePayload);
      }
      continue;
    }

    if (domain === 'legacy-macro' && step.type === 'macro') {
      const legacyMacroResult = await executeLegacyMacroAction({
        step,
        context: actionContext,
        erpBaseUrl: params.erpBaseUrl,
        fetchImpl,
        macroContext: params.macroContext,
        onMacroEvent: params.onMacroEvent
      });
      const macroRef = legacyMacroResult.macroRef;
      const macroPatch = legacyMacroResult.macroPatch;
      const macroResult = legacyMacroResult.macroResult;

      applyMacroPatch(macroPatch, nextData, nextExternal, nextSnapshot);
      applyMacroResult(macroResult, nextData, nextExternal, nextSnapshot);
      if (typeof macroResult?.message === 'string' && macroResult.message.trim().length > 0) {
        resultMessage = macroResult.message.trim();
      }
      macroLogs.push({
        ref: macroRef,
        patchKeys: {
          data: Object.keys(macroPatch.dataJson),
          external: Object.keys(macroPatch.externalRefsJson),
          snapshot: Object.keys(macroPatch.snapshotsJson),
          ...(macroPatch.status ? { status: macroPatch.status } : {})
        }
      });

      if (macroPatch.status) {
        nextStatus = normalizeDocumentStatus(macroPatch.status);
        actionContext.doc.status = nextStatus;
      }
      if (macroResult?.status) {
        nextStatus = normalizeDocumentStatus(macroResult.status);
        actionContext.doc.status = nextStatus;
      }

      continue;
    }

    throw new Error(`Unsupported action step type: ${(step as { type?: string }).type ?? 'unknown'}`);
  }

  return {
    status: normalizeDocumentStatus(nextStatus),
    ...(resultMessage ? { message: resultMessage } : {}),
    dataJson: nextData,
    externalRefsJson: nextExternal,
    snapshotsJson: nextSnapshot,
    macroLogs
  };
}

export async function executeActionDefinition(params: {
  actionDef: ActionDefinition;
  context: ActionContext;
  erpBaseUrl: string;
  fetchImpl?: typeof fetch;
  macroContext?: {
    db: unknown;
    templateJson: unknown;
    templateDefinition?: {
      fullSchema?: unknown;
      template?: unknown;
    };
    schema?: unknown;
    document: { id: string; status: string };
    form?: Record<string, unknown>;
  };
  onMacroEvent?: (event: {
    macroRef: string;
    namespace: string;
    name: string;
    version: number | null;
    source?: 'db-json' | 'builtin-fallback';
    outcome: 'success' | 'error';
    errorMessage?: string;
  }) => void;
}): Promise<ActionExecutionResult> {
  // Primary execution path is now explicit and action-centric:
  // system -> api -> composite step orchestration.
  // Legacy macro actions remain supported as a compatibility bridge.
  return executeCompositeAction(params);
}
