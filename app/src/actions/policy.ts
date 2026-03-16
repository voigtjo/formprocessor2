export function normalizeActionSteps(actionDef: unknown): Array<Record<string, unknown>> {
  if (!actionDef || typeof actionDef !== 'object') return [];
  const def = actionDef as Record<string, unknown>;
  const nestedSteps = def.steps;
  if (Array.isArray(nestedSteps)) {
    return nestedSteps.filter((step): step is Record<string, unknown> => !!step && typeof step === 'object');
  }
  return [def];
}

export function resolveActionType(actionDef: unknown): 'system' | 'macro' | 'api' | 'composite' | 'unknown' {
  if (!actionDef || typeof actionDef !== 'object') return 'unknown';
  const def = actionDef as Record<string, unknown>;
  if (def.type === 'system') return 'system';
  if (def.type === 'macro') return 'macro';
  if (def.type === 'api' || def.type === 'callApi') return 'api';
  if (def.type === 'composite' || Array.isArray(def.steps)) return 'composite';
  return 'unknown';
}

export function isUiSafeActionDefinition(actionDef: unknown) {
  const steps = normalizeActionSteps(actionDef);
  if (steps.length === 0) return false;
  return steps.every((step) =>
    [
      'macro',
      'api',
      'callApi',
      'require',
      'write',
      'message',
      'requireField',
      'setField'
    ].includes(String(step.type ?? ''))
  );
}

export function collectMacroRefsFromActionDefinition(actionDef: unknown) {
  const refs = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    if (record.type === 'macro' && typeof record.ref === 'string' && record.ref.trim().length > 0) {
      refs.add(record.ref.trim());
    }
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(actionDef);
  return Array.from(refs);
}
