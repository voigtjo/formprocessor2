export const TEMPLATE_STATES = ['draft', 'published', 'inactive'] as const;
export type TemplateState = (typeof TEMPLATE_STATES)[number];

export const DOCUMENT_STATES = ['created', 'assigned', 'submitted', 'approved', 'archived'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATES)[number];

export const DOCUMENT_WORKFLOW_ORDER = ['created', 'assigned', 'submitted', 'approved'] as const;
export const DOCUMENT_WORKFLOW_INITIAL: DocumentStatus = 'created';

function normalizeString(input: unknown) {
  return String(input ?? '')
    .trim()
    .toLowerCase();
}

export function normalizeTemplateState(raw: unknown): TemplateState {
  const value = normalizeString(raw);
  if (value === 'published' || value === 'active') return 'published';
  if (value === 'inactive' || value === 'archived') return 'inactive';
  return 'draft';
}

export function normalizeDocumentStatus(raw: unknown): DocumentStatus {
  const value = normalizeString(raw);
  if (value === 'assigned' || value === 'started') return 'assigned';
  if (value === 'submitted' || value === 'offer_created') return 'submitted';
  if (value === 'approved' || value === 'completed' || value === 'done' || value === 'rejected') return 'approved';
  if (value === 'archived') return 'archived';
  return 'created';
}

export function isArchivedDocumentStatus(raw: unknown) {
  return normalizeDocumentStatus(raw) === 'archived';
}

export function isDoneDocumentStatus(raw: unknown) {
  const status = normalizeDocumentStatus(raw);
  return status === 'approved' || status === 'archived';
}

function dedupeStringList(values: unknown, allow: Set<string>) {
  if (!Array.isArray(values)) return [] as string[];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const item = value.trim();
    if (!item || !allow.has(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function dedupeAnyStringList(values: unknown) {
  if (!Array.isArray(values)) return [] as string[];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const item = value.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function mapLegacyWorkflowStateKey(raw: unknown): DocumentStatus {
  const value = normalizeString(raw);
  if (value === 'assigned' || value === 'started') return 'assigned';
  if (value === 'submitted' || value === 'offer_created') return 'submitted';
  if (value === 'approved' || value === 'completed' || value === 'done' || value === 'rejected') return 'approved';
  if (value === 'archived') return 'archived';
  return 'created';
}

export function normalizeWorkflowStates(
  rawStates: unknown,
  validFieldKeys: string[]
): Record<DocumentStatus, { editable: string[]; readonly: string[]; buttons: string[] }> {
  const fieldKeySet = new Set(validFieldKeys);
  const normalized: Record<DocumentStatus, { editable: string[]; readonly: string[]; buttons: string[] }> = {
    created: { editable: [], readonly: [], buttons: [] },
    assigned: { editable: [], readonly: [], buttons: [] },
    submitted: { editable: [], readonly: [], buttons: [] },
    approved: { editable: [], readonly: [], buttons: [] },
    archived: { editable: [], readonly: [], buttons: [] }
  };

  if (!rawStates || typeof rawStates !== 'object' || Array.isArray(rawStates)) {
    return normalized;
  }

  for (const [stateKey, config] of Object.entries(rawStates as Record<string, unknown>)) {
    const mappedKey = mapLegacyWorkflowStateKey(stateKey);
    const existing = normalized[mappedKey];
    const record = config && typeof config === 'object' && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
    const editable = dedupeStringList(record.editable, fieldKeySet);
    const readonly = dedupeStringList(record.readonly, fieldKeySet);
    const buttons = dedupeAnyStringList(record.buttons);
    normalized[mappedKey] = {
      editable: Array.from(new Set([...existing.editable, ...editable])),
      readonly: Array.from(new Set([...existing.readonly, ...readonly])),
      buttons: Array.from(new Set([...existing.buttons, ...buttons]))
    };
  }

  return normalized;
}
