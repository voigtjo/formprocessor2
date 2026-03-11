import type { MacroCtx, MacroResult } from './index.js';

type MacroScope = 'vars' | 'data' | 'external' | 'snapshot' | 'params';
type MacroReadPath = `${Exclude<MacroScope, 'params'>}.${string}` | `params.${string}`;
type MacroWritePath = `${Exclude<MacroScope, 'params'>}.${string}` | 'status';

type JsonMacroOp =
  | { op: 'read'; from: MacroReadPath | MacroReadPath[]; to: `vars.${string}` }
  | { op: 'fallback'; from: MacroReadPath; to: `vars.${string}` }
  | { op: 'write'; to: MacroWritePath; value: unknown }
  | { op: 'require'; from: MacroReadPath; message?: string }
  | { op: 'http.post'; service: 'erp'; path: string; body?: unknown; to: `vars.${string}` }
  | { op: 'http.get'; service: 'erp'; path: string; to: `vars.${string}` }
  | { op: 'message'; value: string }
  | { op: 'log'; value: string }
  | { op: 'setStatus'; to: string };

type ExecutionState = {
  vars: Record<string, unknown>;
  params: Record<string, unknown>;
  message?: string;
};

const interpolationRegex = /\{\{\s*([^}]+)\s*\}\}/g;

function isMissingValue(value: unknown) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0);
}

function parseDotPath(path: string, expectedScopes?: MacroScope[]) {
  const [scopeRaw, ...rest] = path.split('.');
  const key = rest.join('.').trim();
  const scope = scopeRaw?.trim().toLowerCase() as MacroScope | '';
  if (!scope || !key) {
    throw new Error(`Invalid path: ${path}`);
  }
  if (expectedScopes && !expectedScopes.includes(scope as MacroScope)) {
    throw new Error(`Unsupported path scope "${scope}" in ${path}`);
  }
  return { scope: scope as MacroScope, key };
}

function getNestedValue(value: unknown, path: string) {
  const parts = path.split('.').filter((item) => item.length > 0);
  let cursor: unknown = value;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function resolvePath(path: string, ctx: MacroCtx, state: ExecutionState): unknown {
  if (path === 'status') return ctx.doc.status;
  const { scope, key } = parseDotPath(path);
  if (scope === 'vars') {
    const [root, ...rest] = key.split('.');
    const rootValue = state.vars[root];
    if (rest.length === 0) return rootValue;
    return getNestedValue(rootValue, rest.join('.'));
  }
  if (scope === 'data') return ctx.data.get(key);
  if (scope === 'external') return ctx.external.get(key);
  if (scope === 'snapshot') return ctx.snapshot.get(key);
  const [root, ...rest] = key.split('.');
  const rootValue = state.params[root];
  if (rest.length === 0) return rootValue;
  return getNestedValue(rootValue, rest.join('.'));
}

function writePath(path: string, value: unknown, ctx: MacroCtx, state: ExecutionState) {
  if (path === 'status') {
    const status = String(value ?? '').trim();
    if (!status) {
      throw new Error('status must not be empty');
    }
    ctx.patch.status(status);
    return;
  }

  const { scope, key } = parseDotPath(path);
  if (scope === 'vars') {
    state.vars[key] = value;
    return;
  }
  if (scope === 'data') {
    ctx.patch.data(key, value);
    return;
  }
  if (scope === 'external') {
    ctx.patch.external(key, value);
    return;
  }
  if (scope === 'snapshot') {
    ctx.patch.snapshot(key, value);
    return;
  }
  throw new Error(`Unsupported write path: ${path}`);
}

function interpolateString(input: string, ctx: MacroCtx, state: ExecutionState) {
  return input.replace(interpolationRegex, (_match, rawToken: string) => {
    const token = rawToken.trim();
    const value = resolvePath(token, ctx, state);
    if (isMissingValue(value)) {
      throw new Error(`Missing interpolation value for ${token}`);
    }
    return String(value);
  });
}

function resolveDynamicPath(path: string, ctx: MacroCtx, state: ExecutionState) {
  if (typeof path !== 'string' || path.trim().length === 0) {
    throw new Error('Path must be a non-empty string');
  }
  if (!path.includes('{{')) {
    return path;
  }
  return interpolateString(path, ctx, state);
}

function interpolateValue(value: unknown, ctx: MacroCtx, state: ExecutionState): unknown {
  if (typeof value === 'string') {
    return interpolateString(value, ctx, state);
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateValue(item, ctx, state));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, interpolateValue(item, ctx, state)])
    );
  }
  return value;
}

