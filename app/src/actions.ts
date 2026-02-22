export type ActionContext = {
  doc: { id: string; status: string };
  data: Record<string, unknown>;
  external: Record<string, unknown>;
  snapshot: Record<string, unknown>;
};

export type ActionStep =
  | { type: 'setStatus'; to?: string; status?: string }
  | { type: 'setField'; key: string; value: unknown }
  | {
      type: 'callExternal';
      service: string;
      method?: string;
      path: string;
      body?: unknown;
    };

export type ActionDefinition =
  | { type: 'composite'; steps: ActionStep[] }
  | { steps: ActionStep[] }
  | ActionStep;

export type ActionExecutionResult = {
  status: string;
  dataJson: Record<string, unknown>;
};

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
  fetchImpl: typeof fetch
) {
  if (step.service !== 'erp-sim') {
    throw new Error(`Unsupported external service: ${step.service}`);
  }

  const method = (step.method ?? 'POST').toUpperCase();
  const path = interpolateString(step.path, context);
  const url = new URL(path, erpBaseUrl).toString();

  const hasBody = step.body !== undefined && method !== 'GET' && method !== 'HEAD';
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {})
    },
    ...(hasBody ? { body: JSON.stringify(interpolateValue(step.body, context)) } : {})
  });

  const contentType = response.headers.get('content-type') ?? '';
  const raw = await response.text();

  if (!response.ok) {
    const detail = raw ? `: ${raw.slice(0, 200)}` : '';
    throw new Error(`External call failed (${response.status}) ${method} ${path}${detail}`);
  }

  if (!raw) return;
  if (contentType.includes('application/json')) {
    JSON.parse(raw);
  }
}

export async function executeActionDefinition(params: {
  actionDef: ActionDefinition;
  context: ActionContext;
  erpBaseUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<ActionExecutionResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const nextData = { ...params.context.data };
  let nextStatus = params.context.doc.status;

  const actionContext: ActionContext = {
    doc: { id: params.context.doc.id, status: nextStatus },
    data: nextData,
    external: params.context.external,
    snapshot: params.context.snapshot
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

    if (step.type === 'callExternal') {
      await callExternalStep(step, actionContext, params.erpBaseUrl, fetchImpl);
      continue;
    }

    throw new Error(`Unsupported action step type: ${(step as { type?: string }).type ?? 'unknown'}`);
  }

  return {
    status: nextStatus,
    dataJson: nextData
  };
}
