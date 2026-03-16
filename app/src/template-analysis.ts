export type TemplateActionUsage = {
  actionKey: string;
  actionType: 'system' | 'api' | 'composite' | 'macro' | 'unknown';
  stepTypes: string[];
  apiRefs: string[];
  macroRefs: string[];
  hasLegacyMacro: boolean;
};

export type TemplateUsage = {
  actions: TemplateActionUsage[];
  apiRefs: string[];
  lookupApiRefs: string[];
  macroRefs: string[];
};

function normalizeActionType(actionDef: unknown): TemplateActionUsage['actionType'] {
  if (!actionDef || typeof actionDef !== 'object') return 'unknown';
  const record = actionDef as Record<string, unknown>;
  if (record.type === 'system') return 'system';
  if (record.type === 'api' || record.type === 'callApi') return 'api';
  if (record.type === 'macro') return 'macro';
  if (record.type === 'composite' || Array.isArray(record.steps)) return 'composite';
  return 'unknown';
}

function walkActionDefinition(value: unknown, usage: { apiRefs: Set<string>; macroRefs: Set<string>; stepTypes: Set<string> }) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walkActionDefinition(item, usage);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.type === 'string') {
    usage.stepTypes.add(record.type);
    if ((record.type === 'api' || record.type === 'callApi') && typeof record.apiRef === 'string') {
      const ref = record.apiRef.trim();
      if (ref.length > 0) usage.apiRefs.add(ref);
    }
    if (record.type === 'macro' && typeof record.ref === 'string') {
      const ref = record.ref.trim();
      if (ref.length > 0) usage.macroRefs.add(ref);
    }
  }
  for (const nested of Object.values(record)) {
    walkActionDefinition(nested, usage);
  }
}

export function extractTemplateUsage(templateJson: unknown): TemplateUsage {
  const root = templateJson && typeof templateJson === 'object' && !Array.isArray(templateJson)
    ? (templateJson as Record<string, unknown>)
    : {};
  const fields = root.fields && typeof root.fields === 'object' && !Array.isArray(root.fields)
    ? (root.fields as Record<string, unknown>)
    : {};
  const actions = root.actions && typeof root.actions === 'object' && !Array.isArray(root.actions)
    ? (root.actions as Record<string, unknown>)
    : {};

  const lookupApiRefs = new Set<string>();
  for (const field of Object.values(fields)) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) continue;
    const record = field as Record<string, unknown>;
    if (record.kind !== 'lookup') continue;
    if (typeof record.apiRef !== 'string') continue;
    const ref = record.apiRef.trim();
    if (ref.length > 0) lookupApiRefs.add(ref);
  }

  const actionUsage: TemplateActionUsage[] = [];
  const allApiRefs = new Set<string>(lookupApiRefs);
  const allMacroRefs = new Set<string>();

  for (const [actionKey, actionDef] of Object.entries(actions)) {
    const usage = {
      apiRefs: new Set<string>(),
      macroRefs: new Set<string>(),
      stepTypes: new Set<string>()
    };
    walkActionDefinition(actionDef, usage);
    for (const ref of usage.apiRefs) allApiRefs.add(ref);
    for (const ref of usage.macroRefs) allMacroRefs.add(ref);

    actionUsage.push({
      actionKey,
      actionType: normalizeActionType(actionDef),
      stepTypes: Array.from(usage.stepTypes).sort((a, b) => a.localeCompare(b)),
      apiRefs: Array.from(usage.apiRefs).sort((a, b) => a.localeCompare(b)),
      macroRefs: Array.from(usage.macroRefs).sort((a, b) => a.localeCompare(b)),
      hasLegacyMacro: usage.macroRefs.size > 0
    });
  }

  actionUsage.sort((a, b) => a.actionKey.localeCompare(b.actionKey));
  return {
    actions: actionUsage,
    apiRefs: Array.from(allApiRefs).sort((a, b) => a.localeCompare(b)),
    lookupApiRefs: Array.from(lookupApiRefs).sort((a, b) => a.localeCompare(b)),
    macroRefs: Array.from(allMacroRefs).sort((a, b) => a.localeCompare(b))
  };
}