function normalizeOps(definitionJson: unknown): JsonMacroOp[] {
  if (!definitionJson || typeof definitionJson !== 'object') {
    throw new Error('Macro definition_json must be an object');
  }

  const raw = definitionJson as Record<string, unknown>;
  const opsCandidate = Array.isArray(raw.ops) ? raw.ops : Array.isArray(raw.steps) ? raw.steps : [];
  if (!Array.isArray(opsCandidate)) {
    throw new Error('Macro definition_json must contain ops (array)');
  }

  return opsCandidate.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`JSON macro op #${index + 1} must be an object`);
    }
    const record = item as Record<string, unknown>;
    const op = String(record.op ?? record.type ?? '').trim();
    if (!op) {
      throw new Error(`JSON macro op #${index + 1} is missing "op"`);
    }

    if (op === 'set') {
      return {
        op: 'write',
        to: String(record.target ?? '').trim()
          ? `${String(record.target).trim()}.${String(record.key ?? '').trim()}`
          : String(record.key ?? '').trim(),
        value: record.value
      } as JsonMacroOp;
    }
    if (op === 'requireField') {
      return {
        op: 'require',
        from: `data.${String(record.key ?? '').trim()}` as MacroReadPath,
        message: typeof record.message === 'string' ? record.message : undefined
      };
    }
    if (op === 'setStatus') {
      return {
        op: 'setStatus',
        to: String(record.to ?? record.status ?? '').trim()
      };
    }

    return { ...(record as JsonMacroOp), op } as JsonMacroOp;
  });
}

function validateOp(op: JsonMacroOp, index: number) {
  const prefix = `JSON macro op #${index + 1}`;
  const allowTemplatedPath = (path: string, scopes: MacroScope[]) => {
    if (typeof path !== 'string' || path.trim().length === 0) {
      throw new Error(`${prefix}: path must be a non-empty string`);
    }
    if (path.includes('{{')) return;
    parseDotPath(path, scopes);
  };

  if (op.op === 'read') {
    const paths = Array.isArray(op.from) ? op.from : [op.from];
    if (paths.length === 0) throw new Error(`${prefix}: read.from must not be empty`);
    for (const path of paths) {
      allowTemplatedPath(path, ['data', 'external', 'snapshot', 'vars', 'params']);
    }
    allowTemplatedPath(op.to, ['vars']);
    return;
  }
  if (op.op === 'fallback') {
    allowTemplatedPath(op.from, ['data', 'external', 'snapshot', 'vars', 'params']);
    allowTemplatedPath(op.to, ['vars']);
    return;
  }
  if (op.op === 'write') {
    if (op.to !== 'status') allowTemplatedPath(op.to, ['data', 'external', 'snapshot', 'vars']);
    return;
  }
  if (op.op === 'require') {
    allowTemplatedPath(op.from, ['data', 'external', 'snapshot', 'vars', 'params']);
    return;
  }
  if (op.op === 'http.post') {
    if (op.service !== 'erp') throw new Error(`${prefix}: service must be "erp"`);
    if (!String(op.path ?? '').trim()) throw new Error(`${prefix}: path is required`);
    allowTemplatedPath(op.to, ['vars']);
    return;
  }
  if (op.op === 'http.get') {
    if (op.service !== 'erp') throw new Error(`${prefix}: service must be "erp"`);
    if (!String(op.path ?? '').trim()) throw new Error(`${prefix}: path is required`);
    allowTemplatedPath(op.to, ['vars']);
    return;
  }
  if (op.op === 'message') {
    if (!String(op.value ?? '').trim()) throw new Error(`${prefix}: value is required`);
    return;
  }
  if (op.op === 'log') {
    if (!String(op.value ?? '').trim()) throw new Error(`${prefix}: value is required`);
    return;
  }
  if (op.op === 'setStatus') {
    if (!String(op.to ?? '').trim()) throw new Error(`${prefix}: to is required`);
    return;
  }
  throw new Error(`${prefix}: unsupported op "${(op as { op: string }).op}"`);
}

