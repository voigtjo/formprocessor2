import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FpDb } from '../db/index.js';
import {
  fpDocuments,
  fpGroupMembers,
  fpGroups,
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
};

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
    states: z.record(z.any()).optional()
  }),
  controls: z.record(z.any()).optional(),
  actions: z.record(z.any()).optional(),
  permissions: z
    .object({
      actions: z
        .record(
          z.object({
            requires: z.array(z.enum(['read', 'write', 'execute'])).optional()
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
    states: z.record(z.any())
  }),
  controls: z.record(z.any()),
  actions: z.record(z.any()),
  permissions: z
    .object({
      actions: z
        .record(
          z.object({
            requires: z.array(z.enum(['read', 'write', 'execute'])).optional()
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
  state: z.string().min(1),
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

const documentIdParamSchema = z.object({
  id: z.string().uuid()
});

const documentActionParamSchema = z.object({
  id: z.string().uuid(),
  controlKey: z.string().min(1)
});

type TemplateJson = z.infer<typeof templateJsonSchema>;

type TemplateField = {
  kind?: string;
  label?: string;
  multiline?: boolean;
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

function parseTemplateJson(raw: unknown): TemplateJson {
  return templateJsonSchema.parse(raw);
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

function resolveActionPermissionRequirements(templateJson: TemplateJson, controlKey: string, actionKey: string) {
  const byActionMap = ((templateJson as any).permissions?.actions ?? {}) as Record<string, { requires?: unknown }>;
  const controlRequires = byActionMap[controlKey]?.requires;
  const actionRequires = byActionMap[actionKey]?.requires;
  const source = Array.isArray(controlRequires) ? controlRequires : Array.isArray(actionRequires) ? actionRequires : [];
  return source.filter((item): item is PermissionName => item === 'read' || item === 'write' || item === 'execute');
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
  const allowedMacros = new Set(['reloadLookup', 'noop', 'showToast']);
  const steps = normalizeActionSteps(actionDef);
  if (steps.length === 0) return false;

  for (const step of steps) {
    if (step.type !== 'macro') return false;
    const macroName = typeof step.name === 'string' ? step.name : '';
    if (!allowedMacros.has(macroName)) return false;
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
  data: Record<string, string>;
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
  const input = field.ui?.input;
  return input === 'date' || input === 'checkbox' ? input : 'text';
}

function resolveEditableFormValue(form: Record<string, unknown>, field: TemplateField, fieldKey: string) {
  const formKey = `data:${fieldKey}`;
  const inputType = resolveEditableInputType(field);
  if (inputType === 'checkbox') {
    return Object.prototype.hasOwnProperty.call(form, formKey) ? 'true' : 'false';
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

function allEditableFieldKeys(templateJson: TemplateJson) {
  return Object.entries(templateJson.fields)
    .filter(([, field]) => (field as TemplateField)?.kind === 'editable')
    .map(([key]) => key);
}

export function resolveEditableFieldKeys(templateJson: TemplateJson, status: string): string[] {
  const fallback = allEditableFieldKeys(templateJson);
  const state = (templateJson.workflow as any)?.states?.[status];
  const configured = Array.isArray(state?.editable) ? state.editable : undefined;
  if (!configured) return fallback;

  const editableSet = new Set(fallback);
  return configured.filter((key: unknown): key is string => typeof key === 'string' && editableSet.has(key));
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
    if (!field || field.kind !== 'editable') continue;
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

async function renderDocumentDetailPage(params: {
  reply: FastifyReply;
  template: { id: string; key: string; name: string; templateJson: unknown };
  document: {
    id: string;
    status: string;
    groupId?: string | null;
    dataJson: unknown;
    externalRefsJson: unknown;
    snapshotsJson: unknown;
  };
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
  const layoutHtml = renderLayout({
    mode: 'detail',
    templateJson,
    templateId: params.template.id,
    documentId: params.document.id,
    documentStatus: params.document.status,
    dataJson: (params.document.dataJson ?? {}) as Record<string, unknown>,
    externalRefsJson: (params.document.externalRefsJson ?? {}) as Record<string, unknown>,
    snapshotsJson: (params.document.snapshotsJson ?? {}) as Record<string, unknown>,
    editableKeys,
    readonlyKeys
  });

  await params.reply.renderPage('documents/detail.ejs', {
    template: params.template,
    templateJson,
    layoutHtml,
    buttonKeys,
    groupName: params.groupName ?? null,
    errorMessage: params.errorMessage,
    document: params.document,
    dataJson: (params.document.dataJson ?? {}) as Record<string, unknown>,
    externalRefsJson: (params.document.externalRefsJson ?? {}) as Record<string, unknown>,
    snapshotsJson: (params.document.snapshotsJson ?? {}) as Record<string, unknown>
  });
}

async function resolveTemplateAssignmentContext(db: FpDb, templateId: string) {
  const assignments = await db.query.fpTemplateAssignments.findMany({
    where: eq(fpTemplateAssignments.templateId, templateId)
  });
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

export async function uiRoutes(app: FastifyInstance, opts: UiRouteOptions) {
  const { db, erpBaseUrl } = opts;

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

  app.get('/admin/debug', async (request, reply) => {
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

    await reply.renderPage('admin/debug.ejs', {
      users,
      groups,
      memberships: membershipRows,
      assignments: assignmentRows,
      latestDocuments: documentRows,
      activeUser: request.currentUser ?? null,
      activeUserCookie: cookieUser
    });
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
      .where(eq(fpTemplates.state, 'active'))
      .orderBy(asc(fpTemplates.name));

    await reply.renderPage('templates/list.ejs', { templates });
  });

  app.get('/templates/new', async (_request, reply) => {
    await reply.renderPage('templates/new.ejs', {
      errorMessage: '',
      form: {
        key: '',
        name: '',
        description: '',
        state: 'active',
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
      state: getFormString(form, 'state') || 'active',
      template_json: getFormString(form, 'template_json')
    });

    if (!parsed.success) {
      return reply.status(400).renderPage('templates/new.ejs', {
        errorMessage: 'Please provide key, name, state and template_json.',
        form: {
          key: getFormString(form, 'key'),
          name: getFormString(form, 'name'),
          description: getFormString(form, 'description'),
          state: getFormString(form, 'state') || 'active',
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
        state: template.state,
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
      state: getFormString(form, 'state') || 'active',
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
          state: getFormString(form, 'state') || 'active',
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
        templateJson
      })
      .where(eq(fpTemplates.id, template.id));

    reply.code(303);
    return reply.redirect(`/templates/${template.id}/edit`);
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
    const templateId = getFormString(query, 'templateId');
    if (!templateId) {
      const templates = await db.query.fpTemplates.findMany({
        where: eq(fpTemplates.state, 'active'),
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

    const templateJson = parseTemplateJson(template.templateJson);
    const assignmentContext = await resolveTemplateAssignmentContext(db, template.id);
    const layoutHtml = renderLayout({
      mode: 'new',
      templateJson,
      templateId: template.id,
      documentStatus: templateJson.workflow.initial
    });

    await reply.renderPage('documents/new.ejs', {
      template,
      templateJson,
      layoutHtml,
      templates: [],
      selectedTemplateId: template.id,
      unassignedTemplateWarning: assignmentContext.isUnassigned,
      groupChosenNote:
        assignmentContext.hasMultipleAssignments && assignmentContext.chosenGroupName
          ? `Group chosen: ${assignmentContext.chosenGroupName}`
          : ''
    });
  });

  app.get('/documents', async (_request, reply) => {
    const items = await db
      .select({
        id: fpDocuments.id,
        createdAt: fpDocuments.createdAt,
        status: fpDocuments.status,
        templateId: fpDocuments.templateId,
        snapshotsJson: fpDocuments.snapshotsJson,
        templateKey: fpTemplates.key,
        templateName: fpTemplates.name
      })
      .from(fpDocuments)
      .innerJoin(fpTemplates, eq(fpTemplates.id, fpDocuments.templateId))
      .orderBy(desc(fpDocuments.createdAt));

    const documents = items.map((item) => ({
      ...item,
      snapshotPreview: snapshotPreviewList(item.snapshotsJson)
    }));

    await reply.renderPage('documents/index.ejs', { documents });
  });

  app.post('/documents', async (request, reply) => {
    const form = toFormRecord(request.body);
    const templateId = getFormString(form, 'templateId');

    if (!z.string().uuid().safeParse(templateId).success) {
      return reply.status(400).send({ message: 'Please start from a template. Missing or invalid templateId.' });
    }

    const template = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, templateId) });
    if (!template) {
      return reply.status(404).send({ message: 'Template not found' });
    }

    const templateJson = parseTemplateJson(template.templateJson);
    const assignmentContext = await resolveTemplateAssignmentContext(db, template.id);
    const externalRefs: Record<string, string> = {};
    const snapshots: Record<string, string> = {};
    const data: Record<string, string> = {};

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

      if (field.kind === 'editable') {
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

    const inserted = await db
      .insert(fpDocuments)
      .values({
        templateId,
        status: templateJson.workflow.initial,
        groupId: assignmentContext.chosenGroupId,
        dataJson: data,
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

    const document = await db.query.fpDocuments.findFirst({ where: eq(fpDocuments.id, paramsParsed.data.id) });
    if (!document) {
      return reply.status(404).send({ message: 'Document not found' });
    }

    const template = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, document.templateId) });
    if (!template) {
      return reply.status(404).send({ message: 'Template not found' });
    }

    const groupName = await resolveGroupName(db, document.groupId ?? null);

    await renderDocumentDetailPage({
      reply,
      template,
      document,
      groupName
    });
  });

  app.post('/documents/:id/save', async (request, reply) => {
    const paramsParsed = documentIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Invalid document id' });
    }

    const document = await db.query.fpDocuments.findFirst({ where: eq(fpDocuments.id, paramsParsed.data.id) });
    if (!document) {
      return reply.status(404).send({ message: 'Document not found' });
    }

    const template = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, document.templateId) });
    if (!template) {
      return reply.status(404).send({ message: 'Template not found' });
    }

    const templateJson = parseTemplateJson(template.templateJson);
    const form = toFormRecord(request.body);
    const editableKeys = resolveEditableFieldKeys(templateJson, document.status);
    const nextDataJson = sanitizeStatusSourceOfTruthData(
      applyEditableDataUpdate(templateJson, (document.dataJson ?? {}) as Record<string, unknown>, form, editableKeys)
    );

    await db
      .update(fpDocuments)
      .set({ dataJson: nextDataJson })
      .where(eq(fpDocuments.id, document.id));

    reply.code(303);
    return reply.redirect(`/documents/${document.id}`);
  });

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

    const document = await db.query.fpDocuments.findFirst({ where: eq(fpDocuments.id, paramsParsed.data.id) });
    if (!document) {
      return reply.status(404).send({ message: 'Document not found' });
    }

    const template = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, document.templateId) });
    if (!template) {
      return reply.status(404).send({ message: 'Template not found' });
    }

    const templateJson = parseTemplateJson(template.templateJson);
    const groupName = await resolveGroupName(db, document.groupId ?? null);
    const query = toFormRecord(request.query);
    const source = getFormString(query, 'source');
    const isUiButtonRequest = source === 'ui';
    const layoutButtonKinds = isUiButtonRequest ? collectLayoutButtonKinds(templateJson) : null;
    const layoutButtonKind = isUiButtonRequest ? layoutButtonKinds?.get(paramsParsed.data.controlKey) : null;

    if (isUiButtonRequest && !layoutButtonKind) {
      return reply.status(400).send({ message: 'UI button is not configured in layout.' });
    }
    if (isUiButtonRequest && layoutButtonKind === 'process') {
      return reply.status(400).send({ message: 'UI button cannot execute process action' });
    }

    const stateDef = (templateJson.workflow as any)?.states?.[document.status];
    const allowedButtons = Array.isArray(stateDef?.buttons) ? stateDef.buttons : [];

    if (!isUiButtonRequest && !allowedButtons.includes(paramsParsed.data.controlKey)) {
      await renderDocumentDetailPage({
        reply,
        template,
        document,
        groupName,
        errorMessage: 'Control is not allowed in the current status.'
      });
      return;
    }

    const controls = ((templateJson as any).controls ?? {}) as Record<string, { action?: string }>;
    const actionKey = controls[paramsParsed.data.controlKey]?.action;
    if (!actionKey) {
      await renderDocumentDetailPage({
        reply,
        template,
        document,
        groupName,
        errorMessage: 'Control action is not configured.'
      });
      return;
    }

    const required = resolveActionPermissionRequirements(templateJson, paramsParsed.data.controlKey, actionKey);
    if (required.length > 0) {
      const currentUser = request.currentUser as CurrentUser | null;
      if (!currentUser) {
        return reply.status(403).send({ message: 'No active user. Go to /admin/debug or use the user dropdown.' });
      }

      if (document.groupId) {
        const groupMembers = await db.query.fpGroupMembers.findMany({
          where: eq(fpGroupMembers.groupId, document.groupId)
        });
        const membership = groupMembers.find((item) => item.userId === currentUser.id);
        const userRights = membership?.rights ?? '';

        if (!membership || !hasRequiredRights(userRights, required)) {
          return reply.status(403).send({
            message: `Forbidden: requires ${describeRequiredRights(required)}, user has ${userRights || '-'}`
          });
        }
      }
    }

    const form = toFormRecord(request.body);
    const editableKeys = resolveEditableFieldKeys(templateJson, document.status);
    const nextDataJson = sanitizeStatusSourceOfTruthData(
      applyEditableDataUpdate(templateJson, (document.dataJson ?? {}) as Record<string, unknown>, form, editableKeys)
    );

    if (isUiButtonRequest && actionKey === 'save') {
      return reply.status(400).send({ message: 'UI button cannot execute process action' });
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

    const actions = ((templateJson as any).actions ?? {}) as Record<string, unknown>;
    const actionDef = actions[actionKey];
    if (!actionDef) {
      await renderDocumentDetailPage({
        reply,
        template,
        document,
        groupName,
        errorMessage: `Action "${actionKey}" is not defined.`
      });
      return;
    }

    if (isUiButtonRequest && !isUiSafeActionDefinition(actionDef)) {
      return reply.status(400).send({ message: 'UI button cannot execute process action' });
    }

    try {
      const result = await executeActionDefinition({
        actionDef: actionDef as any,
        context: {
          doc: { id: document.id, status: document.status },
          data: nextDataJson,
          external: ((document.externalRefsJson ?? {}) as Record<string, unknown>) ?? {},
          snapshot: ((document.snapshotsJson ?? {}) as Record<string, unknown>) ?? {}
        },
        erpBaseUrl,
        macroContext: {
          db,
          templateJson,
          document: { id: document.id, status: document.status },
          form
        }
      });

      await db.transaction(async (tx) => {
        await tx
          .update(fpDocuments)
          .set({
            status: result.status,
            dataJson: sanitizeStatusSourceOfTruthData(result.dataJson),
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
      await renderDocumentDetailPage({
        reply,
        template,
        document,
        groupName,
        errorMessage: message
      });
      return;
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
