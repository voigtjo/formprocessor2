import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import type { FpDb } from '../db/index.js';
import {
  fpDocuments,
  fpGroupMembers,
  fpGroups,
  fpMacros,
  fpTemplateAssignments,
  fpTemplates,
  fpUsers
} from '../db/schema.js';
import { fetchLookupOptions, normalizeLookupSource } from '../lookup.js';
import { ExternalCallError, executeActionDefinition } from '../actions/index.js';
import { renderLayout } from '../render/layout.js';

type UiRouteOptions = {
  db: FpDb;
  erpBaseUrl: string;
  hasDocumentActorColumns?: boolean;
  hasDocumentTemplateVersion?: boolean;
};
const templateStateSchema = z.enum(['draft', 'published', 'archived']);
const permissionRequiresSchema = z.union([
  z.enum(['read', 'write', 'execute', 'r', 'w', 'x']),
  z.array(z.enum(['read', 'write', 'execute', 'r', 'w', 'x']))
]);

const layoutSectionsSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().optional(),
        fields: z.array(z.string())
      })
    )
    .optional()
});

const layoutNodesSchema = z.array(z.object({ type: z.string() }).passthrough());

const templateJsonSchema = z.object({
  fields: z.record(z.any()),
  layout: z.union([layoutSectionsSchema, layoutNodesSchema]).default({}),
  workflow: z.object({
    initial: z.string(),
    order: z.array(z.string()).optional(),
    states: z.record(z.any()).optional()
  }),
  controls: z.record(z.any()).optional(),
  actions: z.record(z.any()).optional(),
  permissions: z
    .object({
      actions: z
        .record(
          z.object({
            requires: permissionRequiresSchema.optional()
          })
        )
        .optional()
    })
    .optional()
});

const templateEditorJsonSchema = z.object({
  fields: z.record(z.any()),
  layout: z.array(z.any()),
  workflow: z.object({
    initial: z.string(),
    order: z.array(z.string()).optional(),
    states: z.record(z.any())
  }),
  controls: z.record(z.any()),
  actions: z.record(z.any()),
  permissions: z
    .object({
      actions: z
        .record(
          z.object({
            requires: permissionRequiresSchema.optional()
          })
        )
        .optional()
    })
    .optional()
});

const templateFormSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  state: templateStateSchema,
  template_json: z.string().min(1)
});

const templateIdQuerySchema = z.object({
  templateId: z.string().uuid()
});

const lookupQuerySchema = z.object({
  templateId: z.string().uuid(),
  fieldKey: z.string().min(1)
});

const templateIdParamSchema = z.object({
  id: z.string().uuid()
});

const assignmentParamSchema = z.object({
  id: z.string().uuid(),
  assignmentId: z.string().uuid()
});

const assignmentBodySchema = z.object({
  groupId: z.string().uuid()
});

const adminUserCreateSchema = z.object({
  username: z.string().min(1),
  displayName: z.string().min(1)
});

const adminGroupCreateSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1)
});

const adminMembershipCreateSchema = z.object({
  groupId: z.string().uuid(),
  userId: z.string().uuid(),
  rights: z.string().min(1)
});

const adminMembershipDeleteParamSchema = z.object({
  membershipId: z.string().uuid()
});

const adminTemplateAssignmentCreateSchema = z.object({
  templateId: z.string().uuid(),
  groupId: z.string().uuid()
});

const adminTemplateAssignmentDeleteParamSchema = z.object({
  assignmentId: z.string().uuid()
});
const macroRefParamSchema = z.object({
  ref: z.string().min(1)
});
const macroKindSchema = z.enum(['json', 'code', 'builtin']);
const macroFormSchema = z.object({
  ref: z.string().min(1),
  namespace: z.string().min(1),
  name: z.string().min(1),
  version: z.coerce.number().int().positive(),
  description: z.string().optional(),
  enabled: z.boolean(),
  kind: macroKindSchema,
  paramsSchemaJsonText: z.string().optional(),
  definitionJsonText: z.string().optional(),
  codeText: z.string().optional()
});

const documentIdParamSchema = z.object({
  id: z.string().uuid()
});

const documentActionParamSchema = z.object({
  id: z.string().uuid(),
  controlKey: z.string().min(1)
});
const groupIdParamSchema = z.object({
  groupId: z.string().uuid()
});
const documentAssignmentBodySchema = z.object({
  userId: z.string().uuid()
});

type TemplateJson = z.infer<typeof templateJsonSchema>;

type TemplateField = {
  kind?: string;
  label?: string;
  multiline?: boolean;
  inputType?: 'text' | 'date' | 'checkbox' | 'select';
  control?: 'text' | 'date' | 'checkbox';
  ui?: {
    input?: 'text' | 'date' | 'checkbox';
  };
  source?: {
    path?: string;
    query?: Record<string, unknown>;
    valueField?: string;
    labelField?: string;
    valueKey?: string;
    labelKey?: string;
  };
  lookup?: {
    endpoint?: string;
    valueField?: string;
    labelField?: string;
    valueKey?: string;
    labelKey?: string;
  };
};

type PermissionName = 'read' | 'write' | 'execute';
type CurrentUser = { id: string; username: string; displayName: string };
type LayoutButtonKind = 'ui' | 'process';
type AdminErpTab = 'products' | 'customers' | 'batches' | 'serial-instances' | 'customer-orders';

const starterTemplate = {
  fields: {
    customer_id: {
      kind: 'lookup',
      label: 'Customer',
      source: {
        path: '/api/customers',
        query: { valid: true },
        valueKey: 'id',
        labelKey: 'name'
      }
    },
    comment: {
      kind: 'editable',
      label: 'Comment',
      multiline: true
    }
  },
  layout: [
    { type: 'h1', text: 'Start' },
    { type: 'field', key: 'customer_id' },
    { type: 'field', key: 'comment' }
  ],
  workflow: {
    initial: 'received',
    states: {
      received: {
        editable: ['comment'],
        readonly: [],
        buttons: []
      }
    }
  },
  controls: {},
  actions: {}
};

function resolvePublishedAtForStateChange(nextState: 'draft' | 'published' | 'archived', existing?: Date | null) {
  if (nextState !== 'published') return null;
  return existing ?? new Date();
}

function normalizeTemplateState(raw: unknown): 'draft' | 'published' | 'archived' {
  if (raw === 'active') return 'published';
  if (raw === 'draft' || raw === 'published' || raw === 'archived') return raw;
  return 'draft';
}

async function sendUiError(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  message: string,
  fallbackTitle?: string
) {
  const acceptsHtml = String(request.headers.accept ?? '').includes('text/html');
  const isApi = String(request.url).startsWith('/api/');
  const title =
    fallbackTitle ??
    (statusCode === 403 ? 'Forbidden' : statusCode === 404 ? 'Not Found' : statusCode === 400 ? 'Bad Request' : 'Error');

  if (!isApi && acceptsHtml && typeof (reply as any).renderPage === 'function') {
    reply.code(statusCode);
    await reply.renderPage('error.ejs', {
      title,
      statusCode,
      message,
      backHref: request.headers.referer || '/templates'
    });
    return;
  }

  reply.status(statusCode).send({ message });
}

async function loadTemplateVersionsByKey(db: FpDb, key: string) {
  return db
    .select({
      id: fpTemplates.id,
      key: fpTemplates.key,
      name: fpTemplates.name,
      description: fpTemplates.description,
      state: fpTemplates.state,
      version: fpTemplates.version,
      templateJson: fpTemplates.templateJson,
      publishedAt: fpTemplates.publishedAt,
      createdAt: fpTemplates.createdAt
    })
    .from(fpTemplates)
    .where(eq(fpTemplates.key, key))
    .orderBy(desc(fpTemplates.version));
}

function parseTemplateJson(raw: unknown): TemplateJson {
  return templateJsonSchema.parse(raw);
}

function buildActionRuntimeTemplateContext(templateJson: TemplateJson) {
  const fullSchema = {
    fields: templateJson.fields,
    workflow: templateJson.workflow,
    controls: templateJson.controls ?? {},
    actions: templateJson.actions ?? {},
    permissions: templateJson.permissions ?? {}
  };

  return {
    templateDefinition: {
      template: templateJson,
      fullSchema
    },
    schema: fullSchema
  };
}

function parseTemplateEditorJson(raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('template_json must be valid JSON');
  }

  const validated = templateEditorJsonSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error('template_json must contain fields, layout, workflow.initial, workflow.states, controls, actions');
  }

  return validated.data;
}