export async function executeJsonMacroDefinition(
  definitionJson: unknown,
  ctx: MacroCtx,
  params?: Record<string, unknown>
): Promise<MacroResult | void> {
  if (!definitionJson || typeof definitionJson !== 'object') {
    throw new Error('Macro definition_json must be an object');
  }
  const definition = definitionJson as Record<string, unknown>;
  const ops = normalizeOps(definitionJson);
  ops.forEach((op, index) => validateOp(op, index));

  const state: ExecutionState = { vars: {}, params: { ...(params ?? {}) } };
  for (const op of ops) {
    if (op.op === 'read') {
      const fromPaths = Array.isArray(op.from) ? op.from : [op.from];
      let value: unknown = undefined;
      for (const rawPath of fromPaths) {
        const path = resolveDynamicPath(rawPath, ctx, state);
        const candidate = resolvePath(path, ctx, state);
        if (!isMissingValue(candidate)) {
          value = candidate;
          break;
        }
        if (value === undefined) value = candidate;
      }
      const toPath = resolveDynamicPath(op.to, ctx, state);
      writePath(toPath, value, ctx, state);
      continue;
    }
    if (op.op === 'fallback') {
      const toPath = resolveDynamicPath(op.to, ctx, state);
      const currentValue = resolvePath(toPath, ctx, state);
      if (isMissingValue(currentValue)) {
        const fromPath = resolveDynamicPath(op.from, ctx, state);
        const fallbackValue = resolvePath(fromPath, ctx, state);
        writePath(toPath, fallbackValue, ctx, state);
      }
      continue;
    }
    if (op.op === 'write') {
      const value = interpolateValue(op.value, ctx, state);
      const toPath = resolveDynamicPath(op.to, ctx, state);
      writePath(toPath, value, ctx, state);
      continue;
    }
    if (op.op === 'require') {
      const fromPath = resolveDynamicPath(op.from, ctx, state);
      const value = resolvePath(fromPath, ctx, state);
      if (isMissingValue(value)) {
        throw new Error(op.message || `Missing required field: ${fromPath}`);
      }
      continue;
    }
    if (op.op === 'http.post') {
      const path = String(interpolateValue(op.path, ctx, state));
      const body = interpolateValue(op.body ?? {}, ctx, state);
      const response = await ctx.http.erp.post(path, body);
      const toPath = resolveDynamicPath(op.to, ctx, state);
      writePath(toPath, response, ctx, state);
      continue;
    }
    if (op.op === 'http.get') {
      throw new Error('JSON macro op http.get is not implemented yet');
    }
    if (op.op === 'message') {
      state.message = String(interpolateValue(op.value, ctx, state));
      continue;
    }
    if (op.op === 'log') {
      const message = String(interpolateValue(op.value, ctx, state));
      console.info('[fp] json macro log', { docId: ctx.doc.id, message });
      continue;
    }
    if (op.op === 'setStatus') {
      writePath('status', interpolateValue(op.to, ctx, state), ctx, state);
    }
  }

  // Backward compatibility: support top-level set/status/message.
  if (definition.set && typeof definition.set === 'object') {
    const setBlock = definition.set as Record<string, unknown>;
    for (const [target, payload] of Object.entries(setBlock)) {
      if (!payload || typeof payload !== 'object') continue;
      for (const [key, rawValue] of Object.entries(payload as Record<string, unknown>)) {
        const value = interpolateValue(rawValue, ctx, state);
        if (target === 'data') ctx.patch.data(key, value);
        else if (target === 'external') ctx.patch.external(key, value);
        else if (target === 'snapshot') ctx.patch.snapshot(key, value);
      }
    }
  }
  if (typeof definition.status === 'string' && definition.status.trim().length > 0) {
    ctx.patch.status(String(interpolateValue(definition.status, ctx, state)));
  }
  if (typeof definition.message === 'string' && definition.message.trim().length > 0) {
    state.message = String(interpolateValue(definition.message, ctx, state));
  }

  const paramsMessage = typeof params?.message === 'string' ? params.message : '';
  const message = paramsMessage.trim() || state.message;
  if (message) return { message };
}
