import { eq } from 'drizzle-orm';
import { fpMacros } from '../db/schema.js';
import {
  macroLegacyNameToRef,
  macroRegistryByRef,
  type MacroCtx,
  type MacroPatchContext,
  type MacroResult
} from './macros/index.js';

export type ActionContext = {
  doc: { id: string; status: string };
  data: Record<string, unknown>;
  external: Record<string, unknown>;
  snapshot: Record<string, unknown>;
};

export type ActionStep =
  | { type: 'setStatus'; to?: string; status?: string }
  | { type: 'setField'; key: string; value: unknown }
  | { type: 'requireField'; key: string; message?: string }
  | {
      type: 'callExternal';
      service: string;
      method?: string;
      path: string;
      body?: unknown;
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

export type ActionExecutionResult = {
  status: string;
  dataJson: Record<string, unknown>;
  externalRefsJson: Record<string, unknown>;
  snapshotsJson: Record<string, unknown>;
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
            : undefined;

  if (!source) {
    throw new Error(`Unsupported interpolation scope: ${scope}`);
  }

  const value = (source as Record<string, unknown>)[key];
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

async function callExternalStep(
  step: Extract<ActionStep, { type: 'callExternal' }>,
  context: ActionContext,
  erpBaseUrl: string,
  fetchImpl: typeof fetch,
  initialDocStatus: string
) {
  if (step.service !== 'erp-sim') {
    throw new Error(`Unsupported external service: ${step.service}`);
  }

  const method = (step.method ?? 'POST').toUpperCase();
  const path = interpolateString(step.path, context);
  const url = new URL(path, erpBaseUrl).toString();

  const hasBody = step.body !== undefined && method !== 'GET' && method !== 'HEAD';
  const interpolatedBody = hasBody ? interpolateValue(step.body, context) : undefined;
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
    throw new ExternalCallError({
      status: response.status,
      service: step.service,
      method,
      path,
      detail: raw.slice(0, 200)
    });
  }

  if (!raw) return;
  if (contentType.includes('application/json')) {
    JSON.parse(raw);
  }
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

async function ensureMacroIsEnabledInCatalog(db: unknown, ref: string) {
  const dbQuery = (db as { query?: { fpMacros?: { findFirst?: (args: unknown) => Promise<unknown> } } })?.query?.fpMacros
    ?.findFirst;
  if (!dbQuery) {
    throw new Error('Macro execution requires fp_macros catalog access.');
  }

  const row = (await dbQuery({ where: eq(fpMacros.ref, ref) })) as { ref?: string; isEnabled?: boolean } | undefined;
  if (!row) {
    throw new Error(`Macro ref is not registered: ${ref}`);
  }
  if (!row.isEnabled) {
    throw new Error(`Macro ref is disabled: ${ref}`);
  }
}

export async function executeActionDefinition(params: {
  actionDef: ActionDefinition;
  context: ActionContext;
  erpBaseUrl: string;
  fetchImpl?: typeof fetch;
  macroContext?: {
    db: unknown;
    templateJson: unknown;
    document: { id: string; status: string };
    form?: Record<string, unknown>;
  };
}): Promise<ActionExecutionResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const nextData = { ...params.context.data };
  const nextExternal = { ...params.context.external };
  const nextSnapshot = { ...params.context.snapshot };
  let nextStatus = params.context.doc.status;

  const actionContext: ActionContext = {
    doc: { id: params.context.doc.id, status: nextStatus },
    data: nextData,
    external: nextExternal,
    snapshot: nextSnapshot
  };

  for (const step of normalizeSteps(params.actionDef)) {
    if (step.type === 'setStatus') {
      const to = step.to ?? step.status;
      if (!to) {
        throw new Error('setStatus step is missing "to"');
      }
      nextStatus = to;
      actionContext.doc.status = nextStatus;
      continue;
    }

    if (step.type === 'setField') {
      if (!step.key) {
        throw new Error('setField step is missing "key"');
      }
      nextData[step.key] = interpolateValue(step.value, actionContext);
      continue;
    }

    if (step.type === 'requireField') {
      if (!step.key) {
        throw new Error('requireField step is missing "key"');
      }
      const value = actionContext.data[step.key];
      const missing =
        value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0);
      if (missing) {
        throw new Error(step.message || `Missing required field: ${step.key}`);
      }
      continue;
    }

    if (step.type === 'callExternal') {
      await callExternalStep(step, actionContext, params.erpBaseUrl, fetchImpl, params.context.doc.status);
      continue;
    }

    if (step.type === 'macro') {
      const macroRef = resolveMacroRef(step);
      if (!macroRef) {
        throw new Error('Macro step requires ref (or legacy name).');
      }
      await ensureMacroIsEnabledInCatalog(params.macroContext?.db, macroRef);
      const macro = macroRegistryByRef[macroRef];
      if (!macro) {
        throw new Error(`Macro ref not implemented in runtime: ${macroRef}`);
      }

      const macroPatch: MacroPatchContext = {
        dataJson: {},
        externalRefsJson: {},
        snapshotsJson: {}
      };
      const erpPost = async <T = unknown>(path: string, body: unknown) => {
        const url = new URL(path, params.erpBaseUrl).toString();
        const response = await fetchImpl(url, {
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
          status: nextStatus
        },
        template: params.macroContext?.templateJson,
        data: {
          get: (key: string) => nextData[key]
        },
        external: {
          get: (key: string) => nextExternal[key]
        },
        snapshot: {
          get: (key: string) => nextSnapshot[key]
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
        dataJson: nextData,
        externalRefsJson: nextExternal,
        snapshotsJson: nextSnapshot,
        form: params.macroContext?.form
      };

      const macroResult = await macro(macroCtx, step.params);
      applyMacroPatch(macroPatch, nextData, nextExternal, nextSnapshot);
      applyMacroResult(macroResult, nextData, nextExternal, nextSnapshot);

      if (macroPatch.status) {
        nextStatus = macroPatch.status;
        actionContext.doc.status = nextStatus;
      }
      if (macroResult?.status) {
        nextStatus = macroResult.status;
        actionContext.doc.status = nextStatus;
      }

      continue;
    }

    throw new Error(`Unsupported action step type: ${(step as { type?: string }).type ?? 'unknown'}`);
  }

  return {
    status: nextStatus,
    dataJson: nextData,
    externalRefsJson: nextExternal,
    snapshotsJson: nextSnapshot
  };
}