function parseOptionalJsonField(raw: string | undefined, fieldName: string) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${fieldName} must be valid JSON`);
  }
}

function buildUserCookie(userId: string) {
  return `fp_user=${encodeURIComponent(userId)}; Path=/; HttpOnly; SameSite=Lax`;
}

function parseCookies(cookieHeader: string | undefined) {
  if (!cookieHeader) return {} as Record<string, string>;
  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const eqIndex = part.indexOf('=');
        if (eqIndex === -1) return [part, ''];
        const key = part.slice(0, eqIndex);
        const value = decodeURIComponent(part.slice(eqIndex + 1));
        return [key, value];
      })
  );
}

function compactRequiredRights(requires: PermissionName[]) {
  const map: Record<PermissionName, string> = {
    read: 'r',
    write: 'w',
    execute: 'x'
  };
  const rights = new Set<string>();
  for (const item of requires) rights.add(map[item]);
  return Array.from(rights).sort().join('');
}

function describeRequiredRights(requires: PermissionName[]) {
  const letters = compactRequiredRights(requires);
  const names = requires.join('/');
  return `${names} (${letters})`;
}

function hasRequiredRights(userRights: string, requires: PermissionName[]) {
  const normalized = new Set(userRights.split(''));
  const map: Record<PermissionName, string> = {
    read: 'r',
    write: 'w',
    execute: 'x'
  };
  return requires.every((item) => normalized.has(map[item]));
}

function normalizeRequiresValue(raw: unknown): PermissionName[] {
  const rawValues = Array.isArray(raw) ? raw : raw !== undefined && raw !== null ? [raw] : [];
  const mapped = rawValues
    .map((item) => String(item).trim().toLowerCase())
    .map((item) => {
      if (item === 'r' || item === 'read') return 'read' as const;
      if (item === 'w' || item === 'write') return 'write' as const;
      if (item === 'x' || item === 'execute') return 'execute' as const;
      return null;
    })
    .filter((item): item is PermissionName => !!item);
  return Array.from(new Set(mapped));
}

function resolveDefaultRequiredRights(controlKey: string, actionKey: string): PermissionName[] {
  const combined = `${controlKey} ${actionKey}`.toLowerCase();
  if (combined.includes('save') || combined.includes('submit')) return ['write'];
  if (
    combined.includes('approve') ||
    combined.includes('reject') ||
    combined.includes('assign') ||
    combined.includes('start')
  ) {
    return ['execute'];
  }
  return [];
}

function resolveActionPermissionRequirements(templateJson: TemplateJson, controlKey: string, actionKey: string) {
  const byActionMap = ((templateJson as any).permissions?.actions ?? {}) as Record<string, { requires?: unknown }>;
  const controls = ((templateJson as any).controls ?? {}) as Record<string, { requires?: unknown }>;
  const actions = ((templateJson as any).actions ?? {}) as Record<string, { requires?: unknown }>;
  const sources = [
    byActionMap[controlKey]?.requires,
    byActionMap[actionKey]?.requires,
    controls[controlKey]?.requires,
    actions[actionKey]?.requires
  ];
  for (const source of sources) {
    const normalized = normalizeRequiresValue(source);
    if (normalized.length > 0) return normalized;
  }
  return resolveDefaultRequiredRights(controlKey, actionKey);
}

function resolveControlKeyFromAction(templateJson: TemplateJson, action: string) {
  const controls = ((templateJson as any).controls ?? {}) as Record<string, { action?: string }>;
  if (controls[action]) return action;

  for (const [controlKey, config] of Object.entries(controls)) {
    if (config?.action === action) {
      return controlKey;
    }
  }

  return action;
}

function collectLayoutButtonKinds(templateJson: TemplateJson) {
  const byControlKey = new Map<string, LayoutButtonKind>();

  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;

    if (n.type === 'button') {
      const key = typeof n.key === 'string' ? n.key : '';
      const action = typeof n.action === 'string' ? n.action : '';
      const kind: LayoutButtonKind = n.kind === 'process' ? 'process' : 'ui';
      const resolvedControl = action ? resolveControlKeyFromAction(templateJson, action) : key;
      const candidates = [key, resolvedControl].filter((item): item is string => !!item);
      for (const candidate of candidates) {
        if (!byControlKey.has(candidate)) {
          byControlKey.set(candidate, kind);
        }
      }
    }

    if (Array.isArray(n.children)) {
      for (const child of n.children) visit(child);
    }
  };

  const layout = (templateJson as any).layout;
  if (Array.isArray(layout)) {
    for (const node of layout) visit(node);
  }

  return byControlKey;
}

function normalizeActionSteps(actionDef: unknown): Array<Record<string, unknown>> {
  if (!actionDef || typeof actionDef !== 'object') return [];
  const def = actionDef as Record<string, unknown>;
  const nestedSteps = def.steps;
  if (Array.isArray(nestedSteps)) {
    return nestedSteps.filter((step): step is Record<string, unknown> => !!step && typeof step === 'object');
  }
  return [def];
}

function isUiSafeActionDefinition(actionDef: unknown) {
  const allowedMacros = new Set([
    'reloadLookup',
    'noop',
    'showToast',
    'macro:ui/reloadLookup@1',
    'macro:ui/noop@1',
    'macro:ui/showToast@1'
  ]);
  const steps = normalizeActionSteps(actionDef);
  if (steps.length === 0) return false;

  for (const step of steps) {
    if (step.type !== 'macro') return false;
    const macroRef = typeof step.ref === 'string' ? step.ref : '';
    const macroName = typeof step.name === 'string' ? step.name : '';
    const normalized = macroRef || macroName;
    if (!allowedMacros.has(normalized)) return false;
  }

  return true;
}

async function loadTemplateAssignmentView(db: FpDb, templateId: string) {
  const allGroups = await db
    .select({
      id: fpGroups.id,
      key: fpGroups.key,
      name: fpGroups.name
    })
    .from(fpGroups)
    .orderBy(asc(fpGroups.name));

  const assignments = await db.query.fpTemplateAssignments.findMany({
    where: eq(fpTemplateAssignments.templateId, templateId)
  });

  const assignedGroups = assignments
    .map((item) => {
      const group = allGroups.find((g) => g.id === item.groupId);
      if (!group) return undefined;
      return {
        assignmentId: item.id,
        groupId: group.id,
        groupKey: group.key,
        groupName: group.name
      };
    })
    .filter((item): item is { assignmentId: string; groupId: string; groupKey: string; groupName: string } => !!item);

  const assignedGroupIds = new Set(assignedGroups.map((item) => item.groupId));
  const assignableGroups = allGroups.filter((item) => !assignedGroupIds.has(item.id));

  return { assignedGroups, assignableGroups, hasGroups: allGroups.length > 0 };
}

export async function ensureErpCustomerOrderReference(params: {
  templateJson: TemplateJson;
  externalRefs: Record<string, string>;
  snapshots: Record<string, string>;
  data: Record<string, unknown>;
  erpBaseUrl: string;
  fetchImpl?: typeof fetch;
}) {
  const erpField = params.templateJson.fields['erp_customer_order_id'] as TemplateField | undefined;
  const hasOrderField = !!erpField && (erpField.kind === 'system' || erpField.kind === 'workflow');
  const actionsRequireOrderRef = JSON.stringify((params.templateJson as any).actions ?? {}).includes(
    '{{external.customer_order_id}}'
  );

  if (!hasOrderField && !actionsRequireOrderRef) {
    return;
  }

  const fetchImpl = params.fetchImpl ?? fetch;
  const body = params.externalRefs.customer_id ? { customer_id: params.externalRefs.customer_id } : undefined;
  const response = await fetchImpl(new URL('/api/customer-orders', params.erpBaseUrl).toString(), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    ...(body ? { body: JSON.stringify(body) } : { body: '{}' })
  });

  if (!response.ok) {
    throw new Error(`Failed to create ERP customer order (${response.status})`);
  }

  const payload = (await response.json()) as { id?: string; order_number?: string };
  if (!payload.id || !payload.order_number) {
    throw new Error('ERP customer order response is incomplete');
  }

  params.externalRefs.customer_order_id = payload.id;
  params.snapshots.customer_order_id = payload.order_number;
  params.data.erp_customer_order_id = payload.order_number;
}

function layoutFieldKeysFromNodes(layout: unknown): string[] {
  if (!Array.isArray(layout)) return [];
  const keys: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (record.type === 'field') {
      const key = record.key;
      if (typeof key === 'string' && key.length > 0) keys.push(key);
    }
    if (Array.isArray(record.children)) {
      for (const child of record.children) visit(child);
    }
  };
  for (const node of layout) visit(node);
  return keys;
}

function orderedFieldKeys(templateJson: TemplateJson) {
  const layout = (templateJson as any).layout;

  const inLayoutSections =
    !Array.isArray(layout) && layout?.sections
      ? (layout.sections.flatMap((section: any) => section.fields) as string[])
      : [];

  const inLayoutNodes = layoutFieldKeysFromNodes(layout);

  const all = Object.keys(templateJson.fields);
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const key of [...inLayoutSections, ...inLayoutNodes, ...all]) {
    if (!seen.has(key) && templateJson.fields[key]) {
      seen.add(key);
      ordered.push(key);
    }
  }

  return ordered;
}

function buildSections(templateJson: TemplateJson) {
  const layout = (templateJson as any).layout;

  // Old shape: { layout: { sections: [...] } }
  if (!Array.isArray(layout) && layout?.sections && layout.sections.length > 0) {
    return layout.sections;
  }

  // New/spec shape: { layout: [ {type:'field', key:'...'} , ... ] }
  if (Array.isArray(layout)) {
    const keys = layoutFieldKeysFromNodes(layout);
    const fields = keys.length > 0 ? keys : orderedFieldKeys(templateJson);
    return [{ title: 'Form', fields }];
  }

  // Fallback
  return [{ title: 'Form', fields: orderedFieldKeys(templateJson) }];
}

function toFormRecord(body: unknown) {
  if (!body || typeof body !== 'object') {
    return {} as Record<string, unknown>;
  }

  return body as Record<string, unknown>;
}

function getFormString(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  return '';
}

function resolveEditableInputType(field: TemplateField): 'text' | 'date' | 'checkbox' {
  const input = field.inputType ?? field.control ?? field.ui?.input ?? field.kind;
  return input === 'date' || input === 'checkbox' ? input : 'text';
}

function isEditableFieldKind(kind: unknown) {
  return kind === 'editable' || kind === 'date' || kind === 'checkbox';
}

function resolveEditableFormValue(form: Record<string, unknown>, field: TemplateField, fieldKey: string) {
  const formKey = `data:${fieldKey}`;
  const inputType = resolveEditableInputType(field);
  if (inputType === 'checkbox') {
    return Object.prototype.hasOwnProperty.call(form, formKey);
  }
  return getFormString(form, formKey);
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function collectExternalRefsFromQuery(query: Record<string, unknown>) {
  const externalRefs: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(query)) {
    if (!key.startsWith('lookup:')) {
      continue;
    }

    if (typeof rawValue === 'string' && rawValue.length > 0) {
      externalRefs[key.slice('lookup:'.length)] = rawValue;
    }
  }

  return externalRefs;
}

function resolveLookupFieldNames(field: TemplateField) {
  const valueField =
    field.source?.valueField ??
    field.source?.valueKey ??
    field.lookup?.valueField ??
    field.lookup?.valueKey ??
    'id';

  const labelField =
    field.source?.labelField ??
    field.source?.labelKey ??
    field.lookup?.labelField ??
    field.lookup?.labelKey ??
    'name';

  return { valueField, labelField };
}

function sanitizeStatusSourceOfTruthData(data: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(data, 'status')) return data;
  const { status: _ignored, ...rest } = data;
  return rest;
}

function sanitizeStatusSourceOfTruthExternalRefs(externalRefs: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(externalRefs, 'status')) return externalRefs;
  const { status: _ignored, ...rest } = externalRefs;
  return rest;
}

function splitDocumentActorColumns(data: Record<string, unknown>) {
  const nextData = { ...data };
  let editorUserId: string | null | undefined;
  let approverUserId: string | null | undefined;

  const pickUuidOrNull = (value: unknown, key: string) => {
    if (value === undefined) return undefined;
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    if (!z.string().uuid().safeParse(raw).success) {
      throw new Error(`Invalid ${key} (expected uuid)`);
    }
    return raw;
  };

  if (Object.prototype.hasOwnProperty.call(nextData, 'editor_user_id')) {
    editorUserId = pickUuidOrNull(nextData.editor_user_id, 'editor_user_id');
    delete nextData.editor_user_id;
  }
  if (Object.prototype.hasOwnProperty.call(nextData, 'assignee_user_id')) {
    // Backward compatibility for legacy templates/actions.
    if (editorUserId === undefined) {
      editorUserId = pickUuidOrNull(nextData.assignee_user_id, 'assignee_user_id');
    }
    delete nextData.assignee_user_id;
  }
  if (Object.prototype.hasOwnProperty.call(nextData, 'approver_user_id')) {
    approverUserId = pickUuidOrNull(nextData.approver_user_id, 'approver_user_id');
    delete nextData.approver_user_id;
  }
  if (Object.prototype.hasOwnProperty.call(nextData, 'reviewer_user_id')) {
    // Backward compatibility for legacy templates/actions.
    if (approverUserId === undefined) {
      approverUserId = pickUuidOrNull(nextData.reviewer_user_id, 'reviewer_user_id');
    }
    delete nextData.reviewer_user_id;
  }

  return { dataJson: nextData, editorUserId, approverUserId };
}

function normalizeRightsString(input: string) {
  const normalized = input.trim().toLowerCase();
  if (!/^[rwx]+$/.test(normalized)) return null;
  const chars = new Set(normalized.split(''));
  if (chars.size === 0) return null;
  return ['r', 'w', 'x']
    .filter((item) => chars.has(item))
    .join('');
}

function allEditableFieldKeys(templateJson: TemplateJson) {
  return Object.entries(templateJson.fields)
    .filter(([, field]) => isEditableFieldKind((field as TemplateField)?.kind))
    .map(([key]) => key);
}

export function resolveEditableFieldKeys(templateJson: TemplateJson, status: string): string[] {
  const fallback = allEditableFieldKeys(templateJson);
  const state = (templateJson.workflow as any)?.states?.[status];
  const configured = Array.isArray(state?.editable) ? state.editable : undefined;
  if (!configured) return fallback;

  const fieldKeys = new Set(Object.keys(templateJson.fields ?? {}));
  return configured.filter((key: unknown): key is string => typeof key === 'string' && fieldKeys.has(key));
}

export function applyEditableDataUpdate(
  templateJson: TemplateJson,
  currentData: Record<string, unknown>,
  form: Record<string, unknown>,
  editableKeys: string[]
) {
  const next = { ...currentData };
  for (const key of editableKeys) {
    const field = templateJson.fields[key] as TemplateField | undefined;
    if (!field || !isEditableFieldKind(field.kind)) continue;
    const formKey = `data:${key}`;
    const inputType = resolveEditableInputType(field);
    if (inputType === 'checkbox') {
      next[key] = resolveEditableFormValue(form, field, key);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(form, formKey)) {
      next[key] = resolveEditableFormValue(form, field, key);
    }
  }
  return next;
}

function resolveReadonlyFieldKeys(templateJson: TemplateJson, status: string): string[] {
  const state = (templateJson.workflow as any)?.states?.[status];
  const readonly = Array.isArray(state?.readonly) ? state.readonly : [];
  return readonly.filter((key: unknown): key is string => typeof key === 'string');
}

function snapshotPreviewList(snapshotsJson: unknown) {
  if (!snapshotsJson || typeof snapshotsJson !== 'object') return [] as string[];
  const values = Object.values(snapshotsJson as Record<string, unknown>)
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0);
  return values.slice(0, 3);
}

function resolveWorkflowTimeline(templateJson: TemplateJson, currentStatus: string) {
  const workflow = (templateJson.workflow ?? {}) as Record<string, unknown>;
  const rawOrder = workflow.order;
  const states = (workflow.states ?? {}) as Record<string, unknown>;
  const fromOrder = Array.isArray(rawOrder)
    ? rawOrder.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const fallback = Object.keys(states);
  const ordered = fromOrder.length > 0 ? fromOrder : fallback;
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const state of ordered) {
    const normalized = state.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(state);
  }

  const currentNormalized = currentStatus.trim().toLowerCase();
  const hasCurrent = currentNormalized.length > 0 && deduped.some((state) => state.trim().toLowerCase() === currentNormalized);
  if (currentStatus && !hasCurrent) {
    deduped.push(currentStatus);
  }

  return deduped;
}

async function renderDocumentDetailPage(params: {
  db: FpDb;
  hasDocumentActorColumns: boolean;
  reply: FastifyReply;
  template: { id: string; key: string; name: string; templateJson: unknown };
  document: {
    id: string;
    status: string;
    templateVersion?: number | null;
    groupId?: string | null;
    editorUserId?: string | null;
    approverUserId?: string | null;
    dataJson: unknown;
    externalRefsJson: unknown;
    snapshotsJson: unknown;
  };
  assignmentGroupId?: string | null;
  groupName?: string | null;
  errorMessage?: string;
}) {
  const templateJson = parseTemplateJson(params.template.templateJson);
  const stateDef = (templateJson.workflow as any)?.states?.[params.document.status] ?? {};
  const editableKeys = resolveEditableFieldKeys(templateJson, params.document.status);
  const readonlyKeys = resolveReadonlyFieldKeys(templateJson, params.document.status);
  const buttonKeys = Array.isArray(stateDef?.buttons)
    ? stateDef.buttons.filter((key: unknown): key is string => typeof key === 'string')
    : [];
  const workflowTimeline = resolveWorkflowTimeline(templateJson, params.document.status);
  const dataJsonForRender = {
    ...((params.document.dataJson ?? {}) as Record<string, unknown>),
    ...(params.document.editorUserId
      ? { editor_user_id: params.document.editorUserId, assignee_user_id: params.document.editorUserId }
      : {}),
    ...(params.document.approverUserId
      ? { approver_user_id: params.document.approverUserId, reviewer_user_id: params.document.approverUserId }
      : {})
  };
  const layoutHtml = renderLayout({
    mode: 'detail',
    templateJson,
    templateId: params.template.id,
    documentId: params.document.id,
    documentStatus: params.document.status,
    dataJson: dataJsonForRender,
    externalRefsJson: (params.document.externalRefsJson ?? {}) as Record<string, unknown>,
    snapshotsJson: (params.document.snapshotsJson ?? {}) as Record<string, unknown>,
    editableKeys,
    readonlyKeys
  });

  let assignmentMembers: Array<{ id: string; name: string; username: string }> = [];
  let assignmentEditorCandidates: Array<{ id: string; name: string; username: string }> = [];
  let assignmentApproverCandidates: Array<{ id: string; name: string; username: string }> = [];
  let assignmentEditorName = '—';
  let assignmentApproverName = '—';
  let assignmentEditorHint = '';
  let assignmentApproverHint = '';
  if (params.hasDocumentActorColumns && params.assignmentGroupId && typeof (params.db as any).select === 'function') {
    const members = await params.db
      .select({
        userId: fpGroupMembers.userId,
        rights: fpGroupMembers.rights,
        username: fpUsers.username,
        displayName: fpUsers.displayName
      })
      .from(fpGroupMembers)
      .innerJoin(fpUsers, eq(fpUsers.id, fpGroupMembers.userId))
      .where(eq(fpGroupMembers.groupId, params.assignmentGroupId))
      .orderBy(asc(fpUsers.username));
    assignmentMembers = members.map((item) => ({
      id: item.userId,
      name: item.displayName,
      username: item.username
    }));
    assignmentEditorCandidates = members
      .filter((item) => item.rights.includes('w'))
      .map((item) => ({ id: item.userId, name: item.displayName, username: item.username }));
    assignmentApproverCandidates = members
      .filter((item) => item.rights.includes('x'))
      .map((item) => ({ id: item.userId, name: item.displayName, username: item.username }));
    if (assignmentEditorCandidates.length === 0) {
      assignmentEditorHint = 'No eligible users with write rights';
    }
    if (assignmentApproverCandidates.length === 0) {
      assignmentApproverHint = 'No eligible users with execute rights';
    }
    const membersById = new Map(assignmentMembers.map((item) => [item.id, item]));
    if (params.document.editorUserId) {
      const editor = membersById.get(params.document.editorUserId);
      assignmentEditorName = editor ? editor.name : params.document.editorUserId;
    }
    if (params.document.approverUserId) {
      const approver = membersById.get(params.document.approverUserId);
      assignmentApproverName = approver ? approver.name : params.document.approverUserId;
    }
  } else {
    if (params.document.editorUserId) assignmentEditorName = params.document.editorUserId;
    if (params.document.approverUserId) assignmentApproverName = params.document.approverUserId;
  }

  await params.reply.renderPage('documents/detail.ejs', {
    template: params.template,
    templateJson,
    layoutHtml,
    workflowTimeline,
    buttonKeys,
    groupName: params.groupName ?? null,
    assignmentGroupId: params.assignmentGroupId ?? null,
    hasDocumentActorColumns: params.hasDocumentActorColumns,
    assignmentMembers,
    assignmentEditorCandidates,
    assignmentApproverCandidates,
    assignmentEditorName,
    assignmentApproverName,
    assignmentEditorHint,
    assignmentApproverHint,
    errorMessage: params.errorMessage,
    document: params.document,
    dataJson: dataJsonForRender,
    externalRefsJson: (params.document.externalRefsJson ?? {}) as Record<string, unknown>,
    snapshotsJson: (params.document.snapshotsJson ?? {}) as Record<string, unknown>
  });
}

function classifyStatusBucket(status: string): 'Open' | 'In Progress' | 'Done' {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'approved') return 'Done';
  if (normalized === 'assigned' || normalized === 'submitted') return 'In Progress';
  if (normalized === 'created') return 'Open';
  return 'Open';
}

function resolveTaskStateForUser(params: {
  role: 'Editor' | 'Approver';
  status: string;
  rights: string;
}): 'open' | 'waiting' | 'done' {
  const normalizedStatus = params.status.trim().toLowerCase();
  const rights = params.rights ?? '';

  if (params.role === 'Editor') {
    if (normalizedStatus === 'submitted' || normalizedStatus === 'approved') return 'done';
    if (normalizedStatus === 'assigned' && rights.includes('w')) return 'open';
    return 'waiting';
  }

  if (normalizedStatus === 'approved') return 'done';
  if (normalizedStatus === 'submitted' && rights.includes('x')) return 'open';
  return 'waiting';
}

async function resolveTemplateAssignmentContext(db: FpDb, templateId: string) {
  const assignments =
    typeof (db as any).query?.fpTemplateAssignments?.findMany === 'function'
      ? await db.query.fpTemplateAssignments.findMany({
          where: eq(fpTemplateAssignments.templateId, templateId)
        })
      : [];
  const chosenGroupId = assignments[0]?.groupId ?? null;
  const hasMultipleAssignments = assignments.length > 1;
  const chosenGroupName = chosenGroupId ? await resolveGroupName(db, chosenGroupId) : null;
  return {
    chosenGroupId,
    chosenGroupName,
    hasMultipleAssignments,
    isUnassigned: assignments.length === 0
  };
}

async function resolveGroupName(db: FpDb, groupId?: string | null) {
  if (!groupId) return null;
  if (!(db as any).query?.fpGroups?.findFirst) return null;
  const group = await db.query.fpGroups.findFirst({ where: eq(fpGroups.id, groupId) });
  return group?.name ?? null;
}

async function resolveDocumentRbacGroupId(
  db: FpDb,
  document: { groupId?: string | null; templateId: string }
): Promise<string | null> {
  if (document.groupId) return document.groupId;
  const assignment = await resolveTemplateAssignmentContext(db, document.templateId);
  return assignment.chosenGroupId;
}

async function loadDocumentById(db: FpDb, id: string, withActorColumns: boolean, withTemplateVersion: boolean) {
  if (withActorColumns && withTemplateVersion && typeof (db as any).query?.fpDocuments?.findFirst === 'function') {
    const legacy = await (db as any).query?.fpDocuments?.findFirst?.({ where: eq(fpDocuments.id, id) });
    if (!legacy) return null;
    return {
      ...legacy,
      templateVersion: withTemplateVersion ? legacy.templateVersion ?? 1 : 1,
      editorUserId: withActorColumns ? legacy.editorUserId ?? legacy.assigneeUserId ?? null : null,
      approverUserId: withActorColumns ? legacy.approverUserId ?? legacy.reviewerUserId ?? null : null
    };
  }

  if (typeof (db as any).select !== 'function') {
    return null;
  }

  const rows = await db
    .select({
      id: fpDocuments.id,
      templateId: fpDocuments.templateId,
      status: fpDocuments.status,
      ...(withTemplateVersion ? { templateVersion: fpDocuments.templateVersion } : {}),
      groupId: fpDocuments.groupId,
      ...(withActorColumns
        ? {
            editorUserId: fpDocuments.editorUserId,
            approverUserId: fpDocuments.approverUserId,
            assigneeUserId: fpDocuments.assigneeUserId,
            reviewerUserId: fpDocuments.reviewerUserId
          }
        : {}),
      dataJson: fpDocuments.dataJson,
      externalRefsJson: fpDocuments.externalRefsJson,
      snapshotsJson: fpDocuments.snapshotsJson,
      createdAt: fpDocuments.createdAt,
      updatedAt: fpDocuments.updatedAt
    })
    .from(fpDocuments)
    .where(eq(fpDocuments.id, id))
    .limit(1);

  const doc = rows[0];
  if (!doc) return null;
  return {
    ...doc,
    templateVersion: withTemplateVersion ? (doc as any).templateVersion ?? 1 : 1,
    editorUserId: withActorColumns ? (doc as any).editorUserId ?? (doc as any).assigneeUserId ?? null : null,
    approverUserId: withActorColumns ? (doc as any).approverUserId ?? (doc as any).reviewerUserId ?? null : null
  };
}

function normalizeAdminErpTab(raw: string): AdminErpTab {
  const allowed: AdminErpTab[] = ['products', 'customers', 'batches', 'serial-instances', 'customer-orders'];
  return (allowed as string[]).includes(raw) ? (raw as AdminErpTab) : 'products';
}

function normalizeOptionalFilter(raw: string) {
  const value = raw.trim();
  return value.length > 0 ? value : '';
}

async function fetchErpCollection(params: {
  erpBaseUrl: string;
  path: string;
  query?: Record<string, string>;
}): Promise<Record<string, unknown>[]> {
  const url = new URL(params.path, params.erpBaseUrl);
  for (const [key, value] of Object.entries(params.query ?? {})) {
    if (value.trim().length > 0) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json'
    }
  });
  if (!response.ok) {
    throw new Error(`ERP request failed (${response.status}) for ${url.toString()}`);
  }

  const payload = (await response.json()) as unknown;
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  }
  if (payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown[] }).items)) {
    return ((payload as { items: unknown[] }).items ?? []).filter(
      (item): item is Record<string, unknown> => !!item && typeof item === 'object'
    );
  }
  return [];
}

export async function uiRoutes(app: FastifyInstance, opts: UiRouteOptions) {
  const { db, erpBaseUrl, hasDocumentActorColumns = true, hasDocumentTemplateVersion = true } = opts;

  app.get('/', async (_req, reply) => {
    return reply.redirect('/templates');
  });

  app.get('/users/options', async (_request, reply) => {
    const users = await db
      .select({
        id: fpUsers.id,
        username: fpUsers.username,
        displayName: fpUsers.displayName
      })
      .from(fpUsers)
      .orderBy(asc(fpUsers.username));
    return { items: users };
  });

  app.get('/users/switch', async (request, reply) => {
    const query = toFormRecord(request.query);
    const userId = getFormString(query, 'userId');
    const next = getFormString(query, 'next');
    if (!z.string().uuid().safeParse(userId).success) {
      return reply.status(400).send({ message: 'Invalid userId' });
    }

    const user = await db.query.fpUsers.findFirst({ where: eq(fpUsers.id, userId) });
    if (!user) {
      return reply.status(404).send({ message: 'User not found' });
    }

    reply.header('set-cookie', buildUserCookie(user.id));
    const referer = request.headers.referer ?? '/templates';
    const redirectTo = next || referer || '/templates';
    reply.code(303);
    return reply.redirect(redirectTo);
  });

  app.get('/admin', async (_request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.status(404).send({ message: 'Not found' });
    }

    await reply.renderPage('admin/index.ejs');
  });

  app.get('/admin/rbac', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.status(404).send({ message: 'Not found' });
    }

    const users = await db
      .select({
        id: fpUsers.id,
        username: fpUsers.username,
        displayName: fpUsers.displayName,
        createdAt: fpUsers.createdAt
      })
      .from(fpUsers)
      .orderBy(asc(fpUsers.username));

    const groups = await db
      .select({
        id: fpGroups.id,
        key: fpGroups.key,
        name: fpGroups.name,
        createdAt: fpGroups.createdAt
      })
      .from(fpGroups)
      .orderBy(asc(fpGroups.name));

    const memberships = await db
      .select({
        id: fpGroupMembers.id,
        groupId: fpGroupMembers.groupId,
        userId: fpGroupMembers.userId,
        rights: fpGroupMembers.rights,
        createdAt: fpGroupMembers.createdAt
      })
      .from(fpGroupMembers)
      .orderBy(asc(fpGroupMembers.groupId), asc(fpGroupMembers.userId));

    const assignments = await db
      .select({
        id: fpTemplateAssignments.id,
        templateId: fpTemplateAssignments.templateId,
        groupId: fpTemplateAssignments.groupId,
        createdAt: fpTemplateAssignments.createdAt
      })
      .from(fpTemplateAssignments)
      .orderBy(desc(fpTemplateAssignments.createdAt));

    const templates = await db
      .select({
        id: fpTemplates.id,
        key: fpTemplates.key,
        name: fpTemplates.name
      })
      .from(fpTemplates)
      .orderBy(asc(fpTemplates.name));

    const latestDocuments = await db
      .select({
        id: fpDocuments.id,
        templateId: fpDocuments.templateId,
        groupId: fpDocuments.groupId,
        status: fpDocuments.status,
        createdAt: fpDocuments.createdAt
      })
      .from(fpDocuments)
      .orderBy(desc(fpDocuments.createdAt))
      .limit(25);
    const macros = await db
      .select({
        ref: fpMacros.ref,
        namespace: fpMacros.namespace,
        name: fpMacros.name,
        version: fpMacros.version,
        isEnabled: fpMacros.isEnabled,
        description: fpMacros.description
      })
      .from(fpMacros)
      .orderBy(asc(fpMacros.namespace), asc(fpMacros.name), asc(fpMacros.version));

    const usersById = new Map(users.map((item) => [item.id, item]));
    const groupsById = new Map(groups.map((item) => [item.id, item]));
    const templatesById = new Map(templates.map((item) => [item.id, item]));

    const membershipRows = memberships.map((item) => ({
      ...item,
      username: usersById.get(item.userId)?.username ?? '—',
      groupKey: groupsById.get(item.groupId)?.key ?? '—'
    }));

    const assignmentRows = assignments.map((item) => ({
      ...item,
      groupName: groupsById.get(item.groupId)?.name ?? '—',
      groupKey: groupsById.get(item.groupId)?.key ?? '—',
      templateKey: templatesById.get(item.templateId)?.key ?? '—',
      templateName: templatesById.get(item.templateId)?.name ?? '—'
    }));

    const documentRows = latestDocuments.map((item) => ({
      ...item,
      templateKey: templatesById.get(item.templateId)?.key ?? '—',
      groupKey: item.groupId ? groupsById.get(item.groupId)?.key ?? '—' : '—'
    }));

    const rawCookieHeader = request.headers.cookie ?? '';
    const cookieUser = parseCookies(rawCookieHeader).fp_user ?? '';
    const membershipRowsByGroup = groups.map((group) => {
      const rows = membershipRows.filter((item) => item.groupId === group.id);
      const memberUserIds = new Set(rows.map((item) => item.userId));
      const availableUsers = users.filter((item) => !memberUserIds.has(item.id));
      return {
        group,
        rows,
        availableUsers
      };
    });

    await reply.renderPage('admin/rbac.ejs', {
      users,
      groups,
      memberships: membershipRows,
      membershipsByGroup: membershipRowsByGroup,
      assignments: assignmentRows,
      macros,
      templates,
      latestDocuments: documentRows,
      activeUser: request.currentUser ?? null,
      activeUserCookie: cookieUser
    });
  });

  app.post('/admin/users', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.status(404).send({ message: 'Not found' });
    }
    const form = toFormRecord(request.body);
    const parsed = adminUserCreateSchema.safeParse({
      username: getFormString(form, 'username'),
      displayName: getFormString(form, 'displayName')
    });
    if (!parsed.success) {
      return reply.status(400).send({ message: 'username and displayName are required' });
    }

    await db
      .insert(fpUsers)
      .values({
        username: parsed.data.username.trim(),
        displayName: parsed.data.displayName.trim()
      })
      .onConflictDoNothing({ target: fpUsers.username });

    reply.code(303);
    return reply.redirect('/admin/rbac#users');
  });

  app.post('/admin/groups', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.status(404).send({ message: 'Not found' });
    }
    const form = toFormRecord(request.body);
    const parsed = adminGroupCreateSchema.safeParse({
      key: getFormString(form, 'key'),
      name: getFormString(form, 'name')
    });
    if (!parsed.success) {
      return reply.status(400).send({ message: 'key and name are required' });
    }

    await db
      .insert(fpGroups)
      .values({
        key: parsed.data.key.trim(),
        name: parsed.data.name.trim()
      })
      .onConflictDoNothing({ target: fpGroups.key });

    reply.code(303);
    return reply.redirect('/admin/rbac#groups');
  });

  app.post('/admin/memberships', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.status(404).send({ message: 'Not found' });
    }
    const form = toFormRecord(request.body);
    const parsed = adminMembershipCreateSchema.safeParse({
      groupId: getFormString(form, 'groupId'),
      userId: getFormString(form, 'userId'),
      rights: getFormString(form, 'rights')
    });
    if (!parsed.success) {
      return reply.status(400).send({ message: 'groupId, userId and rights are required' });
    }

    const rights = normalizeRightsString(parsed.data.rights);
    if (!rights) {
      return reply.status(400).send({ message: "rights must contain one or more of 'r', 'w', 'x'" });
    }

    const group = await db.query.fpGroups.findFirst({ where: eq(fpGroups.id, parsed.data.groupId) });
    if (!group) {
      return reply.status(404).send({ message: 'Group not found' });
    }
    const user = await db.query.fpUsers.findFirst({ where: eq(fpUsers.id, parsed.data.userId) });
    if (!user) {
      return reply.status(404).send({ message: 'User not found' });
    }

    await db
      .insert(fpGroupMembers)
      .values({
        groupId: parsed.data.groupId,
        userId: parsed.data.userId,
        rights
      })
      .onConflictDoUpdate({
        target: [fpGroupMembers.groupId, fpGroupMembers.userId],
        set: { rights }
      });

    reply.code(303);
    return reply.redirect('/admin/rbac#memberships');
  });

  app.post('/admin/memberships/:membershipId/delete', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.status(404).send({ message: 'Not found' });
    }
    const parsed = adminMembershipDeleteParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid membershipId' });
    }

    await db.delete(fpGroupMembers).where(eq(fpGroupMembers.id, parsed.data.membershipId));
    reply.code(303);
    return reply.redirect('/admin/rbac#memberships');
  });

  app.post('/admin/assignments', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.status(404).send({ message: 'Not found' });
    }
    const form = toFormRecord(request.body);
    const parsed = adminTemplateAssignmentCreateSchema.safeParse({
      templateId: getFormString(form, 'templateId'),
      groupId: getFormString(form, 'groupId')
    });
    if (!parsed.success) {
      return reply.status(400).send({ message: 'templateId and groupId are required' });
    }

    const template = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, parsed.data.templateId) });
    if (!template) {
      return reply.status(404).send({ message: 'Template not found' });
    }
    const group = await db.query.fpGroups.findFirst({ where: eq(fpGroups.id, parsed.data.groupId) });
    if (!group) {
      return reply.status(404).send({ message: 'Group not found' });
    }

    await db
      .insert(fpTemplateAssignments)
      .values({ templateId: parsed.data.templateId, groupId: parsed.data.groupId })
      .onConflictDoNothing({ target: [fpTemplateAssignments.templateId, fpTemplateAssignments.groupId] });

    reply.code(303);
    return reply.redirect('/admin/rbac#template-assignments');
  });

  app.post('/admin/assignments/:assignmentId/delete', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.status(404).send({ message: 'Not found' });
    }
    const parsed = adminTemplateAssignmentDeleteParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid assignmentId' });
    }

    await db.delete(fpTemplateAssignments).where(eq(fpTemplateAssignments.id, parsed.data.assignmentId));
    reply.code(303);
    return reply.redirect('/admin/rbac#template-assignments');
  });

  app.get('/erp', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.status(404).send({ message: 'Not found' });
    }
    const query = toFormRecord(request.query);
    const selectedTab = normalizeAdminErpTab(getFormString(query, 'tab') || 'products');
    const valid = normalizeOptionalFilter(getFormString(query, 'valid'));
    const rawStatus = normalizeOptionalFilter(getFormString(query, 'status'));
    const productId = normalizeOptionalFilter(getFormString(query, 'product_id'));
    const customerId = normalizeOptionalFilter(getFormString(query, 'customer_id'));
    const erpMessage = normalizeOptionalFilter(getFormString(query, 'message'));
    const statusByTab: Record<AdminErpTab, string> = {
      products: '',
      customers: '',
      batches: '',
      'serial-instances': '',
      'customer-orders': ''
    };
    const allowedStatusByTab: Record<AdminErpTab, string[]> = {
      products: [],
      customers: [],
      batches: ['ordered', 'produced', 'validated'],
      'serial-instances': ['ordered', 'produced', 'validated'],
      'customer-orders': ['received', 'offer_created', 'completed']
    };
    const validStatuses = allowedStatusByTab[selectedTab];
    const status =
      validStatuses.length === 0
        ? ''
        : validStatuses.includes(rawStatus)
          ? rawStatus
          : statusByTab[selectedTab];

    const tabConfig: Record<AdminErpTab, { path: string; title: string; columns: string[]; query: Record<string, string> }> = {
      products: {
        path: '/api/products',
        title: 'Products',
        columns: ['id', 'sku', 'name', 'product_type', 'valid'],
        query: { valid }
      },
      customers: {
        path: '/api/customers',
        title: 'Customers',
        columns: ['id', 'customer_no', 'name', 'country', 'valid'],
        query: { valid }
      },
      batches: {
        path: '/api/batches',
        title: 'Batches',
        columns: ['id', 'batch_no', 'product_id', 'status', 'qty'],
        query: { status, product_id: productId }
      },
      'serial-instances': {
        path: '/api/serial-instances',
        title: 'Serial Instances',
        columns: ['id', 'serial_no', 'product_id', 'status'],
        query: { status, product_id: productId }
      },
      'customer-orders': {
        path: '/api/customer-orders',
        title: 'Customer Orders',
        columns: ['id', 'order_number', 'customer_id', 'status'],
        query: { status, customer_id: customerId }
      }
    };

    const config = tabConfig[selectedTab];
    let items: Record<string, unknown>[] = [];
    let fetchError = '';
    let hintMessage = '';
    let productOptions: Array<{ id: string; name: string }> = [];
    let customerOptions: Array<{ id: string; name: string }> = [];

    if (selectedTab === 'batches' || selectedTab === 'serial-instances') {
      try {
        const products = await fetchErpCollection({
          erpBaseUrl,
          path: '/api/products',
          query: { valid: 'true' }
        });
        productOptions = products
          .map((item) => ({
            id: String(item.id ?? ''),
            name: String(item.name ?? item.sku ?? item.id ?? '')
          }))
          .filter((item) => item.id.length > 0);
      } catch (error) {
        fetchError = error instanceof Error ? error.message : 'ERP request failed';
      }
    }

    if (selectedTab === 'customer-orders') {
      try {
        const customers = await fetchErpCollection({
          erpBaseUrl,
          path: '/api/customers',
          query: { valid: 'true' }
        });
        customerOptions = customers
          .map((item) => ({
            id: String(item.id ?? ''),
            name: String(item.name ?? item.customer_no ?? item.id ?? '')
          }))
          .filter((item) => item.id.length > 0);
      } catch (error) {
        fetchError = error instanceof Error ? error.message : 'ERP request failed';
      }
    }

    const requiresProduct = selectedTab === 'batches' || selectedTab === 'serial-instances';
    const requiresCustomer = selectedTab === 'customer-orders';
    const missingRequiredFilter = (requiresProduct && !productId) || (requiresCustomer && !customerId);
    if (missingRequiredFilter) {
      hintMessage =
        selectedTab === 'batches'
          ? 'Select a product to view batches'
          : selectedTab === 'serial-instances'
            ? 'Select a product to view serial instances'
            : 'Select a customer to view customer orders';
    }

    try {
      if (!missingRequiredFilter) {
        items = await fetchErpCollection({
          erpBaseUrl,
          path: config.path,
          query: config.query
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ERP request failed';
      if (missingRequiredFilter && message.includes('400')) {
        // Missing parent filters should not be presented as backend failures.
        hintMessage =
          hintMessage ||
          (selectedTab === 'batches'
            ? 'Select a product to view batches'
            : selectedTab === 'serial-instances'
              ? 'Select a product to view serial instances'
              : 'Select a customer to view customer orders');
      } else {
        fetchError = message;
      }
    }

    await reply.renderPage('erp/index.ejs', {
      erpBaseUrl,
      selectedTab,
      selectedTitle: config.title,
      columns: config.columns,
      items,
      totalCount: items.length,
      fetchError,
      hintMessage,
      erpMessage,
      productOptions,
      customerOptions,
      filters: { valid, status, product_id: productId, customer_id: customerId }
    });
  });

  app.post('/erp/products/:id/create-batch', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.status(404).send({ message: 'Not found' });
    }

    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return sendUiError(request, reply, 400, 'product_id (uuid) is required');
    }
    const productId = params.data.id;
    if (!z.string().uuid().safeParse(productId).success) {
      return sendUiError(request, reply, 400, 'product_id (uuid) is required');
    }

    const url = new URL('/api/batches', erpBaseUrl).toString();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ product_id: productId })
    });

    if (!response.ok) {
      let message = `Failed creating batch (${response.status})`;
      try {
        const payload = (await response.json()) as { message?: unknown };
        if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
          message = payload.message;
        }
      } catch {
        // ignore JSON parse errors and keep fallback message
      }
      return sendUiError(request, reply, 400, message);
    }

    const payload = (await response.json()) as { batch_number?: unknown };
    const batchNumber =
      typeof payload.batch_number === 'string' && payload.batch_number.trim().length > 0
        ? payload.batch_number
        : '(unknown)';
    const next = new URL('/erp', 'http://localhost');
    next.searchParams.set('tab', 'products');
    next.searchParams.set('message', `Created batch: ${batchNumber}`);
    reply.code(303);
    return reply.redirect(`${next.pathname}${next.search}`);
  });

  app.get('/admin/erp', async (_request, reply) => {
    reply.code(303);
    return reply.redirect('/erp');
  });

  app.get('/admin/debug', async (_request, reply) => {
    reply.code(303);
    return reply.redirect('/admin/rbac');
  });

  app.get('/macros', async (_request, reply) => {
    const macros = await db
      .select({
        ref: fpMacros.ref,
        namespace: fpMacros.namespace,
        name: fpMacros.name,
        version: fpMacros.version,
        isEnabled: fpMacros.isEnabled,
        kind: fpMacros.kind,
        description: fpMacros.description
      })
      .from(fpMacros)
      .orderBy(asc(fpMacros.namespace), asc(fpMacros.name), desc(fpMacros.version));

    await reply.renderPage('macros/list.ejs', { macros });
  });

  app.get('/macros/new', async (_request, reply) => {
    await reply.renderPage('macros/new.ejs', {
      errorMessage: '',
      form: {
        ref: '',
        namespace: '',
        name: '',
        version: '1',
        description: '',
        enabled: true,
        kind: 'json',
        params_schema_json: '',
        definition_json: '',
        code_text: ''
      }
    });
  });

  app.post('/macros', async (request, reply) => {
    const form = toFormRecord(request.body);
    const parsed = macroFormSchema.safeParse({
      ref: getFormString(form, 'ref'),
      namespace: getFormString(form, 'namespace'),
      name: getFormString(form, 'name'),
      version: getFormString(form, 'version'),
      description: getFormString(form, 'description'),
      enabled: Object.prototype.hasOwnProperty.call(form, 'enabled'),
      kind: getFormString(form, 'kind') || 'json',
      paramsSchemaJsonText: getFormString(form, 'params_schema_json'),
      definitionJsonText: getFormString(form, 'definition_json'),
      codeText: getFormString(form, 'code_text')
    });

    if (!parsed.success) {
      return reply.status(400).renderPage('macros/new.ejs', {
        errorMessage: 'Please provide ref, namespace, name, version and kind.',
        form: {
          ref: getFormString(form, 'ref'),
          namespace: getFormString(form, 'namespace'),
          name: getFormString(form, 'name'),
          version: getFormString(form, 'version'),
          description: getFormString(form, 'description'),
          enabled: Object.prototype.hasOwnProperty.call(form, 'enabled'),
          kind: getFormString(form, 'kind') || 'json',
          params_schema_json: getFormString(form, 'params_schema_json'),
          definition_json: getFormString(form, 'definition_json'),
          code_text: getFormString(form, 'code_text')
        }
      });
    }

    try {
      const paramsSchemaJson = parseOptionalJsonField(parsed.data.paramsSchemaJsonText, 'params_schema_json');
      const definitionJson = parseOptionalJsonField(parsed.data.definitionJsonText, 'definition_json');
      if (parsed.data.kind === 'json' && parsed.data.definitionJsonText?.trim().length && !definitionJson) {
        return reply.status(400).renderPage('macros/new.ejs', {
          errorMessage: 'definition_json must be valid JSON',
          form: {
            ref: parsed.data.ref,
            namespace: parsed.data.namespace,
            name: parsed.data.name,
            version: String(parsed.data.version),
            description: parsed.data.description ?? '',
            enabled: parsed.data.enabled,
            kind: parsed.data.kind,
            params_schema_json: parsed.data.paramsSchemaJsonText ?? '',
            definition_json: parsed.data.definitionJsonText ?? '',
            code_text: parsed.data.codeText ?? ''
          }
        });
      }

      await db.insert(fpMacros).values({
        ref: parsed.data.ref.trim(),
        namespace: parsed.data.namespace.trim(),
        name: parsed.data.name.trim(),
        version: parsed.data.version,
        kind: parsed.data.kind,
        description: parsed.data.description?.trim() || null,
        isEnabled: parsed.data.enabled,
        paramsSchemaJson,
        definitionJson,
        codeText: parsed.data.codeText?.trim() || null,
        updatedAt: new Date()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid macro input';
      return reply.status(400).renderPage('macros/new.ejs', {
        errorMessage: message,
        form: {
          ref: getFormString(form, 'ref'),
          namespace: getFormString(form, 'namespace'),
          name: getFormString(form, 'name'),
          version: getFormString(form, 'version'),
          description: getFormString(form, 'description'),
          enabled: Object.prototype.hasOwnProperty.call(form, 'enabled'),
          kind: getFormString(form, 'kind') || 'json',
          params_schema_json: getFormString(form, 'params_schema_json'),
          definition_json: getFormString(form, 'definition_json'),
          code_text: getFormString(form, 'code_text')
        }
      });
    }

    reply.code(303);
    return reply.redirect(`/macros/${encodeURIComponent(parsed.data.ref)}/edit`);
  });

  app.get('/macros/:ref', async (request, reply) => {
    const parsed = macroRefParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid macro ref' });
    }
    const macro = await db.query.fpMacros.findFirst({ where: eq(fpMacros.ref, parsed.data.ref) });
    if (!macro) {
      return reply.status(404).send({ message: 'Macro not found' });
    }

    await reply.renderPage('macros/detail.ejs', { macro });
  });

  app.get('/macros/:ref/edit', async (request, reply) => {
    const parsed = macroRefParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid macro ref' });
    }
    const macro = await db.query.fpMacros.findFirst({ where: eq(fpMacros.ref, parsed.data.ref) });
    if (!macro) {
      return reply.status(404).send({ message: 'Macro not found' });
    }

    await reply.renderPage('macros/edit.ejs', {
      macro,
      errorMessage: '',
      form: {
        ref: macro.ref,
        namespace: macro.namespace,
        name: macro.name,
        version: String(macro.version),
        description: macro.description ?? '',
        enabled: !!macro.isEnabled,
        kind: macro.kind ?? 'json',
        params_schema_json: macro.paramsSchemaJson ? JSON.stringify(macro.paramsSchemaJson, null, 2) : '',
        definition_json: macro.definitionJson ? JSON.stringify(macro.definitionJson, null, 2) : '',
        code_text: macro.codeText ?? ''
      }
    });
  });

  app.post('/macros/:ref', async (request, reply) => {
    const paramsParsed = macroRefParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Invalid macro ref' });
    }
    const existing = await db.query.fpMacros.findFirst({ where: eq(fpMacros.ref, paramsParsed.data.ref) });
    if (!existing) {
      return reply.status(404).send({ message: 'Macro not found' });
    }

    const form = toFormRecord(request.body);
    const parsed = macroFormSchema.safeParse({
      ref: getFormString(form, 'ref'),
      namespace: getFormString(form, 'namespace'),
      name: getFormString(form, 'name'),
      version: getFormString(form, 'version'),
      description: getFormString(form, 'description'),
      enabled: Object.prototype.hasOwnProperty.call(form, 'enabled'),
      kind: getFormString(form, 'kind') || 'json',
      paramsSchemaJsonText: getFormString(form, 'params_schema_json'),
      definitionJsonText: getFormString(form, 'definition_json'),
      codeText: getFormString(form, 'code_text')
    });

    if (!parsed.success) {
      return reply.status(400).renderPage('macros/edit.ejs', {
        macro: existing,
        errorMessage: 'Please provide ref, namespace, name, version and kind.',
        form: {
          ref: getFormString(form, 'ref'),
          namespace: getFormString(form, 'namespace'),
          name: getFormString(form, 'name'),
          version: getFormString(form, 'version'),
          description: getFormString(form, 'description'),
          enabled: Object.prototype.hasOwnProperty.call(form, 'enabled'),
          kind: getFormString(form, 'kind') || 'json',
          params_schema_json: getFormString(form, 'params_schema_json'),
          definition_json: getFormString(form, 'definition_json'),
          code_text: getFormString(form, 'code_text')
        }
      });
    }

    try {
      const paramsSchemaJson = parseOptionalJsonField(parsed.data.paramsSchemaJsonText, 'params_schema_json');
      const definitionJson = parseOptionalJsonField(parsed.data.definitionJsonText, 'definition_json');

      await db
        .update(fpMacros)
        .set({
          ref: parsed.data.ref.trim(),
          namespace: parsed.data.namespace.trim(),
          name: parsed.data.name.trim(),
          version: parsed.data.version,
          kind: parsed.data.kind,
          description: parsed.data.description?.trim() || null,
          isEnabled: parsed.data.enabled,
          paramsSchemaJson,
          definitionJson,
          codeText: parsed.data.codeText?.trim() || null,
          updatedAt: new Date()
        })
        .where(eq(fpMacros.ref, existing.ref));
    } catch (error) {
      return reply.status(400).renderPage('macros/edit.ejs', {
        macro: existing,
        errorMessage: error instanceof Error ? error.message : 'Invalid macro input',
        form: {
          ref: getFormString(form, 'ref'),
          namespace: getFormString(form, 'namespace'),
          name: getFormString(form, 'name'),
          version: getFormString(form, 'version'),
          description: getFormString(form, 'description'),
          enabled: Object.prototype.hasOwnProperty.call(form, 'enabled'),
          kind: getFormString(form, 'kind') || 'json',
          params_schema_json: getFormString(form, 'params_schema_json'),
          definition_json: getFormString(form, 'definition_json'),
          code_text: getFormString(form, 'code_text')
        }
      });
    }

    reply.code(303);
    return reply.redirect(`/macros/${encodeURIComponent(parsed.data.ref)}/edit`);
  });

  app.get('/templates', async (_req, reply) => {
    const templates = await db
      .select({
        id: fpTemplates.id,
        key: fpTemplates.key,
        name: fpTemplates.name,
        description: fpTemplates.description,
        state: fpTemplates.state,
        version: fpTemplates.version
      })
      .from(fpTemplates)
      .orderBy(asc(fpTemplates.name), desc(fpTemplates.version));
    const versionsByKey = new Map<
      string,
      Array<{
        id: string;
        key: string;
        name: string;
        description: string | null;
        state: string;
        version: number;
      }>
    >();
    for (const item of templates) {
      const next = versionsByKey.get(item.key) ?? [];
      next.push(item);
      versionsByKey.set(item.key, next);
    }
    const latestPublishedTemplates = Array.from(versionsByKey.values())
      .map((versions) => versions.find((item) => normalizeTemplateState(item.state) === 'published'))
      .filter((item): item is (typeof templates)[number] => !!item)
      .sort((a, b) => a.name.localeCompare(b.name));

    const templateIds = latestPublishedTemplates.map((item) => item.id);
    const assignmentRows =
      templateIds.length === 0
        ? []
        : await db
            .select({
              templateId: fpTemplateAssignments.templateId,
              groupName: fpGroups.name,
              groupKey: fpGroups.key
            })
            .from(fpTemplateAssignments)
            .innerJoin(fpGroups, eq(fpGroups.id, fpTemplateAssignments.groupId))
            .where(inArray(fpTemplateAssignments.templateId, templateIds))
            .orderBy(asc(fpGroups.name));
    const groupsByTemplateId = assignmentRows.reduce(
      (acc, row) => {
        const next = acc.get(row.templateId) ?? [];
        next.push({ name: row.groupName, key: row.groupKey });
        acc.set(row.templateId, next);
        return acc;
      },
      new Map<string, Array<{ name: string; key: string }>>()
    );
    const templatesWithGroups = latestPublishedTemplates.map((tpl) => {
      const assignedGroups = groupsByTemplateId.get(tpl.id) ?? [];
      const versions = versionsByKey.get(tpl.key) ?? [];
      const latestDraft = versions.find((item) => normalizeTemplateState(item.state) === 'draft');
      return {
        ...tpl,
        assignedGroups,
        assignedGroupCount: assignedGroups.length,
        versions,
        latestDraftId: latestDraft?.id ?? null
      };
    });

    await reply.renderPage('templates/list.ejs', { templates: templatesWithGroups });
  });

  app.get('/templates/new', async (_request, reply) => {
    await reply.renderPage('templates/new.ejs', {
      errorMessage: '',
      form: {
        key: '',
        name: '',
        description: '',
        state: 'draft',
        template_json: JSON.stringify(starterTemplate, null, 2)
      }
    });
  });

  app.post('/templates', async (request, reply) => {
    const form = toFormRecord(request.body);
    const parsed = templateFormSchema.safeParse({
      key: getFormString(form, 'key'),
      name: getFormString(form, 'name'),
      description: getFormString(form, 'description'),
      state: normalizeTemplateState(getFormString(form, 'state')),
      template_json: getFormString(form, 'template_json')
    });

    if (!parsed.success) {
      return reply.status(400).renderPage('templates/new.ejs', {
        errorMessage: 'Please provide key, name, state and template_json.',
        form: {
          key: getFormString(form, 'key'),
          name: getFormString(form, 'name'),
          description: getFormString(form, 'description'),
          state: normalizeTemplateState(getFormString(form, 'state')),
          template_json: getFormString(form, 'template_json')
        }
      });
    }

    let templateJson: ReturnType<typeof parseTemplateEditorJson>;
    try {
      templateJson = parseTemplateEditorJson(parsed.data.template_json);
    } catch (error) {
      return reply.status(400).renderPage('templates/new.ejs', {
        errorMessage: error instanceof Error ? error.message : 'Invalid template_json',
        form: parsed.data
      });
    }

    const inserted = await db
      .insert(fpTemplates)
      .values({
        key: parsed.data.key,
        name: parsed.data.name,
        description: parsed.data.description || null,
        state: parsed.data.state,
        publishedAt: resolvePublishedAtForStateChange(parsed.data.state),
        templateJson,
        version: 1
      })
      .returning({ id: fpTemplates.id });

    const opsGroup = await db.query.fpGroups.findFirst({ where: eq(fpGroups.key, 'ops') });
    if (opsGroup) {
      await db
        .insert(fpTemplateAssignments)
        .values({ templateId: inserted[0].id, groupId: opsGroup.id })
        .onConflictDoNothing();
    }

    reply.code(303);
    return reply.redirect(`/templates/${inserted[0].id}/edit`);
  });

  app.get('/templates/:id/edit', async (request, reply) => {
    const paramsParsed = templateIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Invalid template id' });
    }

    const template = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, paramsParsed.data.id) });
    if (!template) {
      return reply.status(404).send({ message: 'Template not found' });
    }
    const templateState = normalizeTemplateState(template.state);
    if (templateState === 'published') {
      const versions = await loadTemplateVersionsByKey(db, template.key);
      const existingDraft = versions.find((item) => normalizeTemplateState(item.state) === 'draft');
      if (existingDraft) {
        reply.code(303);
        return reply.redirect(`/templates/${existingDraft.id}/edit`);
      }

      const nextVersion = versions.length > 0 ? Math.max(...versions.map((item) => item.version)) + 1 : template.version + 1;
      const inserted = await db
        .insert(fpTemplates)
        .values({
          key: template.key,
          version: nextVersion,
          name: template.name,
          description: template.description ?? null,
          state: 'draft',
          publishedAt: null,
          templateJson: template.templateJson
        })
        .returning({ id: fpTemplates.id });
      const draftId = inserted[0].id;

      const sourceAssignments = await db.query.fpTemplateAssignments.findMany({
        where: eq(fpTemplateAssignments.templateId, template.id)
      });
      if (sourceAssignments.length > 0) {
        await db
          .insert(fpTemplateAssignments)
          .values(sourceAssignments.map((item) => ({ templateId: draftId, groupId: item.groupId })))
          .onConflictDoNothing();
      }

      reply.code(303);
      return reply.redirect(`/templates/${draftId}/edit`);
    }

    const assignmentView = await loadTemplateAssignmentView(db, template.id);

    await reply.renderPage('templates/edit.ejs', {
      template,
      errorMessage: '',
      assignedGroups: assignmentView.assignedGroups,
      assignableGroups: assignmentView.assignableGroups,
      hasGroups: assignmentView.hasGroups,
      form: {
        key: template.key,
        name: template.name,
        description: template.description ?? '',
        state: normalizeTemplateState(template.state),
        template_json: JSON.stringify(template.templateJson, null, 2)
      }
    });
  });

  app.post('/templates/:id', async (request, reply) => {
    const paramsParsed = templateIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Invalid template id' });
    }

    const template = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, paramsParsed.data.id) });
    if (!template) {
      return reply.status(404).send({ message: 'Template not found' });
    }
    const assignmentView = await loadTemplateAssignmentView(db, template.id);

    const form = toFormRecord(request.body);
    const parsed = templateFormSchema.safeParse({
      key: getFormString(form, 'key'),
      name: getFormString(form, 'name'),
      description: getFormString(form, 'description'),
      state: normalizeTemplateState(getFormString(form, 'state')),
      template_json: getFormString(form, 'template_json')
    });

    if (!parsed.success) {
      return reply.status(400).renderPage('templates/edit.ejs', {
        template,
        errorMessage: 'Please provide key, name, state and template_json.',
        assignedGroups: assignmentView.assignedGroups,
        assignableGroups: assignmentView.assignableGroups,
        hasGroups: assignmentView.hasGroups,
        form: {
          key: getFormString(form, 'key'),
          name: getFormString(form, 'name'),
          description: getFormString(form, 'description'),
          state: normalizeTemplateState(getFormString(form, 'state')),
          template_json: getFormString(form, 'template_json')
        }
      });
    }

    let templateJson: ReturnType<typeof parseTemplateEditorJson>;
    try {
      templateJson = parseTemplateEditorJson(parsed.data.template_json);
    } catch (error) {
      return reply.status(400).renderPage('templates/edit.ejs', {
        template,
        errorMessage: error instanceof Error ? error.message : 'Invalid template_json',
        assignedGroups: assignmentView.assignedGroups,
        assignableGroups: assignmentView.assignableGroups,
        hasGroups: assignmentView.hasGroups,
        form: parsed.data
      });
    }

    await db
      .update(fpTemplates)
      .set({
        key: parsed.data.key,
        name: parsed.data.name,
        description: parsed.data.description || null,
        state: parsed.data.state,
        publishedAt: resolvePublishedAtForStateChange(parsed.data.state, (template as any).publishedAt ?? null),
        templateJson
      })
      .where(eq(fpTemplates.id, template.id));

    reply.code(303);
    return reply.redirect(`/templates/${template.id}/edit`);
  });

  app.post('/templates/:id/publish', async (request, reply) => {
    const paramsParsed = templateIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Invalid template id' });
    }

    const template = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, paramsParsed.data.id) });
    if (!template) {
      return reply.status(404).send({ message: 'Template not found' });
    }
    if (normalizeTemplateState(template.state) !== 'draft') {
      return reply.status(400).send({ message: 'Only draft templates can be published.' });
    }

    await db
      .update(fpTemplates)
      .set({ state: 'archived', publishedAt: null })
      .where(and(eq(fpTemplates.key, template.key), eq(fpTemplates.state, 'published')));

    await db
      .update(fpTemplates)
      .set({ state: 'published', publishedAt: new Date() })
      .where(eq(fpTemplates.id, template.id));

    reply.code(303);
    return reply.redirect('/templates');
  });

  app.post('/templates/:id/assignments', async (request, reply) => {
    const parsedParams = templateIdParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ message: 'Invalid template id' });
    }

    const form = toFormRecord(request.body);
    const parsedBody = assignmentBodySchema.safeParse({
      groupId: getFormString(form, 'groupId')
    });
    if (!parsedBody.success) {
      return reply.status(400).send({ message: 'Invalid groupId' });
    }

    const template = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, parsedParams.data.id) });
    if (!template) {
      return reply.status(404).send({ message: 'Template not found' });
    }
    const group = await db.query.fpGroups.findFirst({ where: eq(fpGroups.id, parsedBody.data.groupId) });
    if (!group) {
      return reply.status(404).send({ message: 'Group not found' });
    }

    await db
      .insert(fpTemplateAssignments)
      .values({ templateId: template.id, groupId: group.id })
      .onConflictDoNothing();

    reply.code(303);
    return reply.redirect(`/templates/${template.id}/edit`);
  });

  app.post('/templates/:id/assignments/:assignmentId/delete', async (request, reply) => {
    const parsed = assignmentParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid assignment params' });
    }

    const template = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, parsed.data.id) });
    if (!template) {
      return reply.status(404).send({ message: 'Template not found' });
    }

    await db
      .delete(fpTemplateAssignments)
      .where(and(eq(fpTemplateAssignments.id, parsed.data.assignmentId), eq(fpTemplateAssignments.templateId, template.id)));

    reply.code(303);
    return reply.redirect(`/templates/${template.id}/edit`);
  });

  app.get('/templates/:id/preview', async (request, reply) => {
    const paramsParsed = templateIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Invalid template id' });
    }

    const template = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, paramsParsed.data.id) });
    if (!template) {
      return reply.status(404).send({ message: 'Template not found' });
    }

    const templateJson = parseTemplateJson(template.templateJson);
    const layoutHtml = renderLayout({ mode: 'preview', templateJson });

    await reply.renderPage('templates/preview.ejs', {
      template,
      templateJson,
      layoutHtml
    });
  });

  app.get('/documents/new', async (request, reply) => {
    const query = toFormRecord(request.query);
    let templateId = getFormString(query, 'templateId');
    const templateKey = getFormString(query, 'templateKey');
    if (!templateId && templateKey) {
      const publishedByKey = await db
        .select({ id: fpTemplates.id })
        .from(fpTemplates)
        .where(and(eq(fpTemplates.key, templateKey), eq(fpTemplates.state, 'published')))
        .orderBy(desc(fpTemplates.version))
        .limit(1);
      templateId = publishedByKey[0]?.id ?? '';
    }
    if (!templateId) {
      const templates = await db.query.fpTemplates.findMany({
        where: eq(fpTemplates.state, 'published'),
        orderBy: asc(fpTemplates.name)
      });

      await reply.renderPage('documents/new.ejs', {
        templates,
        selectedTemplateId: ''
      });
      return;
    }

    const queryParsed = templateIdQuerySchema.safeParse({ templateId });
    if (!queryParsed.success) {
      return reply.status(400).send({ message: 'Please start from a valid template.' });
    }

    const template = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, queryParsed.data.templateId) });
    if (!template) {
      return reply.status(404).send({ message: 'Template not found' });
    }
    if (normalizeTemplateState(template.state) !== 'published') {
      return reply.status(400).send({ message: 'Only published templates can be used to create documents.' });
    }
    const latestPublished =
      typeof (db as any).select === 'function'
        ? await db
            .select({ id: fpTemplates.id })
            .from(fpTemplates)
            .where(and(eq(fpTemplates.key, template.key), eq(fpTemplates.state, 'published')))
            .orderBy(desc(fpTemplates.version))
        : [];
    const latestPublishedId = latestPublished[0]?.id ?? template.id;
    if (latestPublishedId !== template.id) {
      reply.code(303);
      return reply.redirect(`/documents/new?templateId=${latestPublishedId}`);
    }

    const templateJson = parseTemplateJson(template.templateJson);
    const assignmentContext = await resolveTemplateAssignmentContext(db, template.id);
    const initialStatus = String(templateJson.workflow.initial ?? '').trim();
    const editableKeys = resolveEditableFieldKeys(templateJson, initialStatus);
    const readonlyKeys = resolveReadonlyFieldKeys(templateJson, initialStatus);
    const layoutHtml = renderLayout({
      mode: 'new',
      templateJson,
      templateId: template.id,
      documentStatus: initialStatus,
      editableKeys,
      readonlyKeys
    });

    await reply.renderPage('documents/new.ejs', {
      template,
      templateJson,
      layoutHtml,
      templates: [],
      selectedTemplateId: template.id,
      unassignedTemplateWarning: assignmentContext.isUnassigned,
      assignedGroupName:
        assignmentContext.chosenGroupName && !assignmentContext.hasMultipleAssignments
          ? assignmentContext.chosenGroupName
          : '',
      groupChosenNote:
        assignmentContext.hasMultipleAssignments && assignmentContext.chosenGroupName
          ? `Group chosen: ${assignmentContext.chosenGroupName}`
          : ''
    });
  });

  app.get('/documents', async (request, reply) => {
    const query = toFormRecord(request.query);
    const statusFilter = normalizeOptionalFilter(getFormString(query, 'status'));
    const templateIdFilterRaw = normalizeOptionalFilter(getFormString(query, 'templateId'));
    const groupIdFilterRaw = normalizeOptionalFilter(getFormString(query, 'groupId'));
    const templateIdFilter = z.string().uuid().safeParse(templateIdFilterRaw).success ? templateIdFilterRaw : '';
    const groupIdFilter = z.string().uuid().safeParse(groupIdFilterRaw).success ? groupIdFilterRaw : '';

    const whereConditions = [];
    if (statusFilter) whereConditions.push(eq(fpDocuments.status, statusFilter));
    if (templateIdFilter) whereConditions.push(eq(fpDocuments.templateId, templateIdFilter));
    if (groupIdFilter) whereConditions.push(eq(fpDocuments.groupId, groupIdFilter));

    const items = await db
      .select({
        id: fpDocuments.id,
        createdAt: fpDocuments.createdAt,
        status: fpDocuments.status,
        groupId: fpDocuments.groupId,
        templateId: fpDocuments.templateId,
        snapshotsJson: fpDocuments.snapshotsJson,
        groupName: fpGroups.name,
        templateKey: fpTemplates.key,
        templateName: fpTemplates.name
      })
      .from(fpDocuments)
      .innerJoin(fpTemplates, eq(fpTemplates.id, fpDocuments.templateId))
      .leftJoin(fpGroups, eq(fpGroups.id, fpDocuments.groupId))
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
      .orderBy(desc(fpDocuments.createdAt));

    const documents = items.map((item) => ({
      ...item,
      snapshotPreview: snapshotPreviewList(item.snapshotsJson)
    }));
    const templates = await db
      .select({ id: fpTemplates.id, name: fpTemplates.name, key: fpTemplates.key })
      .from(fpTemplates)
      .where(eq(fpTemplates.state, 'published'))
      .orderBy(asc(fpTemplates.name));
    const groups = await db
      .select({ id: fpGroups.id, name: fpGroups.name, key: fpGroups.key })
      .from(fpGroups)
      .orderBy(asc(fpGroups.name));
    const statuses = await db
      .select({ status: fpDocuments.status })
      .from(fpDocuments)
      .orderBy(asc(fpDocuments.status));
    const statusOptions = Array.from(new Set(statuses.map((item) => item.status))).filter((item) => item.trim().length > 0);

    await reply.renderPage('documents/index.ejs', {
      documents,
      filters: {
        status: statusFilter,
        templateId: templateIdFilter,
        groupId: groupIdFilter
      },
      templates,
      groups,
      statusOptions
    });
  });

  app.get('/workspaces/me', async (request, reply) => {
    const currentUser = request.currentUser as CurrentUser | null;
    if (!currentUser) {
      return sendUiError(request, reply, 403, 'No active user. Go to /admin or use the user dropdown.');
    }

    const memberships = await db
      .select({
        groupId: fpGroupMembers.groupId,
        rights: fpGroupMembers.rights,
        groupKey: fpGroups.key,
        groupName: fpGroups.name
      })
      .from(fpGroupMembers)
      .innerJoin(fpGroups, eq(fpGroups.id, fpGroupMembers.groupId))
      .where(eq(fpGroupMembers.userId, currentUser.id))
      .orderBy(asc(fpGroups.name));
    const rightsByGroupId = new Map(memberships.map((item) => [item.groupId, item.rights]));

    if (!hasDocumentActorColumns) {
      await reply.renderPage('workspaces/me.ejs', {
        memberships,
        tasks: [],
        tasksUnavailableMessage:
          'My tasks are unavailable until DB migration is applied. Run: cd app && npm run db:push'
      });
      return;
    }

    const rawTaskRows = await db
      .select({
        id: fpDocuments.id,
        createdAt: fpDocuments.createdAt,
        status: fpDocuments.status,
        editorUserId: fpDocuments.editorUserId,
        approverUserId: fpDocuments.approverUserId,
        assigneeUserId: fpDocuments.assigneeUserId,
        reviewerUserId: fpDocuments.reviewerUserId,
        groupId: fpDocuments.groupId,
        groupName: fpGroups.name,
        templateKey: fpTemplates.key,
        templateName: fpTemplates.name
      })
      .from(fpDocuments)
      .innerJoin(fpTemplates, eq(fpTemplates.id, fpDocuments.templateId))
      .leftJoin(fpGroups, eq(fpGroups.id, fpDocuments.groupId))
      .where(
        or(
          eq(fpDocuments.editorUserId, currentUser.id),
          eq(fpDocuments.approverUserId, currentUser.id),
          eq(fpDocuments.assigneeUserId, currentUser.id),
          eq(fpDocuments.reviewerUserId, currentUser.id)
        )
      )
      .orderBy(desc(fpDocuments.createdAt));
    const taskRows = rawTaskRows
      .map((item) => {
        const userGroupRights = item.groupId ? rightsByGroupId.get(item.groupId) ?? '' : '';
        const editorUserId = item.editorUserId ?? item.assigneeUserId;
        const approverUserId = item.approverUserId ?? item.reviewerUserId;
        const isEditorAssigned = editorUserId === currentUser.id;
        const isApproverAssigned = approverUserId === currentUser.id;
        if (!isEditorAssigned && !isApproverAssigned) return null;

        const normalizedStatus = item.status.trim().toLowerCase();
        const role: 'Editor' | 'Approver' =
          isEditorAssigned && isApproverAssigned
            ? normalizedStatus === 'submitted' || normalizedStatus === 'approved'
              ? 'Approver'
              : 'Editor'
            : isEditorAssigned
              ? 'Editor'
              : 'Approver';
        const taskState = resolveTaskStateForUser({
          role,
          status: item.status,
          rights: userGroupRights
        });
        return { ...item, role, taskState };
      })
      .filter(
        (item): item is (typeof rawTaskRows)[number] & { role: 'Editor' | 'Approver'; taskState: 'open' | 'waiting' | 'done' } =>
          !!item
      )
      .sort((a, b) => {
        const stateRank: Record<'open' | 'waiting' | 'done', number> = {
          open: 0,
          waiting: 1,
          done: 2
        };
        return stateRank[a.taskState] - stateRank[b.taskState];
      });

    await reply.renderPage('workspaces/me.ejs', {
      memberships,
      tasks: taskRows,
      tasksUnavailableMessage: ''
    });
  });

  app.get('/workspaces/groups/:groupId', async (request, reply) => {
    const parsed = groupIdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid group id' });
    }
    const currentUser = request.currentUser as CurrentUser | null;
    if (!currentUser) {
      return reply.status(403).send({ message: 'No active user. Go to /admin or use the user dropdown.' });
    }

    const membership = await db.query.fpGroupMembers.findFirst({
      where: and(eq(fpGroupMembers.groupId, parsed.data.groupId), eq(fpGroupMembers.userId, currentUser.id))
    });
    if (!membership) {
      return reply.status(403).send({ message: 'Forbidden: not a member of this group workspace' });
    }

    const group = await db.query.fpGroups.findFirst({ where: eq(fpGroups.id, parsed.data.groupId) });
    if (!group) {
      return reply.status(404).send({ message: 'Group not found' });
    }

    const templateRows = await db
      .select({
        assignmentId: fpTemplateAssignments.id,
        templateId: fpTemplates.id,
        templateKey: fpTemplates.key,
        templateName: fpTemplates.name,
        templateState: fpTemplates.state
      })
      .from(fpTemplateAssignments)
      .innerJoin(fpTemplates, eq(fpTemplates.id, fpTemplateAssignments.templateId))
      .where(eq(fpTemplateAssignments.groupId, group.id))
      .orderBy(asc(fpTemplates.name));

    const docs = await db
      .select({
        id: fpDocuments.id,
        createdAt: fpDocuments.createdAt,
        status: fpDocuments.status,
        snapshotsJson: fpDocuments.snapshotsJson,
        templateKey: fpTemplates.key,
        templateName: fpTemplates.name
      })
      .from(fpDocuments)
      .innerJoin(fpTemplates, eq(fpTemplates.id, fpDocuments.templateId))
      .where(eq(fpDocuments.groupId, group.id))
      .orderBy(desc(fpDocuments.createdAt));

    const documents = docs.map((doc) => ({
      ...doc,
      snapshotPreview: snapshotPreviewList(doc.snapshotsJson),
      bucket: classifyStatusBucket(doc.status)
    }));

    const bucketCounts = {
      Open: documents.filter((item) => item.bucket === 'Open').length,
      InProgress: documents.filter((item) => item.bucket === 'In Progress').length,
      Done: documents.filter((item) => item.bucket === 'Done').length
    };

    await reply.renderPage('workspaces/group.ejs', {
      group,
      templates: templateRows,
      documents,
      bucketCounts
    });
  });

  app.post('/documents', async (request, reply) => {
    const form = toFormRecord(request.body);
    const templateId = getFormString(form, 'templateId');

    if (!z.string().uuid().safeParse(templateId).success) {
      return reply.status(400).send({ message: 'Please start from a template. Missing or invalid templateId.' });
    }

    const selectedTemplate = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, templateId) });
    if (!selectedTemplate) {
      return reply.status(404).send({ message: 'Template not found' });
    }
    if (normalizeTemplateState(selectedTemplate.state) !== 'published') {
      return reply.status(400).send({ message: 'Only published templates can create documents.' });
    }
    const latestPublishedRows =
      typeof (db as any).select === 'function'
        ? await db
            .select({
              id: fpTemplates.id,
              key: fpTemplates.key,
              name: fpTemplates.name,
              description: fpTemplates.description,
              state: fpTemplates.state,
              version: fpTemplates.version,
              templateJson: fpTemplates.templateJson,
              publishedAt: fpTemplates.publishedAt
            })
            .from(fpTemplates)
            .where(and(eq(fpTemplates.key, selectedTemplate.key), eq(fpTemplates.state, 'published')))
            .orderBy(desc(fpTemplates.version))
        : [];
    const template = latestPublishedRows[0] ?? selectedTemplate;

    const templateJson = parseTemplateJson(template.templateJson);
    const assignmentContext = await resolveTemplateAssignmentContext(db, template.id);
    const externalRefs: Record<string, string> = {};
    const snapshots: Record<string, string> = {};
    const data: Record<string, unknown> = {};

    for (const fieldKey of orderedFieldKeys(templateJson)) {
      const field = templateJson.fields[fieldKey] as TemplateField;

      if (field.kind === 'lookup') {
        const selectedId = getFormString(form, `lookup:${fieldKey}`);
        if (!selectedId) {
          continue;
        }

        externalRefs[fieldKey] = selectedId;

        try {
          const source = normalizeLookupSource(field);
          const { valueField, labelField } = resolveLookupFieldNames(field);
          const options = await fetchLookupOptions(erpBaseUrl, source, externalRefs, valueField, labelField);
          const selectedOption = options.find((item) => item.value === selectedId);

          if (selectedOption) {
            snapshots[fieldKey] = selectedOption.label;
          }
        } catch {
          // Snapshot enrichment is best-effort and must not block document creation.
        }

        continue;
      }

      if (isEditableFieldKind(field.kind)) {
        data[fieldKey] = resolveEditableFormValue(form, field, fieldKey);
      }
    }

    try {
      await ensureErpCustomerOrderReference({
        templateJson,
        externalRefs,
        snapshots,
        data,
        erpBaseUrl
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create ERP customer order';
      return reply.status(502).send({ message });
    }

    const baseCreateData = sanitizeStatusSourceOfTruthData(data);
    const splitCreate = hasDocumentActorColumns
      ? splitDocumentActorColumns(baseCreateData)
      : { dataJson: baseCreateData, editorUserId: undefined, approverUserId: undefined };

    const inserted = await db
      .insert(fpDocuments)
      .values({
        templateId: template.id,
        ...(hasDocumentTemplateVersion ? { templateVersion: template.version ?? 1 } : {}),
        status: templateJson.workflow.initial,
        groupId: assignmentContext.chosenGroupId,
        ...(hasDocumentActorColumns
          ? {
              editorUserId: splitCreate.editorUserId ?? null,
              approverUserId: splitCreate.approverUserId ?? null,
              assigneeUserId: splitCreate.editorUserId ?? null,
              reviewerUserId: splitCreate.approverUserId ?? null
            }
          : {}),
        dataJson: splitCreate.dataJson,
        externalRefsJson: externalRefs,
        snapshotsJson: snapshots
      })
      .returning({ id: fpDocuments.id });

    reply.code(303);
    return reply.redirect(`/documents/${inserted[0].id}`);
  });

  app.get('/documents/:id', async (request, reply) => {
    const paramsParsed = documentIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Invalid document id' });
    }

    const document = await loadDocumentById(db, paramsParsed.data.id, hasDocumentActorColumns, hasDocumentTemplateVersion);
    if (!document) {
      return reply.status(404).send({ message: 'Document not found' });
    }

    const template = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, document.templateId) });
    if (!template) {
      return reply.status(404).send({ message: 'Template not found' });
    }

    const assignmentGroupId = await resolveDocumentRbacGroupId(db, document);
    const groupName = await resolveGroupName(db, document.groupId ?? assignmentGroupId ?? null);
    const query = toFormRecord(request.query);
    const errorFromQuery = normalizeOptionalFilter(getFormString(query, 'error'));

    await renderDocumentDetailPage({
      db,
      hasDocumentActorColumns,
      reply,
      template,
      document,
      assignmentGroupId,
      groupName,
      ...(errorFromQuery ? { errorMessage: errorFromQuery } : {})
    });
  });

  app.post('/documents/:id/save', async (request, reply) => {
    const paramsParsed = documentIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Invalid document id' });
    }

    const document = await loadDocumentById(db, paramsParsed.data.id, hasDocumentActorColumns, hasDocumentTemplateVersion);
    if (!document) {
      return reply.status(404).send({ message: 'Document not found' });
    }
    const rbacGroupIdForSave = await resolveDocumentRbacGroupId(db, document);
    if (rbacGroupIdForSave) {
      const currentUser = request.currentUser as CurrentUser | null;
      if (!currentUser) {
        return sendUiError(request, reply, 403, 'No active user. Go to /admin or use the user dropdown.');
      }
      const groupMembers = await db.query.fpGroupMembers.findMany({
        where: eq(fpGroupMembers.groupId, rbacGroupIdForSave)
      });
      const membership = groupMembers.find((item) => item.userId === currentUser.id);
      const userRights = membership?.rights ?? '';
      if (!membership || !hasRequiredRights(userRights, ['write'])) {
        return sendUiError(
          request,
          reply,
          403,
          `Forbidden: requires ${describeRequiredRights(['write'])}, user has ${userRights || '-'}`
        );
      }
    }

    const template = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, document.templateId) });
    if (!template) {
      return reply.status(404).send({ message: 'Template not found' });
    }

    const templateJson = parseTemplateJson(template.templateJson);
    const form = toFormRecord(request.body);
    const editableKeys = resolveEditableFieldKeys(templateJson, document.status);
    const baseSaveData = sanitizeStatusSourceOfTruthData(
      applyEditableDataUpdate(templateJson, (document.dataJson ?? {}) as Record<string, unknown>, form, editableKeys)
    );
    const splitSave = hasDocumentActorColumns
      ? splitDocumentActorColumns(baseSaveData)
      : { dataJson: baseSaveData, editorUserId: undefined, approverUserId: undefined };

    await db
      .update(fpDocuments)
      .set({
        dataJson: splitSave.dataJson,
        ...(hasDocumentActorColumns && splitSave.editorUserId !== undefined
          ? { editorUserId: splitSave.editorUserId, assigneeUserId: splitSave.editorUserId }
          : {}),
        ...(hasDocumentActorColumns && splitSave.approverUserId !== undefined
          ? { approverUserId: splitSave.approverUserId, reviewerUserId: splitSave.approverUserId }
          : {})
      })
      .where(eq(fpDocuments.id, document.id));

    reply.code(303);
    return reply.redirect(`/documents/${document.id}`);
  });

  const setDocumentEditorAssignment = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!hasDocumentActorColumns) {
      return sendUiError(
        request,
        reply,
        503,
        'Assignments unavailable: DB missing editor_user_id/approver_user_id. Run: cd app && npm run db:push'
      );
    }
    const paramsParsed = documentIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return sendUiError(request, reply, 400, 'Invalid document id');
    }
    const form = toFormRecord(request.body);
    const bodyParsed = documentAssignmentBodySchema.safeParse({
      userId: getFormString(form, 'userId')
    });
    if (!bodyParsed.success) {
      return sendUiError(request, reply, 400, 'Invalid userId');
    }

    const document = await loadDocumentById(db, paramsParsed.data.id, hasDocumentActorColumns, hasDocumentTemplateVersion);
    if (!document) {
      return sendUiError(request, reply, 404, 'Document not found');
    }
    const assignmentGroupId = await resolveDocumentRbacGroupId(db, document);
    if (!assignmentGroupId) return sendUiError(request, reply, 400, 'No group assigned');

    const currentUser = request.currentUser as CurrentUser | null;
    if (!currentUser) {
      return sendUiError(request, reply, 403, 'No active user. Go to /admin or use the user dropdown.');
    }

    const groupMembers = await db.query.fpGroupMembers.findMany({
      where: eq(fpGroupMembers.groupId, assignmentGroupId)
    });
    const actorMembership = groupMembers.find((item) => item.userId === currentUser.id);
    const actorRights = actorMembership?.rights ?? '';
    if (!actorMembership || !hasRequiredRights(actorRights, ['execute'])) {
      return sendUiError(
        request,
        reply,
        403,
        `Forbidden: requires ${describeRequiredRights(['execute'])}, user has ${actorRights || '-'}`
      );
    }
    const targetMembership = groupMembers.find((item) => item.userId === bodyParsed.data.userId);
    if (!targetMembership) {
      return sendUiError(request, reply, 400, 'Selected user is not a member of the document group');
    }
    if (!targetMembership.rights.includes('w')) {
      return sendUiError(request, reply, 400, 'Selected user lacks write rights for editor assignment');
    }

    await db
      .update(fpDocuments)
      .set({ editorUserId: bodyParsed.data.userId, assigneeUserId: bodyParsed.data.userId })
      .where(eq(fpDocuments.id, document.id));

    reply.code(303);
    return reply.redirect(`/documents/${document.id}`);
  };

  const setDocumentApproverAssignment = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!hasDocumentActorColumns) {
      return sendUiError(
        request,
        reply,
        503,
        'Assignments unavailable: DB missing editor_user_id/approver_user_id. Run: cd app && npm run db:push'
      );
    }
    const paramsParsed = documentIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return sendUiError(request, reply, 400, 'Invalid document id');
    }
    const form = toFormRecord(request.body);
    const bodyParsed = documentAssignmentBodySchema.safeParse({
      userId: getFormString(form, 'userId')
    });
    if (!bodyParsed.success) {
      return sendUiError(request, reply, 400, 'Invalid userId');
    }

    const document = await loadDocumentById(db, paramsParsed.data.id, hasDocumentActorColumns, hasDocumentTemplateVersion);
    if (!document) {
      return sendUiError(request, reply, 404, 'Document not found');
    }
    const assignmentGroupId = await resolveDocumentRbacGroupId(db, document);
    if (!assignmentGroupId) return sendUiError(request, reply, 400, 'No group assigned');

    const currentUser = request.currentUser as CurrentUser | null;
    if (!currentUser) {
      return sendUiError(request, reply, 403, 'No active user. Go to /admin or use the user dropdown.');
    }

    const groupMembers = await db.query.fpGroupMembers.findMany({
      where: eq(fpGroupMembers.groupId, assignmentGroupId)
    });
    const actorMembership = groupMembers.find((item) => item.userId === currentUser.id);
    const actorRights = actorMembership?.rights ?? '';
    if (!actorMembership || !hasRequiredRights(actorRights, ['execute'])) {
      return sendUiError(
        request,
        reply,
        403,
        `Forbidden: requires ${describeRequiredRights(['execute'])}, user has ${actorRights || '-'}`
      );
    }
    const targetMembership = groupMembers.find((item) => item.userId === bodyParsed.data.userId);
    if (!targetMembership) {
      return sendUiError(request, reply, 400, 'Selected user is not a member of the document group');
    }
    if (!targetMembership.rights.includes('x')) {
      return sendUiError(request, reply, 400, 'Selected user lacks execute rights for approver assignment');
    }

    await db
      .update(fpDocuments)
      .set({ approverUserId: bodyParsed.data.userId, reviewerUserId: bodyParsed.data.userId })
      .where(eq(fpDocuments.id, document.id));

    reply.code(303);
    return reply.redirect(`/documents/${document.id}`);
  };

  app.post('/documents/:id/assign/editor', setDocumentEditorAssignment);
  app.post('/documents/:id/assign/approver', setDocumentApproverAssignment);
  // Backward compatibility.
  app.post('/documents/:id/assignments/editor', setDocumentEditorAssignment);
  app.post('/documents/:id/assignments/approver', setDocumentApproverAssignment);

  app.get('/documents/:id/action/:controlKey', async (request, reply) => {
    const paramsParsed = documentActionParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Invalid action params' });
    }

    reply.code(303);
    return reply.redirect(`/documents/${paramsParsed.data.id}`);
  });

  app.post('/documents/:id/action/:controlKey', async (request, reply) => {
    const paramsParsed = documentActionParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Invalid action params' });
    }

    const document = await loadDocumentById(db, paramsParsed.data.id, hasDocumentActorColumns, hasDocumentTemplateVersion);
    if (!document) {
      return reply.status(404).send({ message: 'Document not found' });
    }

    const template = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, document.templateId) });
    if (!template) {
      return reply.status(404).send({ message: 'Template not found' });
    }

    const templateJson = parseTemplateJson(template.templateJson);
    const redirectWithActionError = (message: string) => {
      const next = new URL(`/documents/${document.id}`, 'http://localhost');
      next.searchParams.set('error', message.slice(0, 500));
      reply.code(303);
      return reply.redirect(`${next.pathname}${next.search}`);
    };
    const assignmentGroupId = await resolveDocumentRbacGroupId(db, document);
    const groupName = await resolveGroupName(db, document.groupId ?? assignmentGroupId ?? null);
    const query = toFormRecord(request.query);
    const source = getFormString(query, 'source');
    const isUiButtonRequest = source === 'ui';
    const layoutButtonKinds = collectLayoutButtonKinds(templateJson);
    const layoutButtonKind = layoutButtonKinds.get(paramsParsed.data.controlKey);
    const isLayoutButtonAction = !!layoutButtonKind;

    if (isUiButtonRequest && !layoutButtonKind) {
      return redirectWithActionError('UI button is not configured in layout.');
    }
    if (isUiButtonRequest && layoutButtonKind === 'process') {
      return redirectWithActionError('UI button cannot execute process action');
    }

    const stateDef = (templateJson.workflow as any)?.states?.[document.status];
    const allowedButtons = Array.isArray(stateDef?.buttons) ? stateDef.buttons : [];

    if (!isUiButtonRequest && !isLayoutButtonAction && !allowedButtons.includes(paramsParsed.data.controlKey)) {
      return redirectWithActionError('Control is not allowed in the current status.');
    }

    const controls = ((templateJson as any).controls ?? {}) as Record<string, { action?: string }>;
    const actions = ((templateJson as any).actions ?? {}) as Record<string, unknown>;
    const actionKey =
      controls[paramsParsed.data.controlKey]?.action ??
      (isLayoutButtonAction && actions[paramsParsed.data.controlKey] ? paramsParsed.data.controlKey : undefined);
    if (!actionKey) {
      return redirectWithActionError('Control action is not configured.');
    }
    const currentUser = request.currentUser as CurrentUser | null;

    app.log.info({
      docId: document.id,
      actionKey,
      source: isUiButtonRequest ? 'ui' : 'process',
      activeUser: currentUser?.username ?? null,
      templateId: document.templateId
    }, 'Action execution requested');

    const required = resolveActionPermissionRequirements(templateJson, paramsParsed.data.controlKey, actionKey);
    const effectiveRequired: PermissionName[] = [...required];
    const rbacGroupId = effectiveRequired.length > 0 ? await resolveDocumentRbacGroupId(db, document) : null;
    if (!currentUser && effectiveRequired.length > 0 && rbacGroupId) {
      return redirectWithActionError('No active user. Go to /admin or use the user dropdown.');
    }

    if (effectiveRequired.length > 0 && rbacGroupId) {
      const groupMembers = await db.query.fpGroupMembers.findMany({
        where: eq(fpGroupMembers.groupId, rbacGroupId)
      });
      const membership = groupMembers.find((item) => item.userId === currentUser!.id);
      const userRights = membership?.rights ?? '';

      if (!membership || !hasRequiredRights(userRights, effectiveRequired)) {
        return redirectWithActionError(
          `Forbidden: requires ${describeRequiredRights(effectiveRequired)}, user has ${userRights || '-'}`
        );
      }
    }

    const controlName = paramsParsed.data.controlKey.toLowerCase();
    const actionName = actionKey.toLowerCase();
    const isSubmitAction = controlName.includes('submit') || actionName.includes('submit');
    const isApproveOrRejectAction =
      controlName.includes('approve') ||
      controlName.includes('reject') ||
      actionName.includes('approve') ||
      actionName.includes('reject');

    if (isSubmitAction && document.editorUserId && currentUser && currentUser.id !== document.editorUserId) {
      return redirectWithActionError('Forbidden: submit is limited to the assigned editor.');
    }
    if (isApproveOrRejectAction && document.approverUserId && currentUser && currentUser.id !== document.approverUserId) {
      return redirectWithActionError('Forbidden: approve/reject is limited to the assigned approver.');
    }

    const form = toFormRecord(request.body);
    const editableKeys = resolveEditableFieldKeys(templateJson, document.status);
    const baseActionData = sanitizeStatusSourceOfTruthData(
      applyEditableDataUpdate(templateJson, (document.dataJson ?? {}) as Record<string, unknown>, form, editableKeys)
    );
    const splitActionInput = hasDocumentActorColumns
      ? splitDocumentActorColumns(baseActionData)
      : { dataJson: baseActionData, editorUserId: undefined, approverUserId: undefined };
    const nextDataJson = splitActionInput.dataJson;
    const actionDataContext = {
      ...nextDataJson,
      ...(document.editorUserId
        ? { editor_user_id: document.editorUserId, assignee_user_id: document.editorUserId }
        : {}),
      ...(document.approverUserId
        ? { approver_user_id: document.approverUserId, reviewer_user_id: document.approverUserId }
        : {})
    };

    if (isUiButtonRequest && actionKey === 'save') {
      return redirectWithActionError('UI button cannot execute process action');
    }

    if (actionKey === 'save') {
      await db
        .update(fpDocuments)
        .set({
          dataJson: nextDataJson
        })
        .where(eq(fpDocuments.id, document.id));

      reply.code(303);
      return reply.redirect(`/documents/${document.id}`);
    }

    const actionDef = actions[actionKey];
    if (!actionDef) {
      return redirectWithActionError(`Action "${actionKey}" is not defined.`);
    }

    if (isUiButtonRequest && !isUiSafeActionDefinition(actionDef)) {
      return redirectWithActionError('UI button cannot execute process action');
    }

    const runtimeTemplateContext = buildActionRuntimeTemplateContext(templateJson);
    app.log.info(
      {
        docId: document.id,
        templateId: document.templateId,
        actionKey,
        runtime: {
          templateDefinitionExists: !!runtimeTemplateContext.templateDefinition,
          templateDefinitionHasFullSchema: !!runtimeTemplateContext.templateDefinition?.fullSchema,
          schemaExists: !!runtimeTemplateContext.schema,
          dbType: typeof db,
          dbExists: !!db,
          dbHasSelect: typeof (db as any)?.select === 'function',
          dbHasQuery: !!(db as any)?.query
        }
      },
      'Action runtime schema context'
    );

    try {
      const result = await executeActionDefinition({
        actionDef: actionDef as any,
        context: {
          doc: { id: document.id, status: document.status },
          data: actionDataContext,
          external: ((document.externalRefsJson ?? {}) as Record<string, unknown>) ?? {},
          snapshot: ((document.snapshotsJson ?? {}) as Record<string, unknown>) ?? {}
        },
        erpBaseUrl,
        macroContext: {
          db,
          templateJson,
          templateDefinition: runtimeTemplateContext.templateDefinition,
          schema: runtimeTemplateContext.schema,
          document: { id: document.id, status: document.status },
          form
        },
        onMacroEvent: (event) => {
          app.log.info(
            {
              docId: document.id,
              actionKey,
              macroRef: event.macroRef,
              macro: `${event.namespace}/${event.name}@${event.version ?? 'n/a'}`,
              outcome: event.outcome,
              ...(event.errorMessage ? { error: event.errorMessage } : {})
            },
            'Macro execution'
          );
        }
      });

      await db.transaction(async (tx) => {
        const baseActionResultData = sanitizeStatusSourceOfTruthData(result.dataJson);
        const splitActionResult = hasDocumentActorColumns
          ? splitDocumentActorColumns(baseActionResultData)
          : { dataJson: baseActionResultData, editorUserId: undefined, approverUserId: undefined };
        await tx
          .update(fpDocuments)
          .set({
            status: result.status,
            dataJson: splitActionResult.dataJson,
            ...(hasDocumentActorColumns && splitActionResult.editorUserId !== undefined
              ? { editorUserId: splitActionResult.editorUserId, assigneeUserId: splitActionResult.editorUserId }
              : {}),
            ...(hasDocumentActorColumns && splitActionResult.approverUserId !== undefined
              ? { approverUserId: splitActionResult.approverUserId, reviewerUserId: splitActionResult.approverUserId }
              : {}),
            externalRefsJson: sanitizeStatusSourceOfTruthExternalRefs(result.externalRefsJson),
            snapshotsJson: result.snapshotsJson
          })
          .where(eq(fpDocuments.id, document.id));
      });
      reply.code(303);
      return reply.redirect(`/documents/${document.id}`);
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Action execution failed.';
      if (error instanceof ExternalCallError && error.status === 409) {
        message = `Action "${actionKey}" is not valid for current document status "${document.status}" (ERP transition rejected with 409).`;
      }
      if (message.startsWith('Macro not enabled:')) {
        app.log.warn(
          {
            docId: document.id,
            actionKey,
            activeUser: currentUser?.username ?? null,
            error: message
          },
          'Macro execution blocked by catalog gate'
        );
        return reply.status(400).send({ message });
      }
      app.log.info(
        {
          docId: document.id,
          actionKey,
          source: isUiButtonRequest ? 'ui' : 'process',
          activeUser: currentUser?.username ?? null,
          templateId: document.templateId,
          error: message,
          stack: error instanceof Error ? error.stack : undefined
        },
        'Action execution failed'
      );
      return redirectWithActionError(message);
    }
  });

  app.get('/api/lookup', async (request, reply) => {
    try {
      const query = toFormRecord(request.query);
      const parsed = lookupQuerySchema.safeParse(query);

      if (!parsed.success) {
        return reply.type('text/html').send('<option value="">Invalid lookup request</option>');
      }

      const template = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, parsed.data.templateId) });
      if (!template) {
        return reply.type('text/html').send('<option value="">Template not found</option>');
      }

      const templateJson = parseTemplateJson(template.templateJson);
      const field = templateJson.fields[parsed.data.fieldKey] as TemplateField | undefined;

      if (!field || field.kind !== 'lookup') {
        return reply.type('text/html').send('<option value="">Lookup field not found</option>');
      }

      const externalRefs = collectExternalRefsFromQuery(query);
      const source = normalizeLookupSource(field);
      const { valueField, labelField } = resolveLookupFieldNames(field);
      const options = await fetchLookupOptions(erpBaseUrl, source, externalRefs, valueField, labelField);
      const selectedValue = externalRefs[parsed.data.fieldKey] ?? '';

      const html = [
        '<option value="">Please choose...</option>',
        ...options.map((item) => {
          const selected = item.value === selectedValue ? ' selected' : '';
          return `<option value="${escapeHtml(item.value)}"${selected}>${escapeHtml(item.label)}</option>`;
        })
      ].join('');

      return reply.type('text/html').send(html);
    } catch {
      return reply.type('text/html').send('<option value="">Lookup unavailable</option>');
    }
  });
}
