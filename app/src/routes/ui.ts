import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FpDb } from '../db/index.js';
import {
  fpDocumentApprovals,
  fpDocumentAttachments,
  fpDocumentAuditEvents,
  fpDocumentEditors,
  fpDocumentSubmissions,
  fpDocuments,
  fpApis,
  fpGroupMembers,
  fpGroups,
  fpMacros,
  fpTemplateMacros,
  fpTemplateAssignments,
  fpTemplates,
  fpUsers,
  fpWorkflows
} from '../db/schema.js';
import { fetchLookupOptions, fetchLookupOptionsDetailed, resolveLookupSource } from '../lookup.js';
import { ExternalCallError, executeActionDefinition } from '../actions/index.js';
import { collectMacroRefsFromActionDefinition, isUiSafeActionDefinition, resolveActionType } from '../actions/policy.js';
import { renderLayout } from '../render/layout.js';
import { extractTemplateUsage } from '../template-analysis.js';
import { listConnectorOperations, resolveConnectorOperation } from '../connectors/registry.js';
import {
  normalizeRequiresValue,
  type PermissionName
} from '../core/authorization.js';
import { executeIntegrationRequest } from '../core/integration-client.js';
import type { AttachmentStorage } from '../core/attachments.js';
import { buildDocumentDeepLink, resolveAppBaseUrl } from '../core/app-links.js';
import type { AuditGateway } from '../core/audit.js';
import type { NotificationGateway, NotificationType } from '../core/notifications.js';
import { evaluateAssignmentTarget, evaluateGroupPermission, findGroupMembership } from '../core/policy.js';
import {
  DOCUMENT_STATES,
  DOCUMENT_WORKFLOW_INITIAL,
  DOCUMENT_WORKFLOW_ORDER,
  TEMPLATE_STATES,
  isArchivedDocumentStatus,
  isDoneDocumentStatus,
  normalizeDocumentStatus,
  normalizeTemplateState
} from '../domain/status-model.js';
import {
  evaluateWorkflow,
  normalizeWorkflowRuntimeModel,
  resolveVisibleButtons,
  resolveNextStatus,
  resolveSubmissionCompletion,
  resolveApprovalCompletion,
  type WorkflowRuntimeModel,
  type EditorSubmissionState,
  type ApproverDecisionState
} from '../domain/workflow-runtime.js';
import { executeWorkflowHookEffects } from '../domain/workflow-hooks.js';
import type { AnyConnectorOperationDefinition } from '../connectors/types.js';

type UiRouteOptions = {
  db: FpDb;
  erpBaseUrl: string;
  hasDocumentActorColumns?: boolean;
  hasDocumentTemplateVersion?: boolean;
  hasDocumentMultiAssignments?: boolean;
  hasDocumentAttachments?: boolean;
  hasDocumentAuditTrail?: boolean;
  appBaseUrl?: string;
  attachmentStorage?: AttachmentStorage;
  auditGateway?: AuditGateway;
  notificationGateway?: NotificationGateway;
};
const templateStateSchema = z.enum(TEMPLATE_STATES);
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
const templateFormCellContentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('field'),
    fieldKey: z.string().min(1)
  }),
  z.object({
    type: z.literal('markdown'),
    text: z.string().default(''),
    style: z.enum(['heading1', 'heading2', 'text', 'hint', 'divider']).optional()
  }),
  z.object({
    type: z.literal('button'),
    action: z.string().min(1),
    label: z.string().optional(),
    key: z.string().optional(),
    kind: z.enum(['ui', 'process']).optional()
  }),
  z.object({
    type: z.literal('spacer'),
    size: z.enum(['sm', 'md', 'lg']).optional()
  }),
  z.object({
    type: z.literal('journal'),
    fieldKey: z.string().min(1)
  }),
  z.object({
    type: z.literal('attachmentArea'),
    title: z.string().optional(),
    helpText: z.string().optional()
  }),
  z.object({
    type: z.literal('attachments'),
    title: z.string().optional(),
    helpText: z.string().optional()
  })
]);
const templateCellAlignSchema = z.union([
  z.enum(['left', 'center', 'right']),
  z.object({
    horizontal: z.enum(['left', 'center', 'right']).optional(),
    vertical: z.enum(['top', 'center', 'bottom']).optional()
  })
]);
const templateFormCellSchema = z.object({
  id: z.string().optional(),
  width: z.union([z.number().int().min(1).max(12), z.string()]).optional(),
  span: z.union([z.number().int().min(1).max(12), z.string()]).optional(),
  align: templateCellAlignSchema.optional(),
  content: templateFormCellContentSchema
});
const templateFormRowSchema = z.object({
  id: z.string().optional(),
  key: z.string().optional(),
  height: z.number().int().min(1).optional(),
  distribution: z.string().optional(),
  cells: z.array(templateFormCellSchema).min(1).max(4)
});
const templateFormSchemaV1 = z.object({
  rows: z.array(templateFormRowSchema)
});
const templateDocumentTableSchema = z.object({
  columns: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().optional()
      })
    )
    .max(8)
    .optional()
});

const templateCoreJsonSchema = z.object({
  fields: z.record(z.any()),
  form: templateFormSchemaV1.optional(),
  layout: z.union([layoutSectionsSchema, layoutNodesSchema]).optional(),
  actions: z.record(z.any()).optional(),
  documentTable: templateDocumentTableSchema.optional()
});

const templateJsonSchema = templateCoreJsonSchema.extend({
  fields: z.record(z.any()),
  form: templateFormSchemaV1.optional(),
  layout: z.union([layoutSectionsSchema, layoutNodesSchema]).optional(),
  fieldAccess: z.record(z.any()).optional(),
  workflow: z.object({
    initial: z.string().optional(),
    order: z.array(z.string()).optional(),
    states: z.record(z.any()).optional()
  }).optional(),
  controls: z.record(z.any()).optional(),
  actions: z.record(z.any()).optional(),
  documentTable: templateDocumentTableSchema.optional(),
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
  form: templateFormSchemaV1.optional(),
  layout: z.array(z.any()).optional(),
  actions: z.record(z.any()).optional(),
  documentTable: templateDocumentTableSchema.optional()
}).strict();

const templateFormSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  state: templateStateSchema,
  workflow_ref: z.string().optional(),
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

const workflowStateSchema = z.enum(['draft', 'active', 'inactive']);
const workflowFormSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  state: workflowStateSchema,
  workflow_json: z.string().min(1)
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
const macroListQuerySchema = z.object({
  templateId: z.string().uuid().optional(),
  templateState: z.enum(['all', 'draft', 'published', 'inactive', 'archived']).optional()
});
const macroKindSchema = z.enum(['json', 'builtin']);
const macroFormSchema = z.object({
  ref: z.string().min(1),
  namespace: z.string().min(1),
  name: z.string().min(1),
  version: z.coerce.number().int().positive(),
  description: z.string().optional(),
  enabled: z.boolean(),
  kind: macroKindSchema,
  paramsSchemaJsonText: z.string().optional(),
  definitionJsonText: z.string().optional()
});
const apiStateSchema = z.enum(['active', 'inactive']);
const apiMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const apiListQuerySchema = z.object({
  state: z.enum(['active', 'inactive', 'all']).optional()
});
const apiFormSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  state: apiStateSchema,
  method: apiMethodSchema,
  baseUrl: z.string().url(),
  path: z.string().min(1),
  requestSchemaJsonText: z.string().optional(),
  responseSchemaJsonText: z.string().optional(),
  handlerCodeText: z.string().optional()
});

const documentIdParamSchema = z.object({
  id: z.string().uuid()
});
const attachmentIdParamSchema = z.object({
  id: z.string().min(1)
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
const documentAttachmentUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  base64Data: z.string().min(1),
  kind: z.enum(['image', 'file']).optional()
});

type TemplateJson = z.infer<typeof templateJsonSchema>;

type TemplateField = {
  kind?: string;
  label?: string;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  inputType?: 'text' | 'date' | 'checkbox' | 'select' | 'journal';
  control?: 'text' | 'date' | 'checkbox' | 'radioGroup' | 'checkboxGroup' | 'journal';
  options?: Array<{ value: string; label?: string; hint?: string }>;
  columns?: Array<{
    key: string;
    label?: string;
    type?: 'text' | 'number' | 'select' | 'checkbox';
    placeholder?: string;
    options?: Array<{ value: string; label?: string }>;
  }>;
  apiRef?: string;
  valueField?: string;
  valueKey?: string;
  labelField?: string;
  labelKey?: string;
  ui?: {
    input?: 'text' | 'date' | 'checkbox' | 'journal';
    placeholder?: string;
  };
  source?: {
    service?: string;
    method?: string;
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

type CurrentUser = { id: string; username: string; displayName: string };
type DocumentAttachmentRow = {
  id: string;
  documentId: string;
  kind: string;
  filename: string;
  mimeType: string;
  size: number;
  storageKey: string;
  uploadedBy: string | null;
  createdAt: Date | null;
};
type DocumentAuditEventType =
  | 'created'
  | 'assigned_editor'
  | 'unassigned_editor'
  | 'assigned_approver'
  | 'unassigned_approver'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'status_changed'
  | 'action_executed'
  | 'workflow_hook_executed'
  | 'workflow_hook_failed'
  | 'attachment_uploaded'
  | 'attachment_removed'
  | 'journal_row_added'
  | 'journal_row_updated'
  | 'journal_row_removed'
  | 'form_updated';
type DocumentAuditEventRow = {
  id: string;
  documentId: string;
  eventType: DocumentAuditEventType | string;
  actorUserId: string | null;
  actorDisplay: string | null;
  summary: string;
  detailJson: Record<string, unknown> | null;
  createdAt: Date | null;
};
type LayoutButtonKind = 'ui' | 'process';
type AdminErpTab = 'products' | 'customers' | 'batches' | 'serial-instances' | 'customer-orders';

function normalizeCellSpan(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.min(12, Math.round(value)));
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return 12;
}

function normalizeCellAlign(value: unknown) {
  if (typeof value === 'string' && ['left', 'center', 'right'].includes(value)) {
    return value;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const horizontal = (value as Record<string, unknown>).horizontal;
    if (typeof horizontal === 'string' && ['left', 'center', 'right'].includes(horizontal)) {
      return horizontal;
    }
  }
  return undefined;
}

function normalizeFormRows(form: z.infer<typeof templateFormSchemaV1>) {
  return {
    rows: form.rows.map((row, rowIndex) => ({
      id: typeof row.id === 'string' && row.id.trim().length > 0 ? row.id : `row-${rowIndex + 1}`,
      key: row.key,
      height: typeof row.height === 'number' ? row.height : undefined,
      distribution: typeof row.distribution === 'string' ? row.distribution : undefined,
      cells: row.cells.map((cell, cellIndex) => ({
        id: typeof cell.id === 'string' && cell.id.trim().length > 0 ? cell.id : `row-${rowIndex + 1}-cell-${cellIndex + 1}`,
        width: normalizeCellSpan(cell.width ?? cell.span),
        align: normalizeCellAlign(cell.align),
        content: cell.content
      }))
    }))
  };
}

function layoutNodeToFormRows(node: unknown, fields: Record<string, unknown>): Array<Record<string, unknown>> {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return [];
  const record = node as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : '';

  if (type === 'group') {
    const rows: Array<Record<string, unknown>> = [];
    if (typeof record.title === 'string' && record.title.trim().length > 0) {
      rows.push({
        cells: [{ width: 12, content: { type: 'markdown', style: 'heading2', text: record.title } }]
      });
    }
    const children = Array.isArray(record.children) ? record.children : [];
    for (const child of children) rows.push(...layoutNodeToFormRows(child, fields));
    return rows;
  }

  if (type === 'row') {
    const rawChildren = Array.isArray(record.children) ? record.children : [];
    const cells = rawChildren
      .map((child) => {
        if (!child || typeof child !== 'object' || Array.isArray(child)) return null;
        const childRecord = child as Record<string, unknown>;
        const isColumn = childRecord.type === 'col';
        const candidate = isColumn
          ? (Array.isArray(childRecord.children) ? childRecord.children[0] : null)
          : childRecord;
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
        const candidateRecord = candidate as Record<string, unknown>;
        const candidateType = typeof candidateRecord.type === 'string' ? candidateRecord.type : '';
        const fieldKey = typeof candidateRecord.key === 'string' ? candidateRecord.key : '';
        let content: Record<string, unknown> | null = null;
        if (candidateType === 'field' && fieldKey) {
          const field = fields[fieldKey] as Record<string, unknown> | undefined;
          content = { type: field?.kind === 'journal' ? 'journal' : 'field', fieldKey };
        } else if (candidateType === 'button') {
          content = {
            type: 'button',
            action: typeof candidateRecord.action === 'string' ? candidateRecord.action : '',
            label: typeof candidateRecord.label === 'string' ? candidateRecord.label : undefined,
            key: fieldKey || undefined,
            kind: typeof candidateRecord.kind === 'string' ? candidateRecord.kind : undefined
          };
        } else if (candidateType === 'text') {
          content = {
            type: 'markdown',
            style: 'text',
            text: typeof candidateRecord.text === 'string' ? candidateRecord.text : ''
          };
        }
        if (!content) return null;
        return {
          width: normalizeCellSpan(isColumn ? childRecord.width : 12),
          align: normalizeCellAlign(isColumn ? childRecord.align : candidateRecord.align),
          content
        };
      })
      .filter((item): item is Record<string, unknown> => !!item);
    return cells.length > 0 ? [{ cells }] : [];
  }

  if (type === 'field') {
    const fieldKey = typeof record.key === 'string' ? record.key : '';
    if (!fieldKey) return [];
    const field = fields[fieldKey] as Record<string, unknown> | undefined;
    return [{
      cells: [{ width: 12, content: { type: field?.kind === 'journal' ? 'journal' : 'field', fieldKey } }]
    }];
  }

  if (type === 'button') {
    return [{
      cells: [{
        width: 12,
        content: {
          type: 'button',
          action: typeof record.action === 'string' ? record.action : '',
          label: typeof record.label === 'string' ? record.label : undefined,
          key: typeof record.key === 'string' ? record.key : undefined,
          kind: typeof record.kind === 'string' ? record.kind : undefined
        }
      }]
    }];
  }

  if (type === 'h1' || type === 'h2' || type === 'text' || type === 'hint' || type === 'divider') {
    return [{
      cells: [{
        width: 12,
        content: {
          type: 'markdown',
          style:
            type === 'h1' ? 'heading1' :
            type === 'h2' ? 'heading2' :
            type === 'hint' ? 'hint' :
            type === 'divider' ? 'divider' : 'text',
          text: typeof record.text === 'string' ? record.text : ''
        }
      }]
    }];
  }

  return [];
}

function buildFormFromLayout(templateJson: Record<string, unknown>) {
  const fields = templateJson.fields && typeof templateJson.fields === 'object' && !Array.isArray(templateJson.fields)
    ? (templateJson.fields as Record<string, unknown>)
    : {};
  const layout = templateJson.layout;

  if (Array.isArray(layout)) {
    const rows = layout.flatMap((node) => layoutNodeToFormRows(node, fields));
    if (rows.length > 0) return { rows };
  }

  if (layout && typeof layout === 'object' && Array.isArray((layout as any).sections)) {
    const rows = ((layout as any).sections as Array<Record<string, unknown>>).flatMap((section) => {
      const nextRows: Array<Record<string, unknown>> = [];
      if (typeof section.title === 'string' && section.title.trim().length > 0) {
        nextRows.push({ cells: [{ width: 12, content: { type: 'markdown', style: 'heading2', text: section.title } }] });
      }
      const fieldKeys = Array.isArray(section.fields) ? section.fields.filter((key): key is string => typeof key === 'string') : [];
      for (const fieldKey of fieldKeys) {
        const field = fields[fieldKey] as Record<string, unknown> | undefined;
        nextRows.push({
          cells: [{ width: 12, content: { type: field?.kind === 'journal' ? 'journal' : 'field', fieldKey } }]
        });
      }
      return nextRows;
    });
    if (rows.length > 0) return { rows };
  }

  const fallbackKeys = Object.keys(fields);
  return {
    rows: fallbackKeys.map((fieldKey) => {
      const field = fields[fieldKey] as Record<string, unknown> | undefined;
      return {
        cells: [{ width: 12, content: { type: field?.kind === 'journal' ? 'journal' : 'field', fieldKey } }]
      };
    })
  };
}

function buildLayoutFromForm(form: unknown) {
  const parsed = templateFormSchemaV1.safeParse(form);
  if (!parsed.success) return [];
  const normalizedForm = normalizeFormRows(parsed.data);
  return normalizedForm.rows.map((row) => ({
    type: 'row',
    children: row.cells.map((cell) => {
      const content = cell.content;
      let child: Record<string, unknown>;
      if (content.type === 'field' || content.type === 'journal') {
        child = { type: 'field', key: content.fieldKey };
      } else if (content.type === 'button') {
        child = {
          type: 'button',
          key: content.key ?? content.action,
          action: content.action,
          label: content.label ?? content.action,
          kind: content.kind ?? 'ui'
        };
      } else if (content.type === 'attachmentArea' || content.type === 'attachments') {
        child = {
          type: 'attachments',
          title: content.title ?? 'Attachments',
          text: content.helpText ?? 'Attachments and images are managed on the document workspace.'
        };
      } else if (content.type === 'spacer') {
        child = { type: 'spacer', size: content.size ?? 'md' };
      } else {
        child = {
          type:
            content.style === 'heading1' ? 'h1' :
            content.style === 'heading2' ? 'h2' :
            content.style === 'hint' ? 'hint' :
            content.style === 'divider' ? 'divider' : 'text',
          text: content.text
        };
      }
      return {
        type: 'col',
        width: cell.width,
        align: cell.align,
        children: [child]
      };
    })
  }));
}

function ensureBuilderReadyTemplateCore(rawTemplateJson: Record<string, unknown>) {
  const next = { ...rawTemplateJson } as Record<string, unknown>;
  const parsedForm = templateFormSchemaV1.safeParse(next.form);
  if (parsedForm.success) {
    next.form = normalizeFormRows(parsedForm.data);
    next.layout = buildLayoutFromForm(next.form);
    return next;
  }

  const derivedForm = buildFormFromLayout(next);
  next.form = derivedForm;
  next.layout = buildLayoutFromForm(derivedForm);
  return next;
}

const starterTemplate = {
  fields: {
    customer_id: {
      kind: 'lookup',
      label: 'Customer',
      apiRef: 'customers.listValid',
      valueKey: 'id',
      labelKey: 'name'
    },
    comment: {
      kind: 'editable',
      label: 'Comment',
      multiline: true
    }
  },
  form: {
    rows: [
      {
        id: 'row-1',
        height: 80,
        cells: [{ id: 'row-1-cell-1', width: 12, content: { type: 'markdown', style: 'heading1', text: 'Start' } }]
      },
      {
        id: 'row-2',
        height: 80,
        cells: [{ id: 'row-2-cell-1', width: 12, content: { type: 'field', fieldKey: 'customer_id' } }]
      },
      {
        id: 'row-3',
        height: 80,
        cells: [{ id: 'row-3-cell-1', width: 12, content: { type: 'field', fieldKey: 'comment' } }]
      }
    ]
  },
  actions: {},
  documentTable: {
    columns: [
      { key: 'customer_id', label: 'Customer' },
      { key: 'comment', label: 'Comment' }
    ]
  }
};
const builderReadyStarterTemplate = ensureBuilderReadyTemplateCore(starterTemplate);

const STANDARD_PROCESS_ACTIONS = ['assign', 'submit', 'approve', 'reject', 'archive'] as const;
type StandardProcessAction = (typeof STANDARD_PROCESS_ACTIONS)[number];

function isStandardProcessAction(value: string): value is StandardProcessAction {
  return (STANDARD_PROCESS_ACTIONS as readonly string[]).includes(value);
}

function sanitizeAttachmentFilename(filename: string) {
  const cleaned = String(filename ?? '')
    .replace(/[/\\]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 180) || 'attachment.bin';
}

function resolveAttachmentKind(contentType: string, requestedKind?: string) {
  const normalizedMime = String(contentType ?? '').toLowerCase();
  if (requestedKind === 'image') return 'image';
  if (normalizedMime.startsWith('image/')) return 'image';
  return 'file';
}

function decodeAttachmentPayload(base64Data: string) {
  const normalized = String(base64Data ?? '').replace(/^data:[^;]+;base64,/, '').trim();
  return Buffer.from(normalized, 'base64');
}

function formatBytes(value: number | null | undefined) {
  const size = Number(value ?? 0);
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size >= 10 * 1024 ? 0 : 1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function resolveProcessButtonLabel(controlKey: string, templateJson?: TemplateJson) {
  const normalized = String(controlKey ?? '').trim().toLowerCase();
  const legacyLabel =
    templateJson && typeof (templateJson as any).controls?.[controlKey]?.label === 'string'
      ? String((templateJson as any).controls[controlKey].label)
      : '';
  if (legacyLabel) return legacyLabel;
  if (normalized === 'assign') return 'Assign';
  if (normalized === 'submit') return 'Submit';
  if (normalized === 'approve') return 'Approve';
  if (normalized === 'reject') return 'Reject';
  if (normalized === 'archive') return 'Archive';
  return controlKey;
}

export function normalizeTemplateJsonForV1Storage(templateJson: TemplateJson) {
  const next = ensureBuilderReadyTemplateCore({ ...(templateJson as Record<string, unknown>) });
  delete next.workflow;
  delete next.controls;
  delete next.fieldAccess;
  delete next.layout;

  if (next.actions && typeof next.actions === 'object' && !Array.isArray(next.actions)) {
    const filteredActions = Object.fromEntries(
      Object.entries(next.actions as Record<string, unknown>).filter(([actionKey]) => !isStandardProcessAction(actionKey))
    );
    if (Object.keys(filteredActions).length > 0) {
      next.actions = filteredActions;
    } else {
      delete next.actions;
    }
  }

  return next as TemplateJson;
}

function buildTemplateBuilderPreviewHtmlFromText(raw: string | undefined) {
  try {
    const parsed = parseTemplateEditorJson(String(raw ?? ''));
    const normalized = normalizeTemplateJsonForV1Storage(parsed as TemplateJson);
    return renderLayout({ mode: 'preview', templateJson: normalized });
  } catch {
    return '<div class="card"><p class="muted">Preview unavailable until template_json is valid.</p></div>';
  }
}

function resolvePublishedAtForStateChange(nextState: 'draft' | 'published' | 'inactive', existing?: Date | null) {
  if (nextState !== 'published') return null;
  return existing ?? new Date();
}

function pickRelevantTemplatesByKey(
  templates: Array<{
    id: string;
    key: string;
    name: string;
    description: string | null;
    state: string;
    version: number;
  }>,
  stateFilter: 'published' | 'draft' | 'inactive' | 'all'
) {
  if (stateFilter !== 'all') {
    const byKey = new Map<string, (typeof templates)[number]>();
    for (const tpl of templates) {
      if (normalizeTemplateState(tpl.state) !== stateFilter) continue;
      if (!byKey.has(tpl.key)) byKey.set(tpl.key, tpl);
    }
    return Array.from(byKey.values());
  }

  const rank = (state: string) => {
    const normalized = normalizeTemplateState(state);
    if (normalized === 'published') return 3;
    if (normalized === 'draft') return 2;
    return 1;
  };

  const byKey = new Map<string, (typeof templates)[number]>();
  for (const tpl of templates) {
    const current = byKey.get(tpl.key);
    if (!current) {
      byKey.set(tpl.key, tpl);
      continue;
    }
    const currentRank = rank(current.state);
    const nextRank = rank(tpl.state);
    if (nextRank > currentRank || (nextRank === currentRank && tpl.version > current.version)) {
      byKey.set(tpl.key, tpl);
    }
  }
  return Array.from(byKey.values());
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
      workflowRef: fpTemplates.workflowRef,
      templateJson: fpTemplates.templateJson,
      publishedAt: fpTemplates.publishedAt,
      createdAt: fpTemplates.createdAt
    })
    .from(fpTemplates)
    .where(eq(fpTemplates.key, key))
    .orderBy(desc(fpTemplates.version));
}

async function loadWorkflowOptions(db: FpDb) {
  try {
    return await db
      .select({
        id: fpWorkflows.id,
        key: fpWorkflows.key,
        name: fpWorkflows.name,
        version: fpWorkflows.version,
        state: fpWorkflows.state
      })
      .from(fpWorkflows)
      .where(sql`lower(${fpWorkflows.state}) in ('active', 'draft')`)
      .orderBy(asc(fpWorkflows.key), desc(fpWorkflows.version));
  } catch {
    return [];
  }
}

const workflowJsonSchema = z.object({
  statuses: z.array(z.string()).optional(),
  initialStatus: z.string().optional(),
  order: z.array(z.string()).optional(),
  states: z.record(z.any()).optional(),
  semantics: z.record(z.any()).optional(),
  actorModel: z.record(z.any()).optional(),
  hooks: z.record(z.any()).optional()
});

function parseWorkflowJson(raw: unknown): WorkflowRuntimeModel {
  const parsed = workflowJsonSchema.safeParse(raw);
  if (!parsed.success) {
    return normalizeWorkflowRuntimeModel({});
  }
  return normalizeWorkflowRuntimeModel({
    order: parsed.data.order,
    initialStatus: parsed.data.initialStatus,
    states: parsed.data.states,
    semantics: parsed.data.semantics as Record<string, unknown> | undefined,
    actorModel: parsed.data.actorModel as Record<string, unknown> | undefined,
    hooks: parsed.data.hooks
  });
}

function parseTemplateJson(raw: unknown): TemplateJson {
  const parsed = ensureBuilderReadyTemplateCore(templateJsonSchema.parse(raw) as any);
  return {
    ...parsed,
    // Legacy bridge only: controls/workflow/fieldAccess may still exist in older templates.
    controls: parsed.controls ?? {},
    actions: parsed.actions ?? {}
  };
}

function buildActionRuntimeTemplateContext(templateJson: TemplateJson) {
  const fullSchema = {
    fields: templateJson.fields,
    form: (templateJson as any).form,
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

export function parseTemplateEditorJson(raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('template_json must be valid JSON');
  }

  const validatedCore = templateEditorJsonSchema.safeParse(parsed);
  if (validatedCore.success) {
    return ensureBuilderReadyTemplateCore({
      ...validatedCore.data,
      actions: validatedCore.data.actions ?? {}
    }) as any;
  }

  const validatedCompat = templateJsonSchema.safeParse(parsed);
  if (!validatedCompat.success) {
    throw new Error('template_json must contain fields, form.rows and optional actions/documentTable');
  }

  return ensureBuilderReadyTemplateCore({
    ...validatedCompat.data,
    controls: validatedCompat.data.controls ?? {},
    actions: validatedCompat.data.actions ?? {}
  }) as any;
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

export function collectTemplateWarnings(templateJson: unknown) {
  const warnings: string[] = [];
  const root = templateJson && typeof templateJson === 'object' && !Array.isArray(templateJson)
    ? (templateJson as Record<string, unknown>)
    : {};
  if (root.fieldAccess && typeof root.fieldAccess === 'object') {
    warnings.push('template_json.fieldAccess is legacy. Field editability should come from the referenced workflow.');
  }
  if (root.workflow && typeof root.workflow === 'object') {
    warnings.push('template_json.workflow is legacy. Use template.workflowRef + workflow definitions instead.');
  }
  if (root.controls && typeof root.controls === 'object') {
    warnings.push('template_json.controls is legacy. Standard process buttons come from the workflow.');
  }
  if (!root.form && root.layout) {
    warnings.push('template_json.layout is now a transition bridge. New builder-ready templates should use template_json.form.rows[].cells[].');
  }
  const actions = root.actions && typeof root.actions === 'object' && !Array.isArray(root.actions)
    ? (root.actions as Record<string, unknown>)
    : {};
  const legacyProcessActions = Object.keys(actions).filter((actionKey) => isStandardProcessAction(actionKey));
  if (legacyProcessActions.length > 0) {
    warnings.push(`template_json.actions contains legacy standard process actions: ${legacyProcessActions.join(', ')}`);
  }
  const fields = root.fields && typeof root.fields === 'object' ? (root.fields as Record<string, unknown>) : {};
  for (const [fieldKey, fieldValue] of Object.entries(fields)) {
    if (!fieldValue || typeof fieldValue !== 'object' || Array.isArray(fieldValue)) continue;
    const field = fieldValue as Record<string, unknown>;
    if (field.kind === 'lookup' && !field.apiRef && (field.source || field.lookup)) {
      warnings.push(`lookup field "${fieldKey}" uses legacy source config. Prefer apiRef.`);
    }
  }
  const usage = extractTemplateUsage(root);
  if (usage.macroRefs.length > 0) {
    warnings.push(`legacy macro refs detected: ${usage.macroRefs.join(', ')}`);
  }
  return warnings;
}

function buildApiTestExample(requestSchemaJson: unknown) {
  if (!requestSchemaJson || typeof requestSchemaJson !== 'object' || Array.isArray(requestSchemaJson)) return '{}';
  const schema = requestSchemaJson as Record<string, unknown>;
  const source = (schema.body ?? schema.query) as Record<string, unknown> | undefined;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return '{}';
  const example = Object.fromEntries(
    Object.keys(source).map((key) => [key, key.endsWith('_id') ? '00000000-0000-0000-0000-000000000000' : ''])
  );
  return JSON.stringify(example, null, 2);
}

function normalizeMacroKind(raw: unknown): 'json' | 'builtin' {
  return String(raw ?? '')
    .trim()
    .toLowerCase() === 'builtin'
    ? 'builtin'
    : 'json';
}

function normalizeApiState(raw: unknown): 'active' | 'inactive' {
  return String(raw ?? '')
    .trim()
    .toLowerCase() === 'inactive'
    ? 'inactive'
    : 'active';
}

function normalizeApiMethod(raw: unknown): 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' {
  const method = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (method === 'GET' || method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    return method;
  }
  return 'GET';
}

function isMissingRelationError(error: unknown, relationName: string) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const code = typeof error === 'object' && error !== null ? String((error as { code?: unknown }).code ?? '') : '';
  return code === '42P01' || message.toLowerCase().includes(`relation "${relationName}" does not exist`);
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
    actions[actionKey]?.requires,
    // Legacy bridge only: historical templates stored permission hints on controls.
    controls[controlKey]?.requires
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

function collectTemplateUiActionButtons(templateJson: TemplateJson) {
  const buttons: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.type === 'button' && n.kind !== 'process') {
      const action = typeof n.action === 'string' ? n.action : '';
      const key = typeof n.key === 'string' ? n.key : action;
      if (key && !seen.has(key)) {
        seen.add(key);
        buttons.push({
          key,
          label: typeof n.label === 'string' && n.label.trim().length > 0 ? n.label.trim() : key
        });
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
  return buttons;
}

function resolveActionInvocation(params: {
  source: string;
  layoutButtonKind?: LayoutButtonKind;
  isLayoutButtonAction: boolean;
}) {
  const isUiButtonRequest = params.source === 'ui';
  if (!isUiButtonRequest) {
    return { executionSource: 'process' as const };
  }

  if (!params.layoutButtonKind) {
    return { error: 'UI button is not configured in layout.' };
  }

  if (params.layoutButtonKind !== 'ui') {
    return { error: 'UI button cannot execute process action' };
  }

  return { executionSource: 'ui' as const };
}

function collectTemplateMacroRefs(templateJson: TemplateJson): string[] {
  return extractTemplateUsage(templateJson).macroRefs;
}

function collectTemplateActionUsage(templateJson: TemplateJson) {
  return extractTemplateUsage(templateJson).actions.map((item) => ({
    actionKey: item.actionKey,
    actionType: item.actionType,
    stepTypes: item.stepTypes,
    operationRefs: item.operationRefs,
    apiRefs: item.apiRefs,
    legacyMacro: item.hasLegacyMacro
  }));
}

function safeCollectTemplateActionUsage(rawTemplateJson: unknown) {
  try {
    return collectTemplateActionUsage(parseTemplateJson(rawTemplateJson));
  } catch {
    return [] as ReturnType<typeof collectTemplateActionUsage>;
  }
}

async function syncTemplateMacroRefs(
  db: FpDb,
  templateId: string,
  templateJson: TemplateJson,
  logger?: FastifyRequest['log']
) {
  const macroRefs = collectTemplateMacroRefs(templateJson);
  const canWriteLinks = typeof (db as any).delete === 'function' && typeof (db as any).insert === 'function';
  let syncedCount = 0;

  if (canWriteLinks) {
    try {
      await db.delete(fpTemplateMacros).where(eq(fpTemplateMacros.templateId, templateId));
      if (macroRefs.length > 0) {
        await db
          .insert(fpTemplateMacros)
          .values(macroRefs.map((macroRef) => ({ templateId, macroRef })))
          .onConflictDoNothing({ target: [fpTemplateMacros.templateId, fpTemplateMacros.macroRef] });
        syncedCount = macroRefs.length;
      }
    } catch (error) {
      logger?.warn({ templateId, error }, 'Template macro refs sync skipped (table unavailable?)');
    }
  }

  logger?.info(
    { templateId, macroRefs, syncedCount },
    'Template macro refs synchronized'
  );

  return { macroRefs, syncedCount };
}

async function loadTemplateMacroUsageView(db: FpDb, templateId: string) {
  let links: Array<{ macroRef: string; linkedAt: Date }> = [];
  try {
    links = await db
      .select({
        macroRef: fpTemplateMacros.macroRef,
        linkedAt: fpTemplateMacros.createdAt
      })
      .from(fpTemplateMacros)
      .where(eq(fpTemplateMacros.templateId, templateId))
      .orderBy(asc(fpTemplateMacros.macroRef));
  } catch {
    return { usedMacros: [] as Array<Record<string, unknown>>, missingMacroRefs: [] as string[] };
  }

  const refs = links.map((item) => item.macroRef);
  if (refs.length === 0) {
    return { usedMacros: [] as Array<Record<string, unknown>>, missingMacroRefs: [] as string[] };
  }

  const macroRows = await db
    .select({
      ref: fpMacros.ref,
      namespace: fpMacros.namespace,
      name: fpMacros.name,
      version: fpMacros.version,
      kind: fpMacros.kind,
      isEnabled: fpMacros.isEnabled
    })
    .from(fpMacros)
    .where(inArray(fpMacros.ref, refs));
  const macroByRef = new Map(macroRows.map((item) => [item.ref, item]));

  const usedMacros = links.map((link) => {
    const macro = macroByRef.get(link.macroRef);
    return {
      ref: link.macroRef,
      name: macro?.name ?? null,
      kind: macro?.kind ?? null,
      isEnabled: macro?.isEnabled ?? null,
      exists: !!macro
    };
  });
  const missingMacroRefs = usedMacros.filter((item) => !item.exists).map((item) => String(item.ref));

  return { usedMacros, missingMacroRefs };
}

function collectApiRefsFromTemplateJson(templateJson: unknown) {
  return extractTemplateUsage(templateJson).apiRefs;
}

function collectOperationRefsFromTemplateJson(templateJson: unknown) {
  return extractTemplateUsage(templateJson).operationRefs;
}

function normalizeApiRefCandidates(input: string) {
  const raw = String(input ?? '').trim();
  if (!raw) return [];
  const values = new Set<string>();
  values.add(raw);
  if (raw.startsWith('api:')) values.add(raw.slice('api:'.length));
  values.add(raw.replace(/@\d+$/, ''));
  if (raw.startsWith('api:')) values.add(raw.slice('api:'.length).replace(/@\d+$/, ''));
  return Array.from(values).filter((item) => item.length > 0);
}

async function loadTemplatesUsingApi(db: FpDb, apiKey: string) {
  const candidates = new Set<string>([apiKey, `api:${apiKey}`]);
  const templates = await db
    .select({
      id: fpTemplates.id,
      key: fpTemplates.key,
      name: fpTemplates.name,
      version: fpTemplates.version,
      state: fpTemplates.state,
      templateJson: fpTemplates.templateJson
    })
    .from(fpTemplates)
    .orderBy(asc(fpTemplates.name), desc(fpTemplates.version));

  const usedIn: Array<{ id: string; key: string; name: string; version: number; state: string }> = [];
  for (const tpl of templates) {
    const refs = collectApiRefsFromTemplateJson(tpl.templateJson);
    const refCandidates = refs.flatMap((ref) => normalizeApiRefCandidates(ref));
    const match = refCandidates.some((ref) => candidates.has(ref));
    if (!match) continue;
    usedIn.push({
      id: tpl.id,
      key: tpl.key,
      name: tpl.name,
      version: tpl.version,
      state: tpl.state
    });
  }
  return usedIn;
}

function resolveOperationModulePath(ref: string) {
  switch (ref) {
    case 'customers.listValid':
      return 'src/connectors/erp-sim/customers.ts';
    case 'products.listValid':
      return 'src/connectors/erp-sim/products.ts';
    case 'batches.create':
      return 'src/connectors/erp-sim/batches.ts';
    case 'customerOrders.create':
    case 'customerOrders.setStatus':
    case 'customerOrders.setStatusFromContext':
      return 'src/connectors/erp-sim/customer-orders.ts';
    case 'salesforce.accounts.listRecent':
      return 'src/connectors/salesforce-sandbox/accounts.ts';
    default:
      return 'src/connectors/...';
  }
}

function describeOperationUsage(operation: AnyConnectorOperationDefinition) {
  if (operation.metadata.kind === 'lookup') return ['Lookup'];
  return ['Action', 'Hook'];
}

function buildConnectorOperationView(operation: AnyConnectorOperationDefinition, bridgeApi?: { state?: string | null } | null) {
  return {
    ref: operation.ref,
    name: operation.name,
    description: operation.description ?? '',
    connectorKey: operation.connector.key,
    connectorName: operation.connector.name,
    connectorTargetSystem: operation.connector.metadata?.targetSystem ?? 'External system',
    authType: operation.connector.auth.type,
    method: operation.metadata.method,
    path: operation.metadata.path,
    kind: operation.metadata.kind,
    modulePath: resolveOperationModulePath(operation.ref),
    usableIn: describeOperationUsage(operation),
    hasBridgeApi: !!bridgeApi,
    bridgeState: bridgeApi?.state ? normalizeApiState(bridgeApi.state) : null
  };
}

async function loadOperationCatalogView(db: FpDb) {
  const bridgeRows = await db
    .select({
      id: fpApis.id,
      key: fpApis.key,
      name: fpApis.name,
      description: fpApis.description,
      state: fpApis.state,
      method: fpApis.method,
      baseUrl: fpApis.baseUrl,
      path: fpApis.path,
      updatedAt: fpApis.updatedAt
    })
    .from(fpApis)
    .orderBy(asc(fpApis.key));
  const bridgeByKey = new Map(bridgeRows.map((row) => [row.key, row]));
  const operations = listConnectorOperations().map((operation) =>
    buildConnectorOperationView(operation, bridgeByKey.get(operation.ref) ?? null)
  );
  return {
    bridgeApis: bridgeRows.map((row) => ({
      ...row,
      state: normalizeApiState(row.state),
      method: normalizeApiMethod(row.method),
      hasTsOperation: !!resolveConnectorOperation(row.key),
      tsOperationRef: resolveConnectorOperation(row.key)?.ref ?? null
    })),
    operations
  };
}

async function loadTemplateApiUsageView(db: FpDb, template: { templateJson: unknown }) {
  const refs = collectApiRefsFromTemplateJson(template.templateJson).sort((a, b) => a.localeCompare(b));
  if (refs.length === 0) {
    return { usedApis: [] as Array<{ ref: string; id: string | null; key: string | null; name: string | null; state: string | null; exists: boolean }>, missingApiRefs: [] as string[] };
  }

  const directKeys = refs.flatMap((item) => normalizeApiRefCandidates(item));
  const uniqueKeys = Array.from(new Set(directKeys));
  const rows = uniqueKeys.length
    ? await db
        .select({
          id: fpApis.id,
          key: fpApis.key,
          name: fpApis.name,
          state: fpApis.state
        })
        .from(fpApis)
        .where(inArray(fpApis.key, uniqueKeys))
    : [];
  const byKey = new Map(rows.map((row) => [row.key, row]));

  const usedApis = refs.map((ref) => {
    const match = normalizeApiRefCandidates(ref)
      .map((candidate) => byKey.get(candidate))
      .find(Boolean);
    return {
      ref,
      id: match?.id ?? null,
      key: match?.key ?? null,
      name: match?.name ?? null,
      state: match?.state ?? null,
      exists: !!match
    };
  });
  const missingApiRefs = usedApis.filter((item) => !item.exists).map((item) => item.ref);
  return { usedApis, missingApiRefs };
}

async function loadTemplateOperationUsageView(template: { templateJson: unknown }) {
  const refs = collectOperationRefsFromTemplateJson(template.templateJson).sort((a, b) => a.localeCompare(b));
  const usedOperations = refs.map((ref) => {
    const operation = resolveConnectorOperation(ref);
    return operation
      ? {
          ref,
          exists: true,
          ...buildConnectorOperationView(operation)
        }
      : {
          ref,
          exists: false,
          name: null,
          description: '',
          connectorKey: null,
          connectorName: null,
          connectorTargetSystem: null,
          authType: null,
          method: null,
          path: null,
          kind: null,
          modulePath: null,
          usableIn: []
        };
  });
  const missingOperationRefs = usedOperations.filter((item) => !item.exists).map((item) => item.ref);
  return { usedOperations, missingOperationRefs };
}

function loadWorkflowHookUsageView(workflowRuntime: WorkflowRuntimeModel) {
  const rows = [
    ...workflowRuntime.hooks.onTransition.flatMap((hook) =>
      hook.effects.map((effect) => ({
        triggerType: 'transition',
        triggerLabel: `${(hook.from ?? ['*']).join(', ')} -> ${hook.to.join(', ')}`,
        operationRef: effect.operationRef,
        apiRef: effect.apiRef ?? null,
        responseTargets: [
          ...(effect.responseMapping?.data ? ['data'] : []),
          ...(effect.responseMapping?.external ? ['external'] : []),
          ...(effect.responseMapping?.snapshot ? ['snapshot'] : []),
          ...(effect.responseMapping?.integration ? ['integration'] : []),
          ...(effect.responseMapping?.status ? ['status'] : [])
        ],
        description: effect.description ?? ''
      }))
    ),
    ...workflowRuntime.hooks.onEnterState.flatMap((hook) =>
      hook.effects.map((effect) => ({
        triggerType: 'enterState',
        triggerLabel: hook.state.join(', '),
        operationRef: effect.operationRef,
        apiRef: effect.apiRef ?? null,
        responseTargets: [
          ...(effect.responseMapping?.data ? ['data'] : []),
          ...(effect.responseMapping?.external ? ['external'] : []),
          ...(effect.responseMapping?.snapshot ? ['snapshot'] : []),
          ...(effect.responseMapping?.integration ? ['integration'] : []),
          ...(effect.responseMapping?.status ? ['status'] : [])
        ],
        description: effect.description ?? ''
      }))
    ),
    ...workflowRuntime.hooks.onWorkflowAction.flatMap((hook) =>
      hook.effects.map((effect) => ({
        triggerType: 'workflowAction',
        triggerLabel: hook.action.join(', '),
        operationRef: effect.operationRef,
        apiRef: effect.apiRef ?? null,
        responseTargets: [
          ...(effect.responseMapping?.data ? ['data'] : []),
          ...(effect.responseMapping?.external ? ['external'] : []),
          ...(effect.responseMapping?.snapshot ? ['snapshot'] : []),
          ...(effect.responseMapping?.integration ? ['integration'] : []),
          ...(effect.responseMapping?.status ? ['status'] : [])
        ],
        description: effect.description ?? ''
      }))
    )
  ].map((row) => {
    const operation = resolveConnectorOperation(row.operationRef);
    return {
      ...row,
      operation: operation ? buildConnectorOperationView(operation) : null
    };
  });
  return rows;
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

async function loadTemplateDocumentTableView(
  db: FpDb,
  template: { id: string; templateJson: unknown },
  options: { hasDocumentActorColumns: boolean; hasDocumentMultiAssignments: boolean }
) {
  const templateJson = parseTemplateJson(template.templateJson);
  const columns = resolveTemplateDocumentTableColumns(templateJson);
  const documents =
    typeof (db as any).query?.fpDocuments?.findMany === 'function'
      ? await (db as any).query.fpDocuments.findMany({
          where: eq(fpDocuments.templateId, template.id)
        })
      : await db
          .select({
            id: fpDocuments.id,
            status: fpDocuments.status,
            templateVersion: fpDocuments.templateVersion,
            createdAt: fpDocuments.createdAt,
            updatedAt: fpDocuments.updatedAt,
            ...(options.hasDocumentActorColumns
              ? {
                  editorUserId: fpDocuments.editorUserId,
                  approverUserId: fpDocuments.approverUserId,
                  assigneeUserId: fpDocuments.assigneeUserId,
                  reviewerUserId: fpDocuments.reviewerUserId
                }
              : {}),
            dataJson: fpDocuments.dataJson,
            externalRefsJson: fpDocuments.externalRefsJson,
            snapshotsJson: fpDocuments.snapshotsJson
          })
          .from(fpDocuments)
          .where(eq(fpDocuments.templateId, template.id))
          .orderBy(desc(fpDocuments.updatedAt));

  const orderedDocuments = [...documents].sort(
    (a: any, b: any) => new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() - new Date(a.updatedAt ?? a.createdAt ?? 0).getTime()
  );
  const documentIds = orderedDocuments.map((item: any) => item.id);
  const useMultiAssignments =
    options.hasDocumentMultiAssignments &&
    typeof (db as any).query?.fpDocumentEditors?.findMany === 'function' &&
    typeof (db as any).query?.fpDocumentApprovals?.findMany === 'function';

  let editorRows: Array<{ documentId: string; userId: string }> = [];
  let approverRows: Array<{ documentId: string; userId: string }> = [];
  if (useMultiAssignments && documentIds.length > 0) {
    editorRows = await (db as any).query.fpDocumentEditors.findMany();
    approverRows = await (db as any).query.fpDocumentApprovals.findMany();
    editorRows = editorRows.filter((item) => documentIds.includes(item.documentId));
    approverRows = approverRows.filter((item) => documentIds.includes(item.documentId));
  }

  const userIds = new Set<string>();
  for (const row of editorRows) userIds.add(row.userId);
  for (const row of approverRows) userIds.add(row.userId);
  if (!useMultiAssignments && options.hasDocumentActorColumns) {
    for (const document of orderedDocuments as any[]) {
      const { editorUserId, approverUserId } = resolveLegacyActorUserIds(document);
      if (editorUserId) userIds.add(editorUserId);
      if (approverUserId) userIds.add(approverUserId);
    }
  }

  let usersById = new Map<string, { displayName: string; username: string }>();
  if (userIds.size > 0) {
    const rows =
      typeof (db as any).query?.fpUsers?.findMany === 'function'
        ? await (db as any).query.fpUsers.findMany()
        : await db
            .select({
              id: fpUsers.id,
              username: fpUsers.username,
              displayName: fpUsers.displayName
            })
            .from(fpUsers)
            .where(inArray(fpUsers.id, Array.from(userIds)));
    usersById = new Map(
      rows
        .filter((row: any) => userIds.has(row.id))
        .map((row: any) => [row.id, { displayName: row.displayName, username: row.username }])
    );
  }

  const rows = orderedDocuments.map((document: any) => {
    const editorNames = useMultiAssignments
      ? editorRows
          .filter((row) => row.documentId === document.id)
          .map((row) => usersById.get(row.userId)?.displayName ?? usersById.get(row.userId)?.username ?? row.userId)
      : (() => {
          const { editorUserId } = resolveLegacyActorUserIds(document);
          if (!editorUserId) return [];
          const user = usersById.get(editorUserId);
          return [user?.displayName ?? user?.username ?? editorUserId];
        })();
    const approverNames = useMultiAssignments
      ? approverRows
          .filter((row) => row.documentId === document.id)
          .map((row) => usersById.get(row.userId)?.displayName ?? usersById.get(row.userId)?.username ?? row.userId)
      : (() => {
          const { approverUserId } = resolveLegacyActorUserIds(document);
          if (!approverUserId) return [];
          const user = usersById.get(approverUserId);
          return [user?.displayName ?? user?.username ?? approverUserId];
        })();

    return {
      id: document.id,
      shortId: String(document.id).slice(0, 8),
      status: normalizeDocumentStatus(document.status),
      createdAt: document.createdAt ?? null,
      updatedAt: document.updatedAt ?? null,
      editors: editorNames,
      approvers: approverNames,
      values: columns.map((column) => ({
        key: column.key,
        label: column.label,
        value: resolveDocumentTableFieldValue(document, column.key)
      }))
    };
  });

  return { columns, rows };
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
  const response = await executeIntegrationRequest(
    {
      baseUrl: params.erpBaseUrl,
      path: '/api/customer-orders',
      method: 'POST',
      jsonBody: body ?? {}
    },
    fetchImpl
  );

  if (!response.ok) {
    throw new Error(`Failed to create ERP customer order (${response.status})`);
  }

  const payload = (response.bodyJson ?? {}) as { id?: string; order_number?: string };
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

type TemplateDocumentTableColumn = {
  key: string;
  label: string;
};

function resolveTemplateDocumentTableColumns(templateJson: TemplateJson): TemplateDocumentTableColumn[] {
  const configured = (templateJson as any).documentTable?.columns;
  if (Array.isArray(configured) && configured.length > 0) {
    return configured
      .map((item) => {
        if (typeof item === 'string' && item.trim().length > 0) {
          const field = templateJson.fields[item] as TemplateField | undefined;
          return { key: item, label: field?.label ?? item };
        }
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const record = item as Record<string, unknown>;
        const key = typeof record.key === 'string' ? record.key.trim() : '';
        if (!key) return null;
        const field = templateJson.fields[key] as TemplateField | undefined;
        return {
          key,
          label:
            typeof record.label === 'string' && record.label.trim().length > 0 ? record.label.trim() : field?.label ?? key
        };
      })
      .filter((item): item is TemplateDocumentTableColumn => !!item);
  }

  return orderedFieldKeys(templateJson)
    .slice(0, 2)
    .map((key) => {
      const field = templateJson.fields[key] as TemplateField | undefined;
      return {
        key,
        label: field?.label ?? key
      };
    });
}

function formatDocumentTableCellValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === 'object' && !Array.isArray(item))) {
      return `${value.length} rows`;
    }
    const normalized = value.map((item) => String(item ?? '').trim()).filter((item) => item.length > 0);
    return normalized.length > 0 ? normalized.join(', ') : '—';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resolveDocumentTableFieldValue(document: {
  dataJson?: unknown;
  externalRefsJson?: unknown;
  snapshotsJson?: unknown;
}, fieldKey: string) {
  const snapshots = (document.snapshotsJson ?? {}) as Record<string, unknown>;
  const data = (document.dataJson ?? {}) as Record<string, unknown>;
  const external = (document.externalRefsJson ?? {}) as Record<string, unknown>;
  return formatDocumentTableCellValue(snapshots[fieldKey] ?? data[fieldKey] ?? external[fieldKey] ?? null);
}

function resolveLegacyActorUserIds(document: {
  editorUserId?: string | null;
  approverUserId?: string | null;
  assigneeUserId?: string | null;
  reviewerUserId?: string | null;
}) {
  return {
    editorUserId: document.editorUserId ?? document.assigneeUserId ?? null,
    approverUserId: document.approverUserId ?? document.reviewerUserId ?? null
  };
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

function resolveEditableInputType(field: TemplateField): 'text' | 'date' | 'checkbox' | 'radioGroup' | 'checkboxGroup' | 'textarea' | 'journal' {
  const input = field.inputType ?? field.control ?? field.ui?.input ?? field.kind;
  if (field.multiline || input === 'textarea') return 'textarea';
  return input === 'date' || input === 'checkbox' || input === 'radioGroup' || input === 'checkboxGroup' || input === 'journal'
    ? input
    : 'text';
}

function isEditableFieldKind(kind: unknown) {
  return kind === 'editable' || kind === 'date' || kind === 'checkbox' || kind === 'journal';
}

function normalizeJournalRowsFromFormValue(value: unknown) {
  const raw = typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : '';
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row))
      .map((row) => Object.fromEntries(Object.entries(row).map(([key, cell]) => [key, cell ?? ''])));
  } catch {
    return [];
  }
}

function resolveEditableFormValue(form: Record<string, unknown>, field: TemplateField, fieldKey: string) {
  const formKey = `data:${fieldKey}`;
  const inputType = resolveEditableInputType(field);
  if (inputType === 'checkbox') {
    return Object.prototype.hasOwnProperty.call(form, formKey);
  }
  if (inputType === 'checkboxGroup') {
    const value = form[formKey];
    if (Array.isArray(value)) {
      return value.map((item) => String(item ?? '')).filter((item) => item.length > 0);
    }
    if (typeof value === 'string' && value.length > 0) {
      return [value];
    }
    return [];
  }
  if (inputType === 'journal') {
    return normalizeJournalRowsFromFormValue(form[formKey]);
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
    (field as any).valueField ??
    (field as any).valueKey ??
    field.source?.valueField ??
    field.source?.valueKey ??
    field.lookup?.valueField ??
    field.lookup?.valueKey ??
    'id';

  const labelField =
    (field as any).labelField ??
    (field as any).labelKey ??
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

function resolveTemplateFieldAccessState(templateJson: TemplateJson, status: string) {
  const normalized = normalizeDocumentStatus(status);
  const fromFieldAccess =
    (templateJson as any).fieldAccess && typeof (templateJson as any).fieldAccess === 'object'
      ? (templateJson as any).fieldAccess[normalized]
      : undefined;
  if (fromFieldAccess && typeof fromFieldAccess === 'object') return fromFieldAccess as Record<string, unknown>;
  const legacyWorkflowState = (templateJson as any).workflow?.states?.[normalized];
  if (legacyWorkflowState && typeof legacyWorkflowState === 'object') return legacyWorkflowState as Record<string, unknown>;
  return {};
}

function resolveWorkflowFieldAccessState(workflowRuntime: WorkflowRuntimeModel | undefined, status: string) {
  if (!workflowRuntime) return {} as Record<string, unknown>;
  const normalized = normalizeDocumentStatus(status);
  const state = workflowRuntime.states?.[normalized] as Record<string, unknown> | undefined;
  if (!state || typeof state !== 'object') return {} as Record<string, unknown>;
  return state;
}

export function resolveEditableFieldKeys(
  templateJson: TemplateJson,
  status: string,
  workflowRuntime?: WorkflowRuntimeModel
): string[] {
  const fallback = allEditableFieldKeys(templateJson);
  const workflowState = resolveWorkflowFieldAccessState(workflowRuntime, status);
  const state = Object.keys(workflowState).length > 0 ? workflowState : resolveTemplateFieldAccessState(templateJson, status);
  const readonly = new Set(
    Array.isArray(state?.readonly)
      ? state.readonly.filter((key: unknown): key is string => typeof key === 'string')
      : []
  );
  const configured = Array.isArray(state?.editable) ? state.editable : undefined;
  const fallbackEditable = fallback.filter((key) => !readonly.has(key));
  if (!configured) return fallbackEditable;

  const fieldKeys = new Set(Object.keys(templateJson.fields ?? {}));
  const explicitEditable = configured.filter(
    (key: unknown): key is string => typeof key === 'string' && fieldKeys.has(key) && !readonly.has(key)
  );
  return Array.from(new Set([...explicitEditable, ...fallbackEditable]));
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
    if (inputType === 'checkboxGroup') {
      next[key] = resolveEditableFormValue(form, field, key);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(form, formKey)) {
      next[key] = resolveEditableFormValue(form, field, key);
    }
  }
  return next;
}

function resolveReadonlyFieldKeys(templateJson: TemplateJson, status: string, workflowRuntime?: WorkflowRuntimeModel): string[] {
  const workflowState = resolveWorkflowFieldAccessState(workflowRuntime, status);
  const state = Object.keys(workflowState).length > 0 ? workflowState : resolveTemplateFieldAccessState(templateJson, status);
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
  const states = (templateJson.workflow?.states ?? {}) as Record<string, unknown>;
  const configured = DOCUMENT_WORKFLOW_ORDER.filter((status) => {
    const stateDef = states[status];
    if (!stateDef || typeof stateDef !== 'object' || Array.isArray(stateDef)) return false;
    const record = stateDef as Record<string, unknown>;
    return (
      (Array.isArray(record.buttons) && record.buttons.length > 0) ||
      (Array.isArray(record.editable) && record.editable.length > 0) ||
      (Array.isArray(record.readonly) && record.readonly.length > 0)
    );
  });
  const ordered = configured.length > 0 ? configured : [...DOCUMENT_WORKFLOW_ORDER];
  const current = normalizeDocumentStatus(currentStatus);
  if (current === 'archived' && !ordered.includes('archived')) {
    return [...ordered, 'archived'];
  }
  return ordered;
}

async function renderDocumentDetailPage(params: {
  db: FpDb;
  hasDocumentActorColumns: boolean;
  hasDocumentMultiAssignments: boolean;
  hasDocumentAttachments: boolean;
  hasDocumentAuditTrail?: boolean;
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
  workflowRuntime: WorkflowRuntimeModel;
  errorMessage?: string;
  successMessage?: string;
  assignmentsOpen?: boolean;
}) {
  const templateJson = parseTemplateJson(params.template.templateJson);
  const normalizedDocumentStatus = normalizeDocumentStatus(params.document.status);
  const stateDef = params.workflowRuntime.states?.[normalizedDocumentStatus] ?? {};
  const archived = isArchivedDocumentStatus(normalizedDocumentStatus);
  const editableKeys = archived ? [] : resolveEditableFieldKeys(templateJson, normalizedDocumentStatus, params.workflowRuntime);
  const readonlyKeys = archived
    ? Object.keys(templateJson.fields ?? {})
    : resolveReadonlyFieldKeys(templateJson, normalizedDocumentStatus, params.workflowRuntime);
  const buttonKeys = isArchivedDocumentStatus(normalizedDocumentStatus)
    ? []
    : Array.isArray(stateDef?.buttons)
    ? stateDef.buttons.filter((key: unknown): key is string => typeof key === 'string')
    : [];
  const processButtons = buttonKeys.map((key) => ({
    key,
    label: resolveProcessButtonLabel(key, templateJson)
  }));
  const templateActionButtons = collectTemplateUiActionButtons(templateJson);
  const workflowTimeline = (() => {
    const order = Array.isArray(params.workflowRuntime.order) && params.workflowRuntime.order.length > 0
      ? params.workflowRuntime.order
      : [...DOCUMENT_WORKFLOW_ORDER];
    if (normalizedDocumentStatus === 'archived' && !order.includes('archived')) return [...order, 'archived'];
    return order;
  })();
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
    documentStatus: normalizedDocumentStatus,
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
  let assignedEditors: Array<{ id: string; name: string; username: string }> = [];
  let assignedEditorsDetailed: Array<{ id: string; name: string; username: string; submissionStatus: string; submittedAt?: Date | null }> = [];
  let assignedApprovers: Array<{ id: string; name: string; username: string; approvalStatus: string; decidedAt?: Date | null }> = [];
  let assignmentEditorHint = '';
  let assignmentApproverHint = '';
  const useMultiAssignments =
    params.hasDocumentMultiAssignments &&
    typeof (params.db as any).query?.fpDocumentEditors?.findMany === 'function' &&
    typeof (params.db as any).query?.fpDocumentApprovals?.findMany === 'function' &&
    typeof (params.db as any).query?.fpDocumentSubmissions?.findMany === 'function';
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
    if (useMultiAssignments) {
      const editorRows = await (params.db as any).query.fpDocumentEditors.findMany({
        where: eq(fpDocumentEditors.documentId, params.document.id)
      });
      const submissionRows = await loadEditorSubmissionStates(params.db, params.document.id);
      const approvalRows = await loadApproverDecisionStates(params.db, params.document.id);
      assignedEditors = editorRows.map((row: { userId: string }) => {
        const member = membersById.get(row.userId);
        return member ?? { id: row.userId, name: row.userId, username: row.userId };
      });
      assignedEditorsDetailed = assignedEditors.map((member) => {
        const submission = submissionRows.find((row) => row.userId === member.id);
        return {
          ...member,
          submissionStatus: submission?.status ?? 'pending',
          submittedAt: submission?.submittedAt ?? null
        };
      });
      assignedApprovers = approvalRows.map((row: { userId: string; status: string; decidedAt?: Date | null }) => {
        const member = membersById.get(row.userId);
        const base = member ?? { id: row.userId, name: row.userId, username: row.userId };
        return { ...base, approvalStatus: row.status, decidedAt: row.decidedAt ?? null };
      });
      assignmentEditorName = assignedEditors.length > 0 ? assignedEditors.map((item) => item.name).join(', ') : '—';
      assignmentApproverName = assignedApprovers.length > 0 ? assignedApprovers.map((item) => item.name).join(', ') : '—';
    } else {
      if (params.document.editorUserId) {
        const editor = membersById.get(params.document.editorUserId);
        assignmentEditorName = editor ? editor.name : params.document.editorUserId;
      }
      if (params.document.approverUserId) {
        const approver = membersById.get(params.document.approverUserId);
        assignmentApproverName = approver ? approver.name : params.document.approverUserId;
      }
    }
  } else {
    if (params.document.editorUserId) assignmentEditorName = params.document.editorUserId;
    if (params.document.approverUserId) assignmentApproverName = params.document.approverUserId;
  }
  const editorSubmissionStates = useMultiAssignments ? await loadEditorSubmissionStates(params.db, params.document.id) : [];
  const approverDecisionStates = useMultiAssignments ? await loadApproverDecisionStates(params.db, params.document.id) : [];
  const workflowEvaluation = evaluateWorkflow({
    workflow: params.workflowRuntime,
    status: normalizedDocumentStatus,
    editorSubmissions: editorSubmissionStates,
    approverDecisions: approverDecisionStates
  });
  const hasAnyAssignments = useMultiAssignments
    ? assignedEditors.length > 0 || assignedApprovers.length > 0
    : Boolean(params.document.editorUserId || params.document.approverUserId);
  const submittedEditorCount = assignedEditorsDetailed.filter((item) => item.submissionStatus === 'submitted').length;
  const approvedApproverCount = assignedApprovers.filter((item) => item.approvalStatus === 'approved').length;
  const rejectedApproverCount = assignedApprovers.filter((item) => item.approvalStatus === 'rejected').length;
  const workflowHint = buildDocumentWorkflowHint({
    status: normalizedDocumentStatus,
    workflowEvaluation,
    hasAssignments: hasAnyAssignments,
    assignedEditorsCount: useMultiAssignments ? assignedEditorsDetailed.length : params.document.editorUserId ? 1 : 0,
    assignedApproversCount: useMultiAssignments ? assignedApprovers.length : params.document.approverUserId ? 1 : 0,
    submittedEditorCount,
    approvedApproverCount,
    rejectedApproverCount
  });
  const attachmentRows = params.hasDocumentAttachments ? await loadDocumentAttachments(params.db, params.document.id) : [];
  const uploadedByIds = Array.from(
    new Set(attachmentRows.map((item) => item.uploadedBy).filter((item): item is string => typeof item === 'string' && item.length > 0))
  );
  const uploaderRows =
    uploadedByIds.length > 0
      ? typeof (params.db as any).query?.fpUsers?.findMany === 'function'
        ? await (params.db as any).query.fpUsers.findMany()
        : await params.db
            .select({
              id: fpUsers.id,
              username: fpUsers.username,
              displayName: fpUsers.displayName
            })
            .from(fpUsers)
            .where(inArray(fpUsers.id, uploadedByIds))
      : [];
  const uploadersById = new Map(
    uploaderRows
      .filter((item: any) => uploadedByIds.includes(item.id))
      .map((item: any) => [item.id, item.displayName ?? item.username ?? item.id])
  );
  const attachments = attachmentRows.map((item) => ({
    id: item.id,
    kind: item.kind,
    filename: item.filename,
    mimeType: item.mimeType,
    sizeLabel: formatBytes(item.size),
    uploadedByName: item.uploadedBy ? uploadersById.get(item.uploadedBy) ?? item.uploadedBy : 'Unknown user',
    createdAt: item.createdAt,
    contentUrl: `/attachments/${encodeURIComponent(item.id)}/content`,
    downloadUrl: `/attachments/${encodeURIComponent(item.id)}/content?download=1`,
    isImage: item.kind === 'image' || String(item.mimeType ?? '').toLowerCase().startsWith('image/')
  }));
  const attachmentCount = attachments.length;
  const journalSummaries = orderedFieldKeys(templateJson)
    .map((fieldKey) => {
      const field = templateJson.fields[fieldKey] as TemplateField | undefined;
      if (field?.kind !== 'journal') return null;
      const documentData = ((params.document.dataJson ?? {}) as Record<string, unknown>) ?? {};
      const rows = normalizeJournalRowsForAudit(documentData[fieldKey]);
      return {
        key: fieldKey,
        label: field?.label ?? fieldKey,
        rowCount: rows.length
      };
    })
    .filter((item): item is { key: string; label: string; rowCount: number } => !!item);
  const openWorkItems = buildDocumentOpenWorkItems({
    status: normalizedDocumentStatus,
    hasAssignments: hasAnyAssignments,
    assignedEditorsCount: useMultiAssignments ? assignedEditorsDetailed.length : params.document.editorUserId ? 1 : 0,
    assignedApproversCount: useMultiAssignments ? assignedApprovers.length : params.document.approverUserId ? 1 : 0,
    submittedEditorCount,
    approvedApproverCount,
    rejectedApproverCount,
    attachmentCount
  });
  const auditEvents = params.hasDocumentAuditTrail ? await loadDocumentAuditEvents(params.db, params.document.id) : [];

  await params.reply.renderPage('documents/detail.ejs', {
    template: params.template,
    templateJson,
    workflowRuntime: params.workflowRuntime,
    layoutHtml,
    workflowTimeline,
    processButtons,
    templateActionButtons,
    groupName: params.groupName ?? null,
    assignmentGroupId: params.assignmentGroupId ?? null,
    hasDocumentActorColumns: params.hasDocumentActorColumns,
    assignmentMembers,
    assignmentEditorCandidates,
    assignmentApproverCandidates,
    assignedEditors,
    assignedEditorsDetailed,
    assignedApprovers,
    useMultiAssignments,
    assignmentEditorName,
    assignmentApproverName,
    assignmentEditorHint,
    assignmentApproverHint,
    hasAnyAssignments,
    assignmentsOpen: params.assignmentsOpen ?? false,
    errorMessage: params.errorMessage,
    successMessage: params.successMessage,
    workflowEvaluation,
    workflowHint,
    submittedEditorCount,
    approvedApproverCount,
    rejectedApproverCount,
    attachmentCount,
    journalSummaries,
    openWorkItems,
    hasDocumentAttachments: params.hasDocumentAttachments,
    attachments,
    hasDocumentAuditTrail: !!params.hasDocumentAuditTrail,
    auditEvents,
    document: { ...params.document, status: normalizedDocumentStatus },
    dataJson: dataJsonForRender,
    externalRefsJson: (params.document.externalRefsJson ?? {}) as Record<string, unknown>,
    snapshotsJson: (params.document.snapshotsJson ?? {}) as Record<string, unknown>
  });
}

function classifyStatusBucket(status: string): 'Open' | 'In Progress' | 'Done' {
  const normalized = normalizeDocumentStatus(status);
  if (normalized === 'approved') return 'Done';
  if (normalized === 'archived') return 'Done';
  if (normalized === 'assigned' || normalized === 'submitted') return 'In Progress';
  if (normalized === 'created') return 'Open';
  return 'Open';
}

function resolveTaskStateForUser(params: {
  role: 'Editor' | 'Approver';
  status: string;
  rights: string;
}): 'open' | 'waiting' | 'done' {
  const normalizedStatus = normalizeDocumentStatus(params.status);
  const rights = params.rights ?? '';

  if (params.role === 'Editor') {
    if (normalizedStatus === 'submitted' || normalizedStatus === 'approved' || normalizedStatus === 'archived') return 'done';
    if ((normalizedStatus === 'created' || normalizedStatus === 'assigned') && rights.includes('w')) return 'open';
    return 'waiting';
  }

  if (normalizedStatus === 'approved' || normalizedStatus === 'archived') return 'done';
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

function buildLegacyWorkflowRuntime(templateJson: TemplateJson): WorkflowRuntimeModel {
  const legacy = (templateJson as any).workflow;
  const order =
    legacy && Array.isArray(legacy.order) && legacy.order.length > 0
      ? legacy.order
          .filter((item: unknown): item is string => typeof item === 'string')
          .map((item: string) => normalizeDocumentStatus(item))
      : [...DOCUMENT_WORKFLOW_ORDER, 'archived'];
  const initialStatus = DOCUMENT_WORKFLOW_INITIAL;
  const legacyStates = legacy && legacy.states && typeof legacy.states === 'object' ? legacy.states : {};
  const states = Object.entries(legacyStates).reduce(
    (acc, [key, value]) => {
      const normalizedKey = normalizeDocumentStatus(key);
      const buttons =
        value && typeof value === 'object' && Array.isArray((value as any).buttons)
          ? (value as any).buttons.filter((x: unknown): x is string => typeof x === 'string')
          : [];
      const editable =
        value && typeof value === 'object' && Array.isArray((value as any).editable)
          ? (value as any).editable.filter((x: unknown): x is string => typeof x === 'string')
          : [];
      const readonly =
        value && typeof value === 'object' && Array.isArray((value as any).readonly)
          ? (value as any).readonly.filter((x: unknown): x is string => typeof x === 'string')
          : [];
      const existing = acc[normalizedKey]?.buttons ?? [];
      acc[normalizedKey] = { buttons: Array.from(new Set([...existing, ...buttons])), editable, readonly };
      return acc;
    },
    {} as Record<string, { buttons: string[]; editable?: string[]; readonly?: string[] }>
  );
  return {
    ref: 'legacy/template-workflow',
    name: 'Legacy Template Workflow',
    order,
    initialStatus,
    states,
    semantics: {},
    actorModel: {},
    hooks: {
      onTransition: [],
      onEnterState: [],
      onWorkflowAction: []
    }
  };
}

async function loadWorkflowRuntimeForTemplate(
  db: FpDb,
  template: { workflowRef?: string | null; templateJson: unknown }
): Promise<WorkflowRuntimeModel> {
  const workflowRef = String((template as any).workflowRef ?? '').trim();
  const templateJson = parseTemplateJson(template.templateJson);
  if (!workflowRef) {
    return buildLegacyWorkflowRuntime(templateJson);
  }
  let rows: Array<{
    id: string;
    key: string;
    name: string;
    state: string;
    version: number;
    workflowJson: unknown;
  }> = [];
  try {
    rows = await db
      .select({
        id: fpWorkflows.id,
        key: fpWorkflows.key,
        name: fpWorkflows.name,
        state: fpWorkflows.state,
        version: fpWorkflows.version,
        workflowJson: fpWorkflows.workflowJson
      })
      .from(fpWorkflows)
      .where(and(eq(fpWorkflows.key, workflowRef), sql`lower(${fpWorkflows.state}) in ('active', 'published')`))
      .orderBy(desc(fpWorkflows.version))
      .limit(1);
  } catch {
    return buildLegacyWorkflowRuntime(templateJson);
  }
  const row = rows[0];
  if (!row) {
    return buildLegacyWorkflowRuntime(templateJson);
  }
  const parsed = parseWorkflowJson(row.workflowJson);
  return {
    ...parsed,
    ref: row.key,
    name: row.name
  };
}

async function loadEditorSubmissionStates(db: FpDb, documentId: string): Promise<EditorSubmissionState[]> {
  if (typeof (db as any).query?.fpDocumentSubmissions?.findMany === 'function') {
    const rows = await (db as any).query.fpDocumentSubmissions.findMany({
      where: eq(fpDocumentSubmissions.documentId, documentId)
    });
    return rows.map((row: any) => ({
      userId: row.userId,
      status: row.status === 'submitted' ? 'submitted' : 'pending',
      submittedAt: row.submittedAt ?? null
    }));
  }
  return [];
}

async function loadApproverDecisionStates(db: FpDb, documentId: string): Promise<ApproverDecisionState[]> {
  if (typeof (db as any).query?.fpDocumentApprovals?.findMany === 'function') {
    const rows = await (db as any).query.fpDocumentApprovals.findMany({
      where: eq(fpDocumentApprovals.documentId, documentId)
    });
    return rows.map((row: any) => ({
      userId: row.userId,
      status: row.status === 'approved' || row.status === 'rejected' ? row.status : 'pending',
      decidedAt: row.decidedAt ?? row.approvedAt ?? null
    }));
  }
  return [];
}

async function loadDocumentAttachments(db: FpDb, documentId: string): Promise<DocumentAttachmentRow[]> {
  if (typeof (db as any).query?.fpDocumentAttachments?.findMany === 'function') {
    const rows = await (db as any).query.fpDocumentAttachments.findMany({
      where: eq(fpDocumentAttachments.documentId, documentId)
    });
    return rows.map((row: any) => ({
      id: row.id,
      documentId: row.documentId,
      kind: row.kind,
      filename: row.filename,
      mimeType: row.mimeType,
      size: row.size,
      storageKey: row.storageKey,
      uploadedBy: row.uploadedBy ?? null,
      createdAt: row.createdAt ?? null
    }));
  }

  if (typeof (db as any).select !== 'function') {
    return [];
  }

  return await db
    .select({
      id: fpDocumentAttachments.id,
      documentId: fpDocumentAttachments.documentId,
      kind: fpDocumentAttachments.kind,
      filename: fpDocumentAttachments.filename,
      mimeType: fpDocumentAttachments.mimeType,
      size: fpDocumentAttachments.size,
      storageKey: fpDocumentAttachments.storageKey,
      uploadedBy: fpDocumentAttachments.uploadedBy,
      createdAt: fpDocumentAttachments.createdAt
    })
    .from(fpDocumentAttachments)
    .where(eq(fpDocumentAttachments.documentId, documentId))
    .orderBy(desc(fpDocumentAttachments.createdAt));
}

async function loadAttachmentById(db: FpDb, attachmentId: string): Promise<DocumentAttachmentRow | null> {
  if (typeof (db as any).query?.fpDocumentAttachments?.findFirst === 'function') {
    const row = await (db as any).query.fpDocumentAttachments.findFirst({
      where: eq(fpDocumentAttachments.id, attachmentId)
    });
    if (!row) return null;
    return {
      id: row.id,
      documentId: row.documentId,
      kind: row.kind,
      filename: row.filename,
      mimeType: row.mimeType,
      size: row.size,
      storageKey: row.storageKey,
      uploadedBy: row.uploadedBy ?? null,
      createdAt: row.createdAt ?? null
    };
  }

  if (typeof (db as any).select !== 'function') {
    return null;
  }

  const rows = await db
    .select({
      id: fpDocumentAttachments.id,
      documentId: fpDocumentAttachments.documentId,
      kind: fpDocumentAttachments.kind,
      filename: fpDocumentAttachments.filename,
      mimeType: fpDocumentAttachments.mimeType,
      size: fpDocumentAttachments.size,
      storageKey: fpDocumentAttachments.storageKey,
      uploadedBy: fpDocumentAttachments.uploadedBy,
      createdAt: fpDocumentAttachments.createdAt
    })
    .from(fpDocumentAttachments)
    .where(eq(fpDocumentAttachments.id, attachmentId))
    .limit(1);
  return rows[0] ?? null;
}

async function loadDocumentAuditEvents(db: FpDb, documentId: string): Promise<DocumentAuditEventRow[]> {
  if (typeof (db as any).query?.fpDocumentAuditEvents?.findMany === 'function') {
    const rows = await (db as any).query.fpDocumentAuditEvents.findMany({
      where: eq(fpDocumentAuditEvents.documentId, documentId)
    });
    return rows
      .map((row: any) => ({
        id: row.id,
        documentId: row.documentId,
        eventType: row.eventType,
        actorUserId: row.actorUserId ?? null,
        actorDisplay: row.actorDisplay ?? null,
        summary: row.summary,
        detailJson: row.detailJson ?? null,
        createdAt: row.createdAt ?? null
      }))
      .sort((left: DocumentAuditEventRow, right: DocumentAuditEventRow) => {
        const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
        const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
        return rightTime - leftTime;
      });
  }

  if (typeof (db as any).select !== 'function') {
    return [];
  }

  return await db
    .select({
      id: fpDocumentAuditEvents.id,
      documentId: fpDocumentAuditEvents.documentId,
      eventType: fpDocumentAuditEvents.eventType,
      actorUserId: fpDocumentAuditEvents.actorUserId,
      actorDisplay: fpDocumentAuditEvents.actorDisplay,
      summary: fpDocumentAuditEvents.summary,
      detailJson: fpDocumentAuditEvents.detailJson,
      createdAt: fpDocumentAuditEvents.createdAt
    })
    .from(fpDocumentAuditEvents)
    .where(eq(fpDocumentAuditEvents.documentId, documentId))
    .orderBy(desc(fpDocumentAuditEvents.createdAt));
}

async function recordDocumentAuditEvent(params: {
  db: FpDb;
  request?: FastifyRequest;
  documentId: string;
  eventType: DocumentAuditEventType;
  summary: string;
  detail?: Record<string, unknown>;
  actorUser?: CurrentUser | null;
  auditGateway?: AuditGateway;
}) {
  const actor = params.actorUser ?? (params.request?.currentUser as CurrentUser | null | undefined) ?? null;
  const actorDisplay = actor ? actor.displayName || actor.username : 'System';
  if (typeof (params.db as any).insert === 'function') {
    await params.db.insert(fpDocumentAuditEvents).values({
      documentId: params.documentId,
      eventType: params.eventType,
      actorUserId: actor?.id ?? null,
      actorDisplay,
      summary: params.summary,
      detailJson: params.detail ?? null
    });
  }

  await params.auditGateway?.record({
    tenantKey: params.request?.tenantContext?.tenantKey ?? 'default',
    entityType: 'document',
    entityId: params.documentId,
    eventType: params.eventType,
    actorUserId: actor?.id ?? null,
    actorDisplay,
    summary: params.summary,
    payload: params.detail ?? {}
  });
}

async function resolveAuditUserDisplay(db: FpDb, userId: string | null | undefined) {
  if (!userId) return null;
  if (typeof (db as any).query?.fpUsers?.findFirst === 'function') {
    const user = await (db as any).query.fpUsers.findFirst({ where: eq(fpUsers.id, userId) });
    if (user) return user.displayName ?? user.username ?? user.id;
  }
  return userId;
}

async function resolveNotificationRecipients(db: FpDb, userIds: string[]) {
  const normalized = Array.from(new Set(userIds.filter((item) => typeof item === 'string' && item.length > 0)));
  if (normalized.length === 0) return [];

  if (typeof (db as any).select === 'function') {
    const rows = await db
      .select({
        id: fpUsers.id,
        username: fpUsers.username,
        displayName: fpUsers.displayName,
        email: fpUsers.email
      })
      .from(fpUsers)
      .where(inArray(fpUsers.id, normalized));

    return normalized.map((userId) => {
      const match = rows.find((item) => item.id === userId);
      const username = match?.username ?? userId;
      return {
        userId,
        displayName: match?.displayName ?? username,
        email: match?.email ?? `${username}@example.local`
      };
    });
  }

  return normalized.map((userId) => ({
    userId,
    displayName: userId,
    email: `${userId}@example.local`
  }));
}

async function publishDocumentNotification(params: {
  db: FpDb;
  request: FastifyRequest;
  notificationGateway?: NotificationGateway;
  appBaseUrl?: string;
  documentId: string;
  type: NotificationType;
  subject: string;
  body: string;
  recipientUserIds: string[];
  meta?: Record<string, unknown>;
}) {
  if (!params.notificationGateway) return;
  const uniqueUserIds = Array.from(new Set(params.recipientUserIds.filter(Boolean)));
  if (uniqueUserIds.length === 0) return;
  const recipients = await resolveNotificationRecipients(params.db, uniqueUserIds);
  if (recipients.length === 0) return;
  const appBase = resolveAppBaseUrl({
    configuredBaseUrl: params.appBaseUrl,
    requestProtocol: requestProtocol(params.request.headers),
    requestHost: params.request.headers.host ?? null
  });
  const linkUrl = buildDocumentDeepLink({
    baseUrl: appBase,
    documentId: params.documentId
  });
  await params.notificationGateway.publish({
    type: params.type,
    subject: params.subject,
    body: `${params.body}\n\nOpen document: ${linkUrl}`,
    recipientUserIds: uniqueUserIds,
    recipients,
    entityType: 'document',
    entityId: params.documentId,
    linkUrl,
    tenantKey: params.request.tenantContext?.tenantKey ?? 'default',
    meta: params.meta
  });
}

function normalizeJournalRowsForAudit(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({ ...item }));
}

function buildJournalRowSignature(row: Record<string, unknown>) {
  const sorted = Object.keys(row)
    .sort()
    .reduce<Record<string, unknown>>((out, key) => {
      out[key] = row[key];
      return out;
    }, {});
  return JSON.stringify(sorted);
}

function summarizeDocumentFieldChanges(params: {
  previousData: Record<string, unknown>;
  nextData: Record<string, unknown>;
  templateJson: TemplateJson;
}) {
  const changedFields: string[] = [];
  const journalChanges: Array<{ fieldKey: string; added: number; updated: number; removed: number }> = [];

  for (const fieldKey of orderedFieldKeys(params.templateJson)) {
    const field = params.templateJson.fields[fieldKey] as TemplateField | undefined;
    const previousValue = params.previousData[fieldKey];
    const nextValue = params.nextData[fieldKey];
    if (JSON.stringify(previousValue) === JSON.stringify(nextValue)) continue;

    if (field?.kind === 'journal') {
      const previousRows = normalizeJournalRowsForAudit(previousValue);
      const nextRows = normalizeJournalRowsForAudit(nextValue);
      const previousSignatures = previousRows.map(buildJournalRowSignature);
      const nextSignatures = nextRows.map(buildJournalRowSignature);
      const previousSet = new Set(previousSignatures);
      const nextSet = new Set(nextSignatures);
      let added = 0;
      let removed = 0;
      for (const signature of nextSignatures) {
        if (!previousSet.has(signature)) added += 1;
      }
      for (const signature of previousSignatures) {
        if (!nextSet.has(signature)) removed += 1;
      }
      const updated = Math.max(0, Math.min(previousRows.length, nextRows.length) - Math.min(added, removed));
      journalChanges.push({ fieldKey, added, updated, removed });
      continue;
    }

    changedFields.push(fieldKey);
  }

  return { changedFields, journalChanges };
}

async function loadDocumentById(db: FpDb, id: string, withActorColumns: boolean, withTemplateVersion: boolean) {
  if (withActorColumns && withTemplateVersion && typeof (db as any).query?.fpDocuments?.findFirst === 'function') {
    const legacy = await (db as any).query?.fpDocuments?.findFirst?.({ where: eq(fpDocuments.id, id) });
    if (!legacy) return null;
    const actorIds = resolveLegacyActorUserIds(legacy);
    return {
      ...legacy,
      templateVersion: withTemplateVersion ? legacy.templateVersion ?? 1 : 1,
      editorUserId: withActorColumns ? actorIds.editorUserId : null,
      approverUserId: withActorColumns ? actorIds.approverUserId : null
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
      integrationContextJson: fpDocuments.integrationContextJson,
      snapshotsJson: fpDocuments.snapshotsJson,
      createdAt: fpDocuments.createdAt,
      updatedAt: fpDocuments.updatedAt
    })
    .from(fpDocuments)
    .where(eq(fpDocuments.id, id))
    .limit(1);

  const doc = rows[0];
  if (!doc) return null;
  const actorIds = resolveLegacyActorUserIds(doc as any);
  return {
    ...doc,
    templateVersion: withTemplateVersion ? (doc as any).templateVersion ?? 1 : 1,
    editorUserId: withActorColumns ? actorIds.editorUserId : null,
    approverUserId: withActorColumns ? actorIds.approverUserId : null
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

function requestProtocol(headers: Record<string, unknown>) {
  const forwarded = headers['x-forwarded-proto'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return forwarded.split(',')[0]?.trim() || 'http';
  }
  return 'http';
}

function buildDocumentWorkflowHint(params: {
  status: string;
  workflowEvaluation: ReturnType<typeof evaluateWorkflow>;
  hasAssignments: boolean;
  assignedEditorsCount: number;
  assignedApproversCount: number;
  submittedEditorCount: number;
  approvedApproverCount: number;
  rejectedApproverCount: number;
}) {
  const normalizedStatus = normalizeDocumentStatus(params.status);
  if (normalizedStatus === 'archived') {
    return 'This document is archived and read-only.';
  }
  if (normalizedStatus === 'approved') {
    return 'All required approvals are complete. The document can now be archived when appropriate.';
  }
  if (!params.hasAssignments && (normalizedStatus === 'created' || normalizedStatus === 'assigned')) {
    return 'Assign editors and approvers first so the document can move through the workflow.';
  }
  if (params.workflowEvaluation.approvalState === 'rejected') {
    return 'At least one approver rejected the document. It remains in submitted so rework and renewed approval can happen in the same V1 flow.';
  }
  if (params.workflowEvaluation.submitMode === 'individual') {
    const remainingSubmissions = Math.max(0, params.assignedEditorsCount - params.submittedEditorCount);
    if (normalizedStatus === 'assigned' && remainingSubmissions > 0) {
      return `Waiting for ${remainingSubmissions} editor submission${remainingSubmissions === 1 ? '' : 's'} before the document becomes globally submitted.`;
    }
  } else if (normalizedStatus === 'assigned' && params.assignedEditorsCount === 0) {
    return 'No editor is assigned yet. Assign an editor before continuing.';
  }
  const remainingApprovals = Math.max(0, params.assignedApproversCount - params.approvedApproverCount - params.rejectedApproverCount);
  if (normalizedStatus === 'submitted' && remainingApprovals > 0) {
    return `Waiting for ${remainingApprovals} approver decision${remainingApprovals === 1 ? '' : 's'} before the document can become approved.`;
  }
  if ((normalizedStatus === 'assigned' || normalizedStatus === 'submitted') && params.assignedApproversCount === 0) {
    return 'No approver is assigned yet. Assign an approver to continue the standard review flow.';
  }
  if (normalizedStatus === 'created') {
    return 'The document is created and ready for assignment.';
  }
  return 'The document is in progress and follows the referenced workflow.';
}

function buildDocumentOpenWorkItems(params: {
  status: string;
  hasAssignments: boolean;
  assignedEditorsCount: number;
  assignedApproversCount: number;
  submittedEditorCount: number;
  approvedApproverCount: number;
  rejectedApproverCount: number;
  attachmentCount: number;
}) {
  const normalizedStatus = normalizeDocumentStatus(params.status);
  const items: string[] = [];
  if (!params.hasAssignments && (normalizedStatus === 'created' || normalizedStatus === 'assigned')) {
    items.push('Assign editors and approvers.');
  }
  if (normalizedStatus === 'assigned' && params.assignedEditorsCount > 0 && params.submittedEditorCount < params.assignedEditorsCount) {
    items.push(`Waiting for ${params.assignedEditorsCount - params.submittedEditorCount} editor submission(s).`);
  }
  if (normalizedStatus === 'submitted') {
    const pendingApprovals = Math.max(0, params.assignedApproversCount - params.approvedApproverCount - params.rejectedApproverCount);
    if (pendingApprovals > 0) items.push(`Waiting for ${pendingApprovals} approver decision(s).`);
  }
  if (params.rejectedApproverCount > 0) {
    items.push('Document was rejected and needs follow-up or rework.');
  }
  if (params.attachmentCount === 0) {
    items.push('No attachments uploaded yet.');
  }
  return items;
}

async function fetchErpCollection(params: {
  erpBaseUrl: string;
  path: string;
  query?: Record<string, string>;
}): Promise<Record<string, unknown>[]> {
  const response = await executeIntegrationRequest({
    baseUrl: params.erpBaseUrl,
    path: params.path,
    method: 'GET',
    query: params.query
  });
  if (!response.ok) {
    throw new Error(`ERP request failed (${response.status}) for ${response.url}`);
  }

  const payload = response.bodyJson as unknown;
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
  const {
    db,
    erpBaseUrl,
    hasDocumentActorColumns = true,
    hasDocumentTemplateVersion = true,
    hasDocumentMultiAssignments = true,
    hasDocumentAttachments = typeof (db as any).query?.fpDocumentAttachments?.findMany === 'function',
    hasDocumentAuditTrail = typeof (db as any).query?.fpDocumentAuditEvents?.findMany === 'function',
    appBaseUrl,
    attachmentStorage,
    auditGateway,
    notificationGateway
  } = opts;
  const supportsMultiAssignments =
    hasDocumentMultiAssignments &&
    typeof (db as any).query?.fpDocumentEditors?.findMany === 'function' &&
    typeof (db as any).query?.fpDocumentApprovals?.findMany === 'function' &&
    typeof (db as any).query?.fpDocumentSubmissions?.findMany === 'function';

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

    const response = await executeIntegrationRequest({
      baseUrl: erpBaseUrl,
      path: '/api/batches',
      method: 'POST',
      jsonBody: { product_id: productId }
    });

    if (!response.ok) {
      let message = `Failed creating batch (${response.status})`;
      try {
        const payload = (response.bodyJson ?? {}) as { message?: unknown };
        if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
          message = payload.message;
        }
      } catch {
        // ignore JSON parse errors and keep fallback message
      }
      return sendUiError(request, reply, 400, message);
    }

    const payload = (response.bodyJson ?? {}) as { batch_number?: unknown };
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

  app.get('/macros', async (request, reply) => {
    const parsedQuery = macroListQuerySchema.safeParse(request.query);
    const selectedTemplateId = parsedQuery.success ? parsedQuery.data.templateId ?? '' : '';
    const selectedTemplateStateRaw = parsedQuery.success ? parsedQuery.data.templateState ?? 'all' : 'all';
    const selectedTemplateState = selectedTemplateStateRaw === 'archived' ? 'inactive' : selectedTemplateStateRaw;

    const templateOptions = await db
      .select({
        id: fpTemplates.id,
        key: fpTemplates.key,
        name: fpTemplates.name,
        version: fpTemplates.version,
        state: fpTemplates.state
      })
      .from(fpTemplates)
      .orderBy(asc(fpTemplates.name), desc(fpTemplates.version));

    const whereClauses: any[] = [];
    if (selectedTemplateId) whereClauses.push(eq(fpTemplateMacros.templateId, selectedTemplateId));
    if (selectedTemplateState !== 'all') {
      if (selectedTemplateState === 'inactive') {
        whereClauses.push(sql`lower(${fpTemplates.state}) in ('inactive', 'archived')`);
      } else {
        whereClauses.push(sql`lower(${fpTemplates.state}) = ${selectedTemplateState}`);
      }
    }

    const filterActive = whereClauses.length > 0;
    let linkedMacroRows: Array<{ macroRef: string }> = [];
    if (filterActive) {
      try {
        linkedMacroRows = await db
          .select({ macroRef: fpTemplateMacros.macroRef })
          .from(fpTemplateMacros)
          .innerJoin(fpTemplates, eq(fpTemplates.id, fpTemplateMacros.templateId))
          .where(whereClauses.length > 1 ? and(...whereClauses) : whereClauses[0]);
      } catch {
        linkedMacroRows = [];
      }
    }
    const filteredMacroRefs = Array.from(new Set(linkedMacroRows.map((item) => item.macroRef)));

    const macroSelect = db
      .select({
        ref: fpMacros.ref,
        namespace: fpMacros.namespace,
        name: fpMacros.name,
        version: fpMacros.version,
        isEnabled: fpMacros.isEnabled,
        kind: fpMacros.kind,
        description: fpMacros.description
      })
      .from(fpMacros);
    const macros =
      filterActive && filteredMacroRefs.length === 0
        ? []
        : await (
            filterActive
              ? macroSelect.where(inArray(fpMacros.ref, filteredMacroRefs))
              : macroSelect
          ).orderBy(asc(fpMacros.namespace), asc(fpMacros.name), desc(fpMacros.version));

    await reply.renderPage('macros/list.ejs', {
      macros: macros.map((macro) => ({ ...macro, kind: normalizeMacroKind(macro.kind) })),
      templateOptions,
      selectedTemplateId,
      selectedTemplateState
    });
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
        definition_json: ''
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
      definitionJsonText: getFormString(form, 'definition_json')
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
          definition_json: getFormString(form, 'definition_json')
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
            definition_json: parsed.data.definitionJsonText ?? ''
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
          definition_json: getFormString(form, 'definition_json')
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
    let templatesUsingMacro: Array<{
      templateId: string;
      templateName: string;
      templateKey: string;
      templateVersion: number;
      templateState: string;
    }> = [];
    try {
      templatesUsingMacro = await db
        .select({
          templateId: fpTemplates.id,
          templateName: fpTemplates.name,
          templateKey: fpTemplates.key,
          templateVersion: fpTemplates.version,
          templateState: fpTemplates.state
        })
        .from(fpTemplateMacros)
        .innerJoin(fpTemplates, eq(fpTemplates.id, fpTemplateMacros.templateId))
        .where(eq(fpTemplateMacros.macroRef, macro.ref))
        .orderBy(asc(fpTemplates.name), desc(fpTemplates.version));
    } catch {
      templatesUsingMacro = [];
    }

    await reply.renderPage('macros/detail.ejs', {
      macro: { ...macro, kind: normalizeMacroKind(macro.kind) },
      templatesUsingMacro
    });
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
        kind: normalizeMacroKind(macro.kind),
        params_schema_json: macro.paramsSchemaJson ? JSON.stringify(macro.paramsSchemaJson, null, 2) : '',
        definition_json: macro.definitionJson ? JSON.stringify(macro.definitionJson, null, 2) : ''
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
      definitionJsonText: getFormString(form, 'definition_json')
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
          definition_json: getFormString(form, 'definition_json')
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
          definition_json: getFormString(form, 'definition_json')
        }
      });
    }

    reply.code(303);
    return reply.redirect(`/macros/${encodeURIComponent(parsed.data.ref)}/edit`);
  });

  app.get('/apis', async (request, reply) => {
    const parsedQuery = apiListQuerySchema.safeParse(request.query);
    const selectedState = parsedQuery.success ? parsedQuery.data.state ?? 'active' : 'active';
    const whereState = selectedState === 'all' ? undefined : selectedState;
    try {
      const catalog = await loadOperationCatalogView(db);
      const rows = catalog.bridgeApis.filter((row) => (whereState ? row.state === whereState : true));

      await reply.renderPage('apis/list.ejs', {
        apis: rows,
        operations: catalog.operations,
        filters: {
          state: selectedState
        }
      });
    } catch (error) {
      if (isMissingRelationError(error, 'fp_apis')) {
        request.log.error(
          { error },
          'DB relation fp_apis is missing. Run: cd app && npm run db:push'
        );
        return sendUiError(request, reply, 503, 'APIs table is missing. Run: cd app && npm run db:push');
      }
      throw error;
    }
  });

  app.get('/apis/new', async (_request, reply) => {
    await reply.renderPage('apis/new.ejs', {
      errorMessage: '',
      form: {
        key: '',
        name: '',
        description: '',
        state: 'active',
        method: 'GET',
        base_url: '',
        path: '',
        request_schema_json: '',
        response_schema_json: '',
        handler_code: ''
      }
    });
  });

  app.post('/apis', async (request, reply) => {
    const form = toFormRecord(request.body);
    const parsed = apiFormSchema.safeParse({
      key: getFormString(form, 'key'),
      name: getFormString(form, 'name'),
      description: getFormString(form, 'description'),
      state: normalizeApiState(getFormString(form, 'state')),
      method: normalizeApiMethod(getFormString(form, 'method')),
      baseUrl: getFormString(form, 'base_url'),
      path: getFormString(form, 'path'),
      requestSchemaJsonText: getFormString(form, 'request_schema_json'),
      responseSchemaJsonText: getFormString(form, 'response_schema_json'),
      handlerCodeText: getFormString(form, 'handler_code')
    });

    if (!parsed.success) {
      return reply.status(400).renderPage('apis/new.ejs', {
        errorMessage: 'Please provide key, name, state, method, base_url and path.',
        form: {
          key: getFormString(form, 'key'),
          name: getFormString(form, 'name'),
          description: getFormString(form, 'description'),
          state: normalizeApiState(getFormString(form, 'state')),
          method: normalizeApiMethod(getFormString(form, 'method')),
          base_url: getFormString(form, 'base_url'),
          path: getFormString(form, 'path'),
          request_schema_json: getFormString(form, 'request_schema_json'),
          response_schema_json: getFormString(form, 'response_schema_json'),
          handler_code: getFormString(form, 'handler_code')
        }
      });
    }

    try {
      const requestSchemaJson = parseOptionalJsonField(parsed.data.requestSchemaJsonText, 'request_schema_json');
      const responseSchemaJson = parseOptionalJsonField(parsed.data.responseSchemaJsonText, 'response_schema_json');

      const inserted = await db
        .insert(fpApis)
        .values({
          key: parsed.data.key.trim(),
          name: parsed.data.name.trim(),
          description: parsed.data.description?.trim() || null,
          state: parsed.data.state,
          method: parsed.data.method,
          baseUrl: parsed.data.baseUrl.trim(),
          path: parsed.data.path,
          requestSchemaJson,
          responseSchemaJson,
          handlerCode: parsed.data.handlerCodeText?.trim() || null,
          updatedAt: new Date()
        })
        .returning({ id: fpApis.id });

      reply.code(303);
      return reply.redirect(`/apis/${inserted[0].id}`);
    } catch (error) {
      if (isMissingRelationError(error, 'fp_apis')) {
        request.log.error(
          { error },
          'DB relation fp_apis is missing. Run: cd app && npm run db:push'
        );
        return sendUiError(request, reply, 503, 'APIs table is missing. Run: cd app && npm run db:push');
      }
      return reply.status(400).renderPage('apis/new.ejs', {
        errorMessage: error instanceof Error ? error.message : 'Invalid API input',
        form: {
          key: getFormString(form, 'key'),
          name: getFormString(form, 'name'),
          description: getFormString(form, 'description'),
          state: normalizeApiState(getFormString(form, 'state')),
          method: normalizeApiMethod(getFormString(form, 'method')),
          base_url: getFormString(form, 'base_url'),
          path: getFormString(form, 'path'),
          request_schema_json: getFormString(form, 'request_schema_json'),
          response_schema_json: getFormString(form, 'response_schema_json'),
          handler_code: getFormString(form, 'handler_code')
        }
      });
    }
  });

  app.get('/apis/:id', async (request, reply) => {
    const paramsParsed = templateIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Invalid API id' });
    }
    let api;
    try {
      api = await db.query.fpApis.findFirst({ where: eq(fpApis.id, paramsParsed.data.id) });
    } catch (error) {
      if (isMissingRelationError(error, 'fp_apis')) {
        request.log.error(
          { error },
          'DB relation fp_apis is missing. Run: cd app && npm run db:push'
        );
        return sendUiError(request, reply, 503, 'APIs table is missing. Run: cd app && npm run db:push');
      }
      throw error;
    }
    if (!api) {
      return reply.status(404).send({ message: 'API not found' });
    }
    const templatesUsingApi = await loadTemplatesUsingApi(db, api.key);
    const connectorOperation = resolveConnectorOperation(api.key);
    await reply.renderPage('apis/detail.ejs', {
      api: {
        ...api,
        state: normalizeApiState(api.state),
        method: normalizeApiMethod(api.method)
      },
      connectorOperation: connectorOperation ? buildConnectorOperationView(connectorOperation, { state: api.state }) : null,
      templatesUsingApi,
      apiTest: {
        requestJson: buildApiTestExample(api.requestSchemaJson),
        requestUrl: '',
        requestMethod: normalizeApiMethod(api.method),
        requestPayload: '',
        responseStatus: null,
        responseBody: '',
        errorMessage: ''
      }
    });
  });

  app.post('/apis/:id/test', async (request, reply) => {
    const paramsParsed = templateIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Invalid API id' });
    }
    const api = await db.query.fpApis.findFirst({ where: eq(fpApis.id, paramsParsed.data.id) });
    if (!api) {
      return reply.status(404).send({ message: 'API not found' });
    }
    const form = toFormRecord(request.body);
    const requestJsonText = getFormString(form, 'request_json');
    let requestPayload: Record<string, unknown> = {};
    try {
      requestPayload = requestJsonText.trim().length > 0 ? (JSON.parse(requestJsonText) as Record<string, unknown>) : {};
    } catch {
      const templatesUsingApi = await loadTemplatesUsingApi(db, api.key);
      return reply.status(400).renderPage('apis/detail.ejs', {
        api: {
          ...api,
          state: normalizeApiState(api.state),
          method: normalizeApiMethod(api.method)
        },
        templatesUsingApi,
        apiTest: {
          requestJson: requestJsonText,
          requestUrl: '',
          requestMethod: normalizeApiMethod(api.method),
          requestPayload: requestJsonText,
          responseStatus: null,
          responseBody: '',
          errorMessage: 'request_json must be valid JSON.'
        }
      });
    }

    const method = normalizeApiMethod(api.method);
    const baseUrl = api.baseUrl ?? erpBaseUrl;
    const url = new URL(api.path, baseUrl);
    const headers: Record<string, string> = { Accept: 'application/json' };
    const hasBody = method !== 'GET' && method !== 'DELETE';
    if (!hasBody) {
      for (const [key, value] of Object.entries(requestPayload)) {
        if (value === undefined || value === null || String(value).trim() === '') continue;
        url.searchParams.set(key, String(value));
      }
    }
    let responseStatus: number | null = null;
    let responseBody = '';
    let errorMessage = '';
    const requestMethod = method;
    const requestUrl = url.toString();
    const requestPayloadText = hasBody ? JSON.stringify(requestPayload, null, 2) : JSON.stringify(requestPayload, null, 2);
    try {
      const response = await executeIntegrationRequest({
        baseUrl,
        path: api.path,
        method,
        query: hasBody
          ? undefined
          : Object.fromEntries(
              Object.entries(requestPayload).filter(
                ([, value]) => value !== undefined && value !== null && String(value).trim() !== ''
              ) as Array<[string, string]>
            ),
        headers,
        ...(hasBody ? { jsonBody: requestPayload } : {})
      });
      responseStatus = response.status;
      if (response.bodyJson !== undefined) {
        responseBody = JSON.stringify(response.bodyJson, null, 2);
      } else {
        responseBody = response.bodyText;
      }
      if (!response.ok) {
        errorMessage = `API test failed with HTTP ${response.status}.`;
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'API test failed.';
    }
    const templatesUsingApi = await loadTemplatesUsingApi(db, api.key);
    await reply.renderPage('apis/detail.ejs', {
      api: {
        ...api,
        state: normalizeApiState(api.state),
        method: normalizeApiMethod(api.method)
      },
      templatesUsingApi,
      apiTest: {
        requestJson: requestJsonText,
        requestUrl,
        requestMethod,
        requestPayload: requestPayloadText,
        responseStatus,
        responseBody,
        errorMessage
      }
    });
  });

  app.get('/apis/:id/edit', async (request, reply) => {
    const paramsParsed = templateIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Invalid API id' });
    }
    let api;
    try {
      api = await db.query.fpApis.findFirst({ where: eq(fpApis.id, paramsParsed.data.id) });
    } catch (error) {
      if (isMissingRelationError(error, 'fp_apis')) {
        request.log.error(
          { error },
          'DB relation fp_apis is missing. Run: cd app && npm run db:push'
        );
        return sendUiError(request, reply, 503, 'APIs table is missing. Run: cd app && npm run db:push');
      }
      throw error;
    }
    if (!api) {
      return reply.status(404).send({ message: 'API not found' });
    }
    await reply.renderPage('apis/edit.ejs', {
      api,
      errorMessage: '',
      form: {
        key: api.key,
        name: api.name,
        description: api.description ?? '',
        state: normalizeApiState(api.state),
        method: normalizeApiMethod(api.method),
        base_url: api.baseUrl ?? '',
        path: api.path,
        request_schema_json: api.requestSchemaJson ? JSON.stringify(api.requestSchemaJson, null, 2) : '',
        response_schema_json: api.responseSchemaJson ? JSON.stringify(api.responseSchemaJson, null, 2) : '',
        handler_code: api.handlerCode ?? ''
      }
    });
  });

  app.post('/apis/:id', async (request, reply) => {
    const paramsParsed = templateIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Invalid API id' });
    }
    let existing;
    try {
      existing = await db.query.fpApis.findFirst({ where: eq(fpApis.id, paramsParsed.data.id) });
    } catch (error) {
      if (isMissingRelationError(error, 'fp_apis')) {
        request.log.error(
          { error },
          'DB relation fp_apis is missing. Run: cd app && npm run db:push'
        );
        return sendUiError(request, reply, 503, 'APIs table is missing. Run: cd app && npm run db:push');
      }
      throw error;
    }
    if (!existing) {
      return reply.status(404).send({ message: 'API not found' });
    }

    const form = toFormRecord(request.body);
    const parsed = apiFormSchema.safeParse({
      key: getFormString(form, 'key'),
      name: getFormString(form, 'name'),
      description: getFormString(form, 'description'),
      state: normalizeApiState(getFormString(form, 'state')),
      method: normalizeApiMethod(getFormString(form, 'method')),
      baseUrl: getFormString(form, 'base_url'),
      path: getFormString(form, 'path'),
      requestSchemaJsonText: getFormString(form, 'request_schema_json'),
      responseSchemaJsonText: getFormString(form, 'response_schema_json'),
      handlerCodeText: getFormString(form, 'handler_code')
    });

    if (!parsed.success) {
      return reply.status(400).renderPage('apis/edit.ejs', {
        api: existing,
        errorMessage: 'Please provide key, name, state, method, base_url and path.',
        form: {
          key: getFormString(form, 'key'),
          name: getFormString(form, 'name'),
          description: getFormString(form, 'description'),
          state: normalizeApiState(getFormString(form, 'state')),
          method: normalizeApiMethod(getFormString(form, 'method')),
          base_url: getFormString(form, 'base_url'),
          path: getFormString(form, 'path'),
          request_schema_json: getFormString(form, 'request_schema_json'),
          response_schema_json: getFormString(form, 'response_schema_json'),
          handler_code: getFormString(form, 'handler_code')
        }
      });
    }

    try {
      const requestSchemaJson = parseOptionalJsonField(parsed.data.requestSchemaJsonText, 'request_schema_json');
      const responseSchemaJson = parseOptionalJsonField(parsed.data.responseSchemaJsonText, 'response_schema_json');
      await db
        .update(fpApis)
        .set({
          key: parsed.data.key.trim(),
          name: parsed.data.name.trim(),
          description: parsed.data.description?.trim() || null,
          state: parsed.data.state,
          method: parsed.data.method,
          baseUrl: parsed.data.baseUrl.trim(),
          path: parsed.data.path,
          requestSchemaJson,
          responseSchemaJson,
          handlerCode: parsed.data.handlerCodeText?.trim() || null,
          updatedAt: new Date()
        })
        .where(eq(fpApis.id, existing.id));
    } catch (error) {
      if (isMissingRelationError(error, 'fp_apis')) {
        request.log.error(
          { error },
          'DB relation fp_apis is missing. Run: cd app && npm run db:push'
        );
        return sendUiError(request, reply, 503, 'APIs table is missing. Run: cd app && npm run db:push');
      }
      return reply.status(400).renderPage('apis/edit.ejs', {
        api: existing,
        errorMessage: error instanceof Error ? error.message : 'Invalid API input',
        form: {
          key: getFormString(form, 'key'),
          name: getFormString(form, 'name'),
          description: getFormString(form, 'description'),
          state: normalizeApiState(getFormString(form, 'state')),
          method: normalizeApiMethod(getFormString(form, 'method')),
          base_url: getFormString(form, 'base_url'),
          path: getFormString(form, 'path'),
          request_schema_json: getFormString(form, 'request_schema_json'),
          response_schema_json: getFormString(form, 'response_schema_json'),
          handler_code: getFormString(form, 'handler_code')
        }
      });
    }

    reply.code(303);
    return reply.redirect(`/apis/${existing.id}`);
  });

  app.get('/workflows', async (request, reply) => {
    const query = toFormRecord(request.query);
    const selectedStateRaw = normalizeOptionalFilter(getFormString(query, 'state')).toLowerCase();
    const selectedState = selectedStateRaw === 'draft' || selectedStateRaw === 'inactive' || selectedStateRaw === 'all'
      ? selectedStateRaw
      : 'active';
    const whereState = selectedState === 'all' ? undefined : selectedState;
    const rows = await db
      .select({
        id: fpWorkflows.id,
        key: fpWorkflows.key,
        name: fpWorkflows.name,
        state: fpWorkflows.state,
        version: fpWorkflows.version,
        updatedAt: fpWorkflows.updatedAt
      })
      .from(fpWorkflows)
      .where(whereState ? eq(fpWorkflows.state, whereState) : undefined)
      .orderBy(asc(fpWorkflows.key), desc(fpWorkflows.version));

    await reply.renderPage('workflows/list.ejs', {
      workflows: rows,
      filters: { state: selectedState }
    });
  });

  app.get('/workflows/new', async (_request, reply) => {
    await reply.renderPage('workflows/new.ejs', {
      errorMessage: '',
      form: {
        key: '',
        name: '',
        description: '',
        state: 'draft',
        workflow_json: JSON.stringify(
          {
            statuses: ['created', 'assigned', 'submitted', 'approved', 'archived'],
            initialStatus: 'created',
            order: ['created', 'assigned', 'submitted', 'approved', 'archived'],
            states: {
              created: { buttons: ['assign'] },
              assigned: { buttons: ['submit'] },
              submitted: { buttons: ['approve'] },
              approved: { buttons: [] },
              archived: { buttons: [] }
            },
            semantics: { submit: 'global', approval: 'individual', completionRule: 'all_required_approvers' },
            actorModel: { editors: 'multiple', approvers: 'multiple' }
          },
          null,
          2
        )
      }
    });
  });

  app.post('/workflows', async (request, reply) => {
    const form = toFormRecord(request.body);
    const parsed = workflowFormSchema.safeParse({
      key: getFormString(form, 'key'),
      name: getFormString(form, 'name'),
      description: getFormString(form, 'description'),
      state: getFormString(form, 'state'),
      workflow_json: getFormString(form, 'workflow_json')
    });
    if (!parsed.success) {
      return reply.status(400).renderPage('workflows/new.ejs', {
        errorMessage: 'Please provide key, name, state and workflow_json.',
        form: {
          key: getFormString(form, 'key'),
          name: getFormString(form, 'name'),
          description: getFormString(form, 'description'),
          state: getFormString(form, 'state') || 'draft',
          workflow_json: getFormString(form, 'workflow_json')
        }
      });
    }
    let workflowJson: Record<string, unknown>;
    try {
      workflowJson = JSON.parse(parsed.data.workflow_json) as Record<string, unknown>;
      parseWorkflowJson(workflowJson);
    } catch {
      return reply.status(400).renderPage('workflows/new.ejs', {
        errorMessage: 'workflow_json must be valid JSON.',
        form: parsed.data
      });
    }
    const existingByKey = await db
      .select({ version: fpWorkflows.version })
      .from(fpWorkflows)
      .where(eq(fpWorkflows.key, parsed.data.key))
      .orderBy(desc(fpWorkflows.version))
      .limit(1);
    const nextVersion = (existingByKey[0]?.version ?? 0) + 1;
    const inserted = await db
      .insert(fpWorkflows)
      .values({
        key: parsed.data.key,
        name: parsed.data.name,
        description: parsed.data.description || null,
        state: parsed.data.state,
        version: nextVersion,
        workflowJson,
        updatedAt: new Date()
      })
      .returning({ id: fpWorkflows.id });
    reply.code(303);
    return reply.redirect(`/workflows/${inserted[0].id}`);
  });

  app.get('/workflows/:id', async (request, reply) => {
    const paramsParsed = templateIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Invalid workflow id' });
    }
    const workflow = await db.query.fpWorkflows.findFirst({ where: eq(fpWorkflows.id, paramsParsed.data.id) });
    if (!workflow) {
      return reply.status(404).send({ message: 'Workflow not found' });
    }
    const templatesUsingWorkflow = await db
      .select({
        id: fpTemplates.id,
        key: fpTemplates.key,
        name: fpTemplates.name,
        version: fpTemplates.version,
        state: fpTemplates.state
      })
      .from(fpTemplates)
      .where(eq(fpTemplates.workflowRef, workflow.key))
      .orderBy(asc(fpTemplates.key), desc(fpTemplates.version));
    const query = toFormRecord(request.query);
    const simulationStatus = normalizeDocumentStatus(
      normalizeOptionalFilter(getFormString(query, 'status')) || 'created'
    );
    const simulationActor = (normalizeOptionalFilter(getFormString(query, 'actor')) || 'editor') === 'approver'
      ? 'approver'
      : 'editor';
    const submittedEditors = Math.max(0, Number.parseInt(getFormString(query, 'submittedEditors') || '0', 10) || 0);
    const assignedApprovers = Math.max(0, Number.parseInt(getFormString(query, 'assignedApprovers') || '2', 10) || 0);
    const approvedApprovers = Math.max(0, Number.parseInt(getFormString(query, 'approvedApprovers') || '0', 10) || 0);
    const rejectedApprovers = Math.max(0, Number.parseInt(getFormString(query, 'rejectedApprovers') || '0', 10) || 0);
    const workflowRuntime = parseWorkflowJson(workflow.workflowJson);
    const hookOperations = loadWorkflowHookUsageView(workflowRuntime);
    const simulation = {
      ...evaluateWorkflow({
        workflow: workflowRuntime,
        status: simulationStatus,
        editorSubmissions: Array.from({ length: Math.max(submittedEditors, 1) }).map((_, index) => ({
          userId: `editor-${index + 1}`,
          status: index < submittedEditors ? 'submitted' : 'pending'
        })),
        approverDecisions: Array.from({ length: assignedApprovers }).map((_, index) => ({
          userId: `approver-${index + 1}`,
          status:
            index < rejectedApprovers ? 'rejected' : index < approvedApprovers ? 'approved' : 'pending'
        }))
      }),
      workflow: workflowRuntime,
      status: simulationStatus,
      actor: simulationActor,
      submittedEditors,
      assignedApprovers,
      approvedApprovers,
      rejectedApprovers
    };
    await reply.renderPage('workflows/detail.ejs', {
      workflow,
      templatesUsingWorkflow,
      simulation,
      hookOperations
    });
  });

  app.get('/workflows/:id/edit', async (request, reply) => {
    const paramsParsed = templateIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Invalid workflow id' });
    }
    const workflow = await db.query.fpWorkflows.findFirst({ where: eq(fpWorkflows.id, paramsParsed.data.id) });
    if (!workflow) {
      return reply.status(404).send({ message: 'Workflow not found' });
    }
    await reply.renderPage('workflows/edit.ejs', {
      workflow,
      errorMessage: '',
      form: {
        key: workflow.key,
        name: workflow.name,
        description: workflow.description ?? '',
        state: workflow.state,
        workflow_json: JSON.stringify(workflow.workflowJson ?? {}, null, 2)
      }
    });
  });

  app.post('/workflows/:id', async (request, reply) => {
    const paramsParsed = templateIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Invalid workflow id' });
    }
    const workflow = await db.query.fpWorkflows.findFirst({ where: eq(fpWorkflows.id, paramsParsed.data.id) });
    if (!workflow) {
      return reply.status(404).send({ message: 'Workflow not found' });
    }
    const form = toFormRecord(request.body);
    const parsed = workflowFormSchema.safeParse({
      key: getFormString(form, 'key'),
      name: getFormString(form, 'name'),
      description: getFormString(form, 'description'),
      state: getFormString(form, 'state'),
      workflow_json: getFormString(form, 'workflow_json')
    });
    if (!parsed.success) {
      return reply.status(400).renderPage('workflows/edit.ejs', {
        workflow,
        errorMessage: 'Please provide key, name, state and workflow_json.',
        form: {
          key: getFormString(form, 'key'),
          name: getFormString(form, 'name'),
          description: getFormString(form, 'description'),
          state: getFormString(form, 'state') || workflow.state,
          workflow_json: getFormString(form, 'workflow_json')
        }
      });
    }
    let workflowJson: Record<string, unknown>;
    try {
      workflowJson = JSON.parse(parsed.data.workflow_json) as Record<string, unknown>;
      parseWorkflowJson(workflowJson);
    } catch {
      return reply.status(400).renderPage('workflows/edit.ejs', {
        workflow,
        errorMessage: 'workflow_json must be valid JSON.',
        form: parsed.data
      });
    }
    await db
      .update(fpWorkflows)
      .set({
        key: parsed.data.key,
        name: parsed.data.name,
        description: parsed.data.description || null,
        state: parsed.data.state,
        workflowJson,
        updatedAt: new Date()
      })
      .where(eq(fpWorkflows.id, workflow.id));

    reply.code(303);
    return reply.redirect(`/workflows/${workflow.id}`);
  });

  app.get('/templates', async (request, reply) => {
    const query = toFormRecord(request.query);
    const stateFilterRawInput = normalizeOptionalFilter(getFormString(query, 'state'));
    const stateFilterRaw = stateFilterRawInput === 'archived' ? 'inactive' : stateFilterRawInput;
    const stateFilter: 'published' | 'draft' | 'inactive' | 'all' =
      stateFilterRaw === 'draft' || stateFilterRaw === 'published' || stateFilterRaw === 'inactive' || stateFilterRaw === 'all'
        ? (stateFilterRaw as 'published' | 'draft' | 'inactive' | 'all')
        : 'published';

    const whereConditions: any[] = [];
    if (stateFilter !== 'all') {
      if (stateFilter === 'inactive') {
        whereConditions.push(sql`lower(${fpTemplates.state}) in ('inactive', 'archived')`);
      } else {
        whereConditions.push(sql`lower(${fpTemplates.state}) = ${stateFilter}`);
      }
    }

    const templatesRaw = await db
      .select({
        id: fpTemplates.id,
        key: fpTemplates.key,
        name: fpTemplates.name,
        description: fpTemplates.description,
        state: fpTemplates.state,
        version: fpTemplates.version,
        workflowRef: fpTemplates.workflowRef,
        templateJson: fpTemplates.templateJson
      })
      .from(fpTemplates)
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
      .orderBy(asc(fpTemplates.key), desc(fpTemplates.version), asc(fpTemplates.name));
    const templates = pickRelevantTemplatesByKey(templatesRaw, stateFilter).sort((a, b) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
    );

    const templateIds = templates.map((item) => item.id);
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
    let macroRows: Array<{ templateId: string; macroRef: string }> = [];
    if (templateIds.length > 0) {
      try {
        macroRows = await db
          .select({
            templateId: fpTemplateMacros.templateId,
            macroRef: fpTemplateMacros.macroRef
          })
          .from(fpTemplateMacros)
          .where(inArray(fpTemplateMacros.templateId, templateIds));
      } catch {
        macroRows = [];
      }
    }
    const macroCountsByTemplateId = macroRows.reduce(
      (acc, row) => {
        const set = acc.get(row.templateId) ?? new Set<string>();
        set.add(row.macroRef);
        acc.set(row.templateId, set);
        return acc;
      },
      new Map<string, Set<string>>()
    );

    const templatesWithGroups = templates.map((tpl) => {
      const assignedGroups = groupsByTemplateId.get(tpl.id) ?? [];
      const macroCount = macroCountsByTemplateId.get(tpl.id)?.size ?? 0;
      const usage = extractTemplateUsage(tpl.templateJson);
      const apiCount = usage.apiRefs.length;
      const actionCount = usage.actions.length;
      return {
        ...tpl,
        assignedGroups,
        assignedGroupCount: assignedGroups.length,
        macroCount,
        apiCount,
        actionCount,
        workflowRef: tpl.workflowRef ?? ''
      };
    });

    await reply.renderPage('templates/list.ejs', {
      templates: templatesWithGroups,
      filters: { state: stateFilter }
    });
  });

  app.get('/templates/:id', async (request, reply) => {
    const paramsParsed = templateIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Invalid template id' });
    }

    const template = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, paramsParsed.data.id) });
    if (!template) {
      return reply.status(404).send({ message: 'Template not found' });
    }

    const workflow =
      template.workflowRef && typeof (db as any).query?.fpWorkflows?.findMany === 'function'
        ? (
            await (db as any).query.fpWorkflows.findMany({
              where: eq(fpWorkflows.key, template.workflowRef)
            })
          )
            .sort((a: any, b: any) => Number(b.version ?? 0) - Number(a.version ?? 0))[0] ?? null
        : null;
    const apiUsageView = await loadTemplateApiUsageView(db, template);
    const operationUsageView = await loadTemplateOperationUsageView(template);
    const actionUsage = safeCollectTemplateActionUsage(template.templateJson);
    const documentTableView = await loadTemplateDocumentTableView(db, template, {
      hasDocumentActorColumns,
      hasDocumentMultiAssignments
    });

    await reply.renderPage('templates/detail.ejs', {
      template,
      normalizedState: normalizeTemplateState(template.state),
      workflow,
      usedOperations: operationUsageView.usedOperations,
      missingOperationRefs: operationUsageView.missingOperationRefs,
      usedApis: apiUsageView.usedApis,
      missingApiRefs: apiUsageView.missingApiRefs,
      usedActions: actionUsage,
      documentTableColumns: documentTableView.columns,
      documentTableRows: documentTableView.rows
    });
  });

  app.get('/templates/:id/versions', async (request, reply) => {
    const paramsParsed = templateIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Invalid template id' });
    }
    const selected = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, paramsParsed.data.id) });
    if (!selected) {
      return reply.status(404).send({ message: 'Template not found' });
    }

    const versions = await loadTemplateVersionsByKey(db, selected.key);
    await reply.renderPage('templates/versions.ejs', {
      selected,
      versions
    });
  });

  app.get('/templates/new', async (_request, reply) => {
    const starterTemplateJsonText = JSON.stringify(builderReadyStarterTemplate, null, 2);
    const workflows = await loadWorkflowOptions(db);
    await reply.renderPage('templates/new.ejs', {
      builderEnabled: true,
      errorMessage: '',
      warnings: collectTemplateWarnings(builderReadyStarterTemplate),
      builderPreviewHtml: buildTemplateBuilderPreviewHtmlFromText(starterTemplateJsonText),
      workflows,
      form: {
        key: '',
        name: '',
        description: '',
        state: 'draft',
        workflow_ref: workflows[0]?.key ?? '',
        template_json: starterTemplateJsonText
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
      workflow_ref: getFormString(form, 'workflow_ref'),
      template_json: getFormString(form, 'template_json')
    });

    if (!parsed.success) {
      const workflows = await loadWorkflowOptions(db);
      return reply.status(400).renderPage('templates/new.ejs', {
        builderEnabled: true,
        errorMessage: 'Please provide key, name, state and template_json.',
        warnings: [],
        builderPreviewHtml: buildTemplateBuilderPreviewHtmlFromText(getFormString(form, 'template_json')),
        workflows,
        form: {
          key: getFormString(form, 'key'),
          name: getFormString(form, 'name'),
          description: getFormString(form, 'description'),
          state: normalizeTemplateState(getFormString(form, 'state')),
          workflow_ref: getFormString(form, 'workflow_ref'),
          template_json: getFormString(form, 'template_json')
        }
      });
    }

    let templateJson: ReturnType<typeof parseTemplateEditorJson>;
    try {
      templateJson = parseTemplateEditorJson(parsed.data.template_json);
    } catch (error) {
      const workflows = await loadWorkflowOptions(db);
      return reply.status(400).renderPage('templates/new.ejs', {
        builderEnabled: true,
        errorMessage: error instanceof Error ? error.message : 'Invalid template_json',
        warnings: parsed.success ? collectTemplateWarnings(JSON.parse(parsed.data.template_json)) : [],
        builderPreviewHtml: buildTemplateBuilderPreviewHtmlFromText(parsed.data.template_json),
        workflows,
        form: parsed.data
      });
    }

    const normalizedTemplateJson = normalizeTemplateJsonForV1Storage(templateJson);
    const inserted = await db
      .insert(fpTemplates)
      .values({
        key: parsed.data.key,
        name: parsed.data.name,
        description: parsed.data.description || null,
        state: parsed.data.state,
        workflowRef: parsed.data.workflow_ref?.trim() || null,
        publishedAt: resolvePublishedAtForStateChange(parsed.data.state),
        templateJson: normalizedTemplateJson,
        version: 1
      })
      .returning({ id: fpTemplates.id });
    await syncTemplateMacroRefs(db, inserted[0].id, normalizedTemplateJson, request.log);

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
          workflowRef: (template as any).workflowRef ?? null,
          templateJson: template.templateJson
        })
        .returning({ id: fpTemplates.id });
      const draftId = inserted[0].id;
      const draftTemplateJson = parseTemplateJson(template.templateJson);
      await syncTemplateMacroRefs(db, draftId, draftTemplateJson, request.log);

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
    const macroUsageView = await loadTemplateMacroUsageView(db, template.id);
    const apiUsageView = await loadTemplateApiUsageView(db, template);
    const actionUsage = safeCollectTemplateActionUsage(template.templateJson);
    const workflows = await loadWorkflowOptions(db);
    const builderReadyTemplateJson = normalizeTemplateJsonForV1Storage(parseTemplateJson(template.templateJson));

    await reply.renderPage('templates/edit.ejs', {
      template,
      builderEnabled: true,
      errorMessage: '',
      warnings: collectTemplateWarnings(template.templateJson),
      builderPreviewHtml: buildTemplateBuilderPreviewHtmlFromText(JSON.stringify(builderReadyTemplateJson, null, 2)),
      assignedGroups: assignmentView.assignedGroups,
      assignableGroups: assignmentView.assignableGroups,
      hasGroups: assignmentView.hasGroups,
      usedMacros: macroUsageView.usedMacros,
      missingMacroRefs: macroUsageView.missingMacroRefs,
      usedApis: apiUsageView.usedApis,
      missingApiRefs: apiUsageView.missingApiRefs,
      usedActions: actionUsage,
      workflows,
      form: {
        key: template.key,
        name: template.name,
        description: template.description ?? '',
        state: normalizeTemplateState(template.state),
        workflow_ref: (template as any).workflowRef ?? '',
        template_json: JSON.stringify(builderReadyTemplateJson, null, 2)
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
    if (normalizeTemplateState(template.state) === 'inactive') {
      return sendUiError(request, reply, 400, 'Inactive templates are read-only.');
    }
    const assignmentView = await loadTemplateAssignmentView(db, template.id);
    const macroUsageView = await loadTemplateMacroUsageView(db, template.id);
    const apiUsageView = await loadTemplateApiUsageView(db, template);
    const actionUsage = safeCollectTemplateActionUsage(template.templateJson);

    const form = toFormRecord(request.body);
    const parsed = templateFormSchema.safeParse({
      key: getFormString(form, 'key'),
      name: getFormString(form, 'name'),
      description: getFormString(form, 'description'),
      state: normalizeTemplateState(getFormString(form, 'state')),
      workflow_ref: getFormString(form, 'workflow_ref'),
      template_json: getFormString(form, 'template_json')
    });

    if (!parsed.success) {
      return reply.status(400).renderPage('templates/edit.ejs', {
        template,
        builderEnabled: true,
        errorMessage: 'Please provide key, name, state and template_json.',
        warnings: [],
        builderPreviewHtml: buildTemplateBuilderPreviewHtmlFromText(getFormString(form, 'template_json')),
        assignedGroups: assignmentView.assignedGroups,
        assignableGroups: assignmentView.assignableGroups,
        hasGroups: assignmentView.hasGroups,
        usedMacros: macroUsageView.usedMacros,
        missingMacroRefs: macroUsageView.missingMacroRefs,
        usedApis: apiUsageView.usedApis,
        missingApiRefs: apiUsageView.missingApiRefs,
        usedActions: actionUsage,
        workflows: await loadWorkflowOptions(db),
        form: {
          key: getFormString(form, 'key'),
          name: getFormString(form, 'name'),
          description: getFormString(form, 'description'),
          state: normalizeTemplateState(getFormString(form, 'state')),
          workflow_ref: getFormString(form, 'workflow_ref'),
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
        builderEnabled: true,
        errorMessage: error instanceof Error ? error.message : 'Invalid template_json',
        warnings: parsed.success ? collectTemplateWarnings(JSON.parse(parsed.data.template_json)) : [],
        builderPreviewHtml: buildTemplateBuilderPreviewHtmlFromText(parsed.data.template_json),
        assignedGroups: assignmentView.assignedGroups,
        assignableGroups: assignmentView.assignableGroups,
        hasGroups: assignmentView.hasGroups,
        usedMacros: macroUsageView.usedMacros,
        missingMacroRefs: macroUsageView.missingMacroRefs,
        usedApis: apiUsageView.usedApis,
        missingApiRefs: apiUsageView.missingApiRefs,
        usedActions: actionUsage,
        workflows: await loadWorkflowOptions(db),
        form: parsed.data
      });
    }

    const normalizedTemplateJson = normalizeTemplateJsonForV1Storage(templateJson);
    await db
      .update(fpTemplates)
      .set({
        key: parsed.data.key,
        name: parsed.data.name,
        description: parsed.data.description || null,
        state: parsed.data.state,
        workflowRef: parsed.data.workflow_ref?.trim() || null,
        publishedAt: resolvePublishedAtForStateChange(parsed.data.state, (template as any).publishedAt ?? null),
        templateJson: normalizedTemplateJson
      })
      .where(eq(fpTemplates.id, template.id));
    await syncTemplateMacroRefs(db, template.id, normalizedTemplateJson, request.log);
    const warnings = collectTemplateWarnings(templateJson);
    if (warnings.length > 0) {
      request.log.warn({ templateId: template.id, warnings }, 'Template saved with legacy compatibility warnings');
    }
    const syncedApiRefs = collectApiRefsFromTemplateJson(normalizedTemplateJson);
    request.log.info(
      {
        templateId: template.id,
        apiRefs: syncedApiRefs,
        count: syncedApiRefs.length
      },
      'Template API refs synchronized (derived from template_json)'
    );

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
      .set({ state: 'inactive', publishedAt: null })
      .where(and(eq(fpTemplates.key, template.key), sql`lower(${fpTemplates.state}) in ('published', 'active')`));

    await db
      .update(fpTemplates)
      .set({ state: 'published', publishedAt: new Date() })
      .where(eq(fpTemplates.id, template.id));

    reply.code(303);
    return reply.redirect('/templates');
  });

  app.post('/templates/:id/archive', async (request, reply) => {
    const paramsParsed = templateIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ message: 'Invalid template id' });
    }

    const template = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, paramsParsed.data.id) });
    if (!template) {
      return reply.status(404).send({ message: 'Template not found' });
    }

    const currentState = normalizeTemplateState(template.state);
    if (currentState === 'inactive') {
      reply.code(303);
      return reply.redirect(`/templates/${template.id}/edit`);
    }

    await db
      .update(fpTemplates)
      .set({ state: 'inactive', publishedAt: null })
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
    if (normalizeTemplateState(template.state) === 'inactive') {
      return sendUiError(request, reply, 400, 'Inactive templates are read-only.');
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
    if (normalizeTemplateState(template.state) === 'inactive') {
      return sendUiError(request, reply, 400, 'Inactive templates are read-only.');
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
        .where(and(eq(fpTemplates.key, templateKey), sql`lower(${fpTemplates.state}) in ('published', 'active')`))
        .orderBy(desc(fpTemplates.version))
        .limit(1);
      templateId = publishedByKey[0]?.id ?? '';
    }
    if (!templateId) {
      const templates = await db.query.fpTemplates.findMany({
        where: sql`lower(${fpTemplates.state}) in ('published', 'active')`,
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
            .where(and(eq(fpTemplates.key, template.key), sql`lower(${fpTemplates.state}) in ('published', 'active')`))
            .orderBy(desc(fpTemplates.version))
        : [];
    const latestPublishedId = latestPublished[0]?.id ?? template.id;
    if (latestPublishedId !== template.id) {
      reply.code(303);
      return reply.redirect(`/documents/new?templateId=${latestPublishedId}`);
    }

    const templateJson = parseTemplateJson(template.templateJson);
    const workflowRuntime = await loadWorkflowRuntimeForTemplate(db, template as any);
    const assignmentContext = await resolveTemplateAssignmentContext(db, template.id);
    const initialStatus = normalizeDocumentStatus(workflowRuntime.initialStatus);
    const editableKeys = resolveEditableFieldKeys(templateJson, initialStatus, workflowRuntime);
    const readonlyKeys = resolveReadonlyFieldKeys(templateJson, initialStatus, workflowRuntime);
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
    const rawStatusFilter = normalizeOptionalFilter(getFormString(query, 'status')).toLowerCase();
    const statusFilter = (DOCUMENT_STATES as readonly string[]).includes(rawStatusFilter)
      ? (rawStatusFilter as (typeof DOCUMENT_STATES)[number])
      : '';
    const templateIdFilterRaw = normalizeOptionalFilter(getFormString(query, 'templateId'));
    const groupIdFilterRaw = normalizeOptionalFilter(getFormString(query, 'groupId'));
    const showArchived = ['1', 'true', 'on', 'yes'].includes(normalizeOptionalFilter(getFormString(query, 'showArchived')).toLowerCase());
    const effectiveShowArchived = showArchived || statusFilter === 'archived';
    const templateIdFilter = z.string().uuid().safeParse(templateIdFilterRaw).success ? templateIdFilterRaw : '';
    const groupIdFilter = z.string().uuid().safeParse(groupIdFilterRaw).success ? groupIdFilterRaw : '';

    const whereConditions: any[] = [];
    if (!effectiveShowArchived) whereConditions.push(sql`lower(${fpDocuments.status}) <> 'archived'`);
    if (statusFilter) whereConditions.push(sql`lower(${fpDocuments.status}) = ${statusFilter}`);
    if (templateIdFilter) whereConditions.push(eq(fpDocuments.templateId, templateIdFilter));
    if (groupIdFilter) whereConditions.push(eq(fpDocuments.groupId, groupIdFilter));

    const items = await db
      .select({
        id: fpDocuments.id,
        createdAt: fpDocuments.createdAt,
        status: fpDocuments.status,
        templateVersion: fpDocuments.templateVersion,
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
      .where(sql`lower(${fpTemplates.state}) in ('published', 'active')`)
      .orderBy(asc(fpTemplates.name));
    const groups = await db
      .select({ id: fpGroups.id, name: fpGroups.name, key: fpGroups.key })
      .from(fpGroups)
      .orderBy(asc(fpGroups.name));
    const statusOptions = [...DOCUMENT_STATES];

    await reply.renderPage('documents/index.ejs', {
      documents,
      filters: {
        status: statusFilter,
        templateId: templateIdFilter,
        groupId: groupIdFilter,
        showArchived: effectiveShowArchived
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

    const showDone = ['1', 'true', 'on', 'yes'].includes(
      normalizeOptionalFilter(getFormString(toFormRecord(request.query), 'showDone')).toLowerCase()
    );
    let taskRows: Array<{
      id: string;
      createdAt: Date;
      status: string;
      groupId: string | null;
      groupName: string | null;
      templateKey: string;
      templateName: string;
      role: 'Editor' | 'Approver';
      taskState: 'open' | 'waiting' | 'done';
    }> = [];

    if (supportsMultiAssignments) {
      const editorTasksRaw = await db
        .select({
          id: fpDocuments.id,
          createdAt: fpDocuments.createdAt,
          status: fpDocuments.status,
          groupId: fpDocuments.groupId,
          groupName: fpGroups.name,
          templateKey: fpTemplates.key,
          templateName: fpTemplates.name,
          submissionStatus: fpDocumentSubmissions.status
        })
        .from(fpDocumentSubmissions)
        .innerJoin(fpDocuments, eq(fpDocuments.id, fpDocumentSubmissions.documentId))
        .innerJoin(fpTemplates, eq(fpTemplates.id, fpDocuments.templateId))
        .leftJoin(fpGroups, eq(fpGroups.id, fpDocuments.groupId))
        .where(eq(fpDocumentSubmissions.userId, currentUser.id))
        .orderBy(desc(fpDocuments.createdAt));
      const approverTasksRaw = await db
        .select({
          id: fpDocuments.id,
          createdAt: fpDocuments.createdAt,
          status: fpDocuments.status,
          groupId: fpDocuments.groupId,
          groupName: fpGroups.name,
          templateKey: fpTemplates.key,
          templateName: fpTemplates.name,
          approvalStatus: fpDocumentApprovals.status
        })
        .from(fpDocumentApprovals)
        .innerJoin(fpDocuments, eq(fpDocuments.id, fpDocumentApprovals.documentId))
        .innerJoin(fpTemplates, eq(fpTemplates.id, fpDocuments.templateId))
        .leftJoin(fpGroups, eq(fpGroups.id, fpDocuments.groupId))
        .where(eq(fpDocumentApprovals.userId, currentUser.id))
        .orderBy(desc(fpDocuments.createdAt));

      const rows = [
        ...editorTasksRaw.map((item) => ({ ...item, role: 'Editor' as const, approvalStatus: 'pending' })),
        ...approverTasksRaw.map((item) => ({ ...item, role: 'Approver' as const }))
      ];
      const dedupe = new Set<string>();
      taskRows = rows
        .map((item) => {
          const key = `${item.id}:${item.role}`;
          if (dedupe.has(key)) return null;
          dedupe.add(key);
          const userGroupRights = item.groupId ? rightsByGroupId.get(item.groupId) ?? '' : '';
          let taskState = resolveTaskStateForUser({
            role: item.role,
            status: item.status,
            rights: userGroupRights
          });
          if (item.role === 'Editor' && (item as any).submissionStatus === 'submitted') {
            taskState = 'done';
          }
          if (item.role === 'Approver' && item.approvalStatus === 'approved') {
            taskState = 'done';
          }
          return {
            id: item.id,
            createdAt: item.createdAt,
            status: item.status,
            groupId: item.groupId,
            groupName: item.groupName,
            templateKey: item.templateKey,
            templateName: item.templateName,
            role: item.role,
            taskState
          };
        })
        .filter((item): item is NonNullable<typeof item> => !!item)
        .filter((item) => (showDone ? true : item.taskState !== 'done'))
        .filter((item) => (showDone ? true : !isArchivedDocumentStatus(item.status)))
        .sort((a, b) => {
          const stateRank: Record<'open' | 'waiting' | 'done', number> = {
            open: 0,
            waiting: 1,
            done: 2
          };
          return stateRank[a.taskState] - stateRank[b.taskState];
        });
    } else {
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

      taskRows = rawTaskRows
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
          return {
            id: item.id,
            createdAt: item.createdAt,
            status: item.status,
            groupId: item.groupId,
            groupName: item.groupName,
            templateKey: item.templateKey,
            templateName: item.templateName,
            role,
            taskState
          };
        })
        .filter((item): item is NonNullable<typeof item> => !!item)
        .filter((item) => (showDone ? true : !isDoneDocumentStatus(item.status)))
        .sort((a, b) => {
          const stateRank: Record<'open' | 'waiting' | 'done', number> = {
            open: 0,
            waiting: 1,
            done: 2
          };
          return stateRank[a.taskState] - stateRank[b.taskState];
        });
    }

    await reply.renderPage('workspaces/me.ejs', {
      memberships,
      tasks: taskRows,
      tasksUnavailableMessage: '',
      showDone
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
              workflowRef: fpTemplates.workflowRef,
              version: fpTemplates.version,
              templateJson: fpTemplates.templateJson,
              publishedAt: fpTemplates.publishedAt
            })
            .from(fpTemplates)
            .where(and(eq(fpTemplates.key, selectedTemplate.key), sql`lower(${fpTemplates.state}) in ('published', 'active')`))
            .orderBy(desc(fpTemplates.version))
        : [];
    const template = latestPublishedRows[0] ?? selectedTemplate;

    const templateJson = parseTemplateJson(template.templateJson);
    const workflowRuntime = await loadWorkflowRuntimeForTemplate(db, template as any);
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
          const source = await resolveLookupSource(field, { db });
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

    const baseCreateData = sanitizeStatusSourceOfTruthData(data);
    const splitCreate = hasDocumentActorColumns
      ? splitDocumentActorColumns(baseCreateData)
      : { dataJson: baseCreateData, editorUserId: undefined, approverUserId: undefined };

    const inserted = await db
      .insert(fpDocuments)
      .values({
        templateId: template.id,
        ...(hasDocumentTemplateVersion ? { templateVersion: template.version ?? 1 } : {}),
        status: normalizeDocumentStatus(workflowRuntime.initialStatus),
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
        integrationContextJson: {},
        snapshotsJson: snapshots
      })
      .returning({ id: fpDocuments.id });

    if (hasDocumentAuditTrail) {
      await recordDocumentAuditEvent({
        db,
        request,
        documentId: inserted[0].id,
        eventType: 'created',
        summary: `Document created from template ${template.name ?? template.key ?? template.id}.`,
        detail: {
          templateId: template.id,
          templateKey: template.key ?? null,
          templateVersion: template.version ?? 1,
          workflowRef: (template as any).workflowRef ?? null,
          status: normalizeDocumentStatus(workflowRuntime.initialStatus)
        },
        auditGateway
      });
    }

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
    const workflowRuntime = await loadWorkflowRuntimeForTemplate(db, template as any);
    const groupName = await resolveGroupName(db, document.groupId ?? assignmentGroupId ?? null);
    const query = toFormRecord(request.query);
    const errorFromQuery = normalizeOptionalFilter(getFormString(query, 'error'));
    const successFromQuery = normalizeOptionalFilter(getFormString(query, 'message'));

    await renderDocumentDetailPage({
      db,
      hasDocumentActorColumns,
      hasDocumentMultiAssignments: supportsMultiAssignments,
      hasDocumentAttachments,
      hasDocumentAuditTrail,
      reply,
      template,
      document,
      assignmentGroupId,
      groupName,
      workflowRuntime,
      assignmentsOpen: ['1', 'true', 'on', 'yes'].includes(
        normalizeOptionalFilter(getFormString(query, 'assignments')).toLowerCase()
      ),
      ...(errorFromQuery ? { errorMessage: errorFromQuery } : {}),
      ...(successFromQuery ? { successMessage: successFromQuery } : {})
    });
  });

  app.post('/documents/:id/attachments', async (request, reply) => {
    if (!hasDocumentAttachments || !attachmentStorage) {
      return sendUiError(request, reply, 503, 'Attachments unavailable until DB/storage support is configured.');
    }

    const paramsParsed = documentIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return sendUiError(request, reply, 400, 'Invalid document id');
    }

    const parsedBody = documentAttachmentUploadSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return sendUiError(request, reply, 400, 'Invalid attachment upload payload.');
    }

    const document = await loadDocumentById(db, paramsParsed.data.id, hasDocumentActorColumns, hasDocumentTemplateVersion);
    if (!document) {
      return sendUiError(request, reply, 404, 'Document not found');
    }
    if (isArchivedDocumentStatus(document.status)) {
      return sendUiError(request, reply, 400, 'Archived documents are read-only.');
    }

    const rbacGroupId = await resolveDocumentRbacGroupId(db, document);
    if (rbacGroupId) {
      const currentUser = request.currentUser as CurrentUser | null;
      if (!currentUser) {
        return sendUiError(request, reply, 403, 'No active user. Go to /admin or use the user dropdown.');
      }
      const members = await db.query.fpGroupMembers.findMany({ where: eq(fpGroupMembers.groupId, rbacGroupId) });
      const permission = evaluateGroupPermission({
        memberships: members,
        userId: currentUser.id,
        requires: ['write']
      });
      if (!permission.allowed) {
        return sendUiError(request, reply, 403, permission.errorMessage);
      }
    }

    const bytes = decodeAttachmentPayload(parsedBody.data.base64Data);
    if (bytes.length === 0) {
      return sendUiError(request, reply, 400, 'Attachment payload is empty.');
    }
    if (bytes.length > 10 * 1024 * 1024) {
      return sendUiError(request, reply, 400, 'Attachments are limited to 10 MB in V1.');
    }

    const attachmentId = randomUUID();
    const filename = sanitizeAttachmentFilename(parsedBody.data.filename);
    const mimeType = parsedBody.data.contentType.trim().toLowerCase();
    const kind = resolveAttachmentKind(mimeType, parsedBody.data.kind);
    const storageResult = await attachmentStorage.save({
      tenantKey: request.tenantContext?.tenantKey ?? 'default',
      documentId: document.id,
      attachmentId,
      filename,
      contentType: mimeType,
      bytes
    });

    await db.insert(fpDocumentAttachments).values({
      id: attachmentId,
      documentId: document.id,
      kind,
      filename,
      mimeType,
      size: bytes.length,
      storageKey: storageResult.attachmentKey,
      uploadedBy: request.currentUser?.id ?? null
    });

    if (hasDocumentAuditTrail) {
      await recordDocumentAuditEvent({
        db,
        request,
        documentId: document.id,
        eventType: 'attachment_uploaded',
        summary: `Uploaded attachment ${filename}.`,
        detail: {
          attachmentId,
          filename,
          mimeType,
          size: bytes.length,
          kind
        },
        auditGateway
      });
    }

    return {
      ok: true,
      attachmentId,
      filename,
      kind,
      size: bytes.length,
      contentUrl: `/attachments/${encodeURIComponent(attachmentId)}/content`
    };
  });

  app.get('/attachments/:id/content', async (request, reply) => {
    if (!hasDocumentAttachments || !attachmentStorage) {
      return reply.status(503).send({ message: 'Attachments unavailable until DB/storage support is configured.' });
    }

    const parsed = attachmentIdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid attachment id' });
    }

    const attachment = await loadAttachmentById(db, parsed.data.id);
    if (!attachment) {
      return reply.status(404).send({ message: 'Attachment not found' });
    }
    const document = await loadDocumentById(db, attachment.documentId, hasDocumentActorColumns, hasDocumentTemplateVersion);
    if (!document) {
      return reply.status(404).send({ message: 'Document not found' });
    }

    const rbacGroupId = await resolveDocumentRbacGroupId(db, document);
    if (rbacGroupId) {
      const currentUser = request.currentUser as CurrentUser | null;
      if (!currentUser) {
        return reply.status(403).send({ message: 'No active user. Go to /admin or use the user dropdown.' });
      }
      const members = await db.query.fpGroupMembers.findMany({ where: eq(fpGroupMembers.groupId, rbacGroupId) });
      const permission = evaluateGroupPermission({
        memberships: members,
        userId: currentUser.id,
        requires: ['read']
      });
      if (!permission.allowed) {
        return reply.status(403).send({ message: permission.errorMessage });
      }
    }

    const bytes = await attachmentStorage.read({
      tenantKey: request.tenantContext?.tenantKey ?? 'default',
      attachmentKey: attachment.storageKey
    });
    if (!bytes) {
      return reply.status(404).send({ message: 'Attachment content not found' });
    }

    const query = toFormRecord(request.query);
    const download = ['1', 'true', 'yes', 'on'].includes(normalizeOptionalFilter(getFormString(query, 'download')).toLowerCase());
    reply.header('content-type', attachment.mimeType || 'application/octet-stream');
    reply.header(
      'content-disposition',
      `${download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(attachment.filename)}"`
    );
    return reply.send(Buffer.from(bytes));
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
    if (isArchivedDocumentStatus(document.status)) {
      return sendUiError(request, reply, 400, 'Archived documents are read-only.');
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
      const permission = evaluateGroupPermission({
        memberships: groupMembers,
        userId: currentUser.id,
        requires: ['write']
      });
      if (!permission.allowed) {
        return sendUiError(request, reply, 403, permission.errorMessage);
      }
    }

    const template = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, document.templateId) });
    if (!template) {
      return reply.status(404).send({ message: 'Template not found' });
    }

    const templateJson = parseTemplateJson(template.templateJson);
    const workflowRuntime = await loadWorkflowRuntimeForTemplate(db, template as any);
    const form = toFormRecord(request.body);
    const editableKeys = resolveEditableFieldKeys(templateJson, document.status, workflowRuntime);
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

    if (hasDocumentAuditTrail) {
      const previousData = ((document.dataJson ?? {}) as Record<string, unknown>) ?? {};
      const nextData = splitSave.dataJson ?? {};
      const changes = summarizeDocumentFieldChanges({
        previousData,
        nextData,
        templateJson
      });

      if (changes.changedFields.length > 0) {
        await recordDocumentAuditEvent({
          db,
          request,
          documentId: document.id,
          eventType: 'form_updated',
          summary: `Updated ${changes.changedFields.length} form field${changes.changedFields.length === 1 ? '' : 's'}.`,
          detail: { fieldKeys: changes.changedFields },
          auditGateway
        });
      }

      for (const item of changes.journalChanges) {
        if (item.added > 0) {
          await recordDocumentAuditEvent({
            db,
            request,
            documentId: document.id,
            eventType: 'journal_row_added',
            summary: `Added ${item.added} journal row${item.added === 1 ? '' : 's'} in ${item.fieldKey}.`,
            detail: { fieldKey: item.fieldKey, count: item.added },
            auditGateway
          });
        }
        if (item.updated > 0) {
          await recordDocumentAuditEvent({
            db,
            request,
            documentId: document.id,
            eventType: 'journal_row_updated',
            summary: `Updated ${item.updated} journal row${item.updated === 1 ? '' : 's'} in ${item.fieldKey}.`,
            detail: { fieldKey: item.fieldKey, count: item.updated },
            auditGateway
          });
        }
        if (item.removed > 0) {
          await recordDocumentAuditEvent({
            db,
            request,
            documentId: document.id,
            eventType: 'journal_row_removed',
            summary: `Removed ${item.removed} journal row${item.removed === 1 ? '' : 's'} from ${item.fieldKey}.`,
            detail: { fieldKey: item.fieldKey, count: item.removed },
            auditGateway
          });
        }
      }
    }

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
    if (isArchivedDocumentStatus(document.status)) {
      return sendUiError(request, reply, 400, 'Archived documents are read-only.');
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
    const actorPermission = evaluateGroupPermission({
      memberships: groupMembers,
      userId: currentUser.id,
      requires: ['execute']
    });
    if (!actorPermission.allowed) {
      return sendUiError(request, reply, 403, actorPermission.errorMessage);
    }
    const targetAssignment = evaluateAssignmentTarget({
      membership: findGroupMembership(groupMembers, bodyParsed.data.userId),
      role: 'editor'
    });
    if (!targetAssignment.allowed) {
      return sendUiError(request, reply, 400, targetAssignment.errorMessage);
    }

    if (supportsMultiAssignments) {
      await db
        .insert(fpDocumentEditors)
        .values({ documentId: document.id, userId: bodyParsed.data.userId })
        .onConflictDoNothing();
      await db
        .insert(fpDocumentSubmissions)
        .values({ documentId: document.id, userId: bodyParsed.data.userId, status: 'pending' })
        .onConflictDoNothing();
      await db
        .update(fpDocuments)
        .set({ editorUserId: bodyParsed.data.userId, assigneeUserId: bodyParsed.data.userId })
        .where(eq(fpDocuments.id, document.id));
    } else {
      await db
        .update(fpDocuments)
        .set({ editorUserId: bodyParsed.data.userId, assigneeUserId: bodyParsed.data.userId })
        .where(eq(fpDocuments.id, document.id));
    }

    if (hasDocumentAuditTrail) {
      const targetDisplay = await resolveAuditUserDisplay(db, bodyParsed.data.userId);
      await recordDocumentAuditEvent({
        db,
        request,
        documentId: document.id,
        eventType: 'assigned_editor',
        summary: `Assigned editor ${targetDisplay ?? bodyParsed.data.userId}.`,
        detail: { userId: bodyParsed.data.userId, userDisplay: targetDisplay },
        auditGateway
      });
    }
    await publishDocumentNotification({
      db,
      request,
      notificationGateway,
      appBaseUrl,
      documentId: document.id,
      type: 'editor_assigned',
      subject: `Assigned as editor: ${document.id.slice(0, 8)}`,
      body: `You were assigned as editor for document ${document.id.slice(0, 8)}.`,
      recipientUserIds: [bodyParsed.data.userId],
      meta: {
        role: 'editor',
        assignedBy: request.currentUser?.id ?? null
      }
    });

    reply.code(303);
    return reply.redirect(`/documents/${document.id}?assignments=1`);
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
    if (isArchivedDocumentStatus(document.status)) {
      return sendUiError(request, reply, 400, 'Archived documents are read-only.');
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
    const actorPermission = evaluateGroupPermission({
      memberships: groupMembers,
      userId: currentUser.id,
      requires: ['execute']
    });
    if (!actorPermission.allowed) {
      return sendUiError(request, reply, 403, actorPermission.errorMessage);
    }
    const targetAssignment = evaluateAssignmentTarget({
      membership: findGroupMembership(groupMembers, bodyParsed.data.userId),
      role: 'approver'
    });
    if (!targetAssignment.allowed) {
      return sendUiError(request, reply, 400, targetAssignment.errorMessage);
    }

    if (supportsMultiAssignments) {
      await db
        .insert(fpDocumentApprovals)
        .values({ documentId: document.id, userId: bodyParsed.data.userId, status: 'pending' })
        .onConflictDoNothing();
      await db
        .update(fpDocuments)
        .set({ approverUserId: bodyParsed.data.userId, reviewerUserId: bodyParsed.data.userId })
        .where(eq(fpDocuments.id, document.id));
    } else {
      await db
        .update(fpDocuments)
        .set({ approverUserId: bodyParsed.data.userId, reviewerUserId: bodyParsed.data.userId })
        .where(eq(fpDocuments.id, document.id));
    }

    if (hasDocumentAuditTrail) {
      const targetDisplay = await resolveAuditUserDisplay(db, bodyParsed.data.userId);
      await recordDocumentAuditEvent({
        db,
        request,
        documentId: document.id,
        eventType: 'assigned_approver',
        summary: `Assigned approver ${targetDisplay ?? bodyParsed.data.userId}.`,
        detail: { userId: bodyParsed.data.userId, userDisplay: targetDisplay },
        auditGateway
      });
    }
    await publishDocumentNotification({
      db,
      request,
      notificationGateway,
      appBaseUrl,
      documentId: document.id,
      type: 'approver_assigned',
      subject: `Assigned as approver: ${document.id.slice(0, 8)}`,
      body: `You were assigned as approver for document ${document.id.slice(0, 8)}.`,
      recipientUserIds: [bodyParsed.data.userId],
      meta: {
        role: 'approver',
        assignedBy: request.currentUser?.id ?? null
      }
    });

    reply.code(303);
    return reply.redirect(`/documents/${document.id}?assignments=1`);
  };

  app.post('/documents/:id/assign/editor', setDocumentEditorAssignment);
  app.post('/documents/:id/assign/approver', setDocumentApproverAssignment);
  app.post('/documents/:id/assign/editor/remove', async (request, reply) => {
    const paramsParsed = documentIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return sendUiError(request, reply, 400, 'Invalid document id');
    }
    const form = toFormRecord(request.body);
    const userId = getFormString(form, 'userId');
    if (!z.string().uuid().safeParse(userId).success) {
      return sendUiError(request, reply, 400, 'Invalid userId');
    }
    const document = await loadDocumentById(db, paramsParsed.data.id, hasDocumentActorColumns, hasDocumentTemplateVersion);
    if (!document) return sendUiError(request, reply, 404, 'Document not found');
    if (!supportsMultiAssignments) {
      await db
        .update(fpDocuments)
        .set({
          editorUserId: document.editorUserId === userId ? null : document.editorUserId,
          assigneeUserId: document.editorUserId === userId ? null : document.editorUserId
        })
        .where(eq(fpDocuments.id, document.id));
      if (hasDocumentAuditTrail && document.editorUserId === userId) {
        const targetDisplay = await resolveAuditUserDisplay(db, userId);
        await recordDocumentAuditEvent({
          db,
          request,
          documentId: document.id,
          eventType: 'unassigned_editor',
          summary: `Removed editor ${targetDisplay ?? userId}.`,
          detail: { userId, userDisplay: targetDisplay },
          auditGateway
        });
      }
      reply.code(303);
      return reply.redirect(`/documents/${document.id}?assignments=1`);
    }
    await db
      .delete(fpDocumentEditors)
      .where(and(eq(fpDocumentEditors.documentId, document.id), eq(fpDocumentEditors.userId, userId)));
    await db
      .delete(fpDocumentSubmissions)
      .where(and(eq(fpDocumentSubmissions.documentId, document.id), eq(fpDocumentSubmissions.userId, userId)));
    const remainingEditors = await db.query.fpDocumentEditors.findMany({
      where: eq(fpDocumentEditors.documentId, document.id)
    });
    const fallbackEditor = remainingEditors[0]?.userId ?? null;
    await db
      .update(fpDocuments)
      .set({ editorUserId: fallbackEditor, assigneeUserId: fallbackEditor })
      .where(eq(fpDocuments.id, document.id));
    if (hasDocumentAuditTrail) {
      const targetDisplay = await resolveAuditUserDisplay(db, userId);
      await recordDocumentAuditEvent({
        db,
        request,
        documentId: document.id,
        eventType: 'unassigned_editor',
        summary: `Removed editor ${targetDisplay ?? userId}.`,
        detail: { userId, userDisplay: targetDisplay },
        auditGateway
      });
    }
    reply.code(303);
    return reply.redirect(`/documents/${document.id}?assignments=1`);
  });
  app.post('/documents/:id/assign/approver/remove', async (request, reply) => {
    const paramsParsed = documentIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return sendUiError(request, reply, 400, 'Invalid document id');
    }
    const form = toFormRecord(request.body);
    const userId = getFormString(form, 'userId');
    if (!z.string().uuid().safeParse(userId).success) {
      return sendUiError(request, reply, 400, 'Invalid userId');
    }
    const document = await loadDocumentById(db, paramsParsed.data.id, hasDocumentActorColumns, hasDocumentTemplateVersion);
    if (!document) return sendUiError(request, reply, 404, 'Document not found');
    if (!supportsMultiAssignments) {
      await db
        .update(fpDocuments)
        .set({
          approverUserId: document.approverUserId === userId ? null : document.approverUserId,
          reviewerUserId: document.approverUserId === userId ? null : document.approverUserId
        })
        .where(eq(fpDocuments.id, document.id));
      if (hasDocumentAuditTrail && document.approverUserId === userId) {
        const targetDisplay = await resolveAuditUserDisplay(db, userId);
        await recordDocumentAuditEvent({
          db,
          request,
          documentId: document.id,
          eventType: 'unassigned_approver',
          summary: `Removed approver ${targetDisplay ?? userId}.`,
          detail: { userId, userDisplay: targetDisplay },
          auditGateway
        });
      }
      reply.code(303);
      return reply.redirect(`/documents/${document.id}?assignments=1`);
    }
    await db
      .delete(fpDocumentApprovals)
      .where(and(eq(fpDocumentApprovals.documentId, document.id), eq(fpDocumentApprovals.userId, userId)));
    const remainingApprovers = await db.query.fpDocumentApprovals.findMany({
      where: eq(fpDocumentApprovals.documentId, document.id)
    });
    const fallbackApprover = remainingApprovers[0]?.userId ?? null;
    await db
      .update(fpDocuments)
      .set({ approverUserId: fallbackApprover, reviewerUserId: fallbackApprover })
      .where(eq(fpDocuments.id, document.id));
    if (hasDocumentAuditTrail) {
      const targetDisplay = await resolveAuditUserDisplay(db, userId);
      await recordDocumentAuditEvent({
        db,
        request,
        documentId: document.id,
        eventType: 'unassigned_approver',
        summary: `Removed approver ${targetDisplay ?? userId}.`,
        detail: { userId, userDisplay: targetDisplay },
        auditGateway
      });
    }
    reply.code(303);
    return reply.redirect(`/documents/${document.id}?assignments=1`);
  });
  // Backward compatibility.
  app.post('/documents/:id/assignments/editor', setDocumentEditorAssignment);
  app.post('/documents/:id/assignments/approver', setDocumentApproverAssignment);

  app.post('/documents/:id/archive', async (request, reply) => {
    const paramsParsed = documentIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return sendUiError(request, reply, 400, 'Invalid document id');
    }

    const document = await loadDocumentById(db, paramsParsed.data.id, hasDocumentActorColumns, hasDocumentTemplateVersion);
    if (!document) {
      return sendUiError(request, reply, 404, 'Document not found');
    }

    if (isArchivedDocumentStatus(document.status)) {
      reply.code(303);
      return reply.redirect(`/documents/${document.id}`);
    }

    const rbacGroupId = await resolveDocumentRbacGroupId(db, document);
    if (rbacGroupId) {
      const currentUser = request.currentUser as CurrentUser | null;
      if (!currentUser) {
        return sendUiError(request, reply, 403, 'No active user. Go to /admin or use the user dropdown.');
      }
      const members = await db.query.fpGroupMembers.findMany({ where: eq(fpGroupMembers.groupId, rbacGroupId) });
      const permission = evaluateGroupPermission({
        memberships: members,
        userId: currentUser.id,
        requires: ['execute']
      });
      if (!permission.allowed) {
        return sendUiError(request, reply, 403, permission.errorMessage);
      }
    }

    await db.update(fpDocuments).set({ status: 'archived' }).where(eq(fpDocuments.id, document.id));

    if (hasDocumentAuditTrail) {
      await recordDocumentAuditEvent({
        db,
        request,
        documentId: document.id,
        eventType: 'status_changed',
        summary: 'Document archived.',
        detail: { fromStatus: normalizeDocumentStatus(document.status), toStatus: 'archived' },
        auditGateway
      });
    }

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

    const document = await loadDocumentById(db, paramsParsed.data.id, hasDocumentActorColumns, hasDocumentTemplateVersion);
    if (!document) {
      return reply.status(404).send({ message: 'Document not found' });
    }

    const template = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.id, document.templateId) });
    if (!template) {
      return reply.status(404).send({ message: 'Template not found' });
    }
    const normalizedDocumentStatus = normalizeDocumentStatus(document.status);
    const templateJson = parseTemplateJson(template.templateJson);
    const workflowRuntime = await loadWorkflowRuntimeForTemplate(db, template as any);
    const redirectWithActionError = (message: string) => {
      const next = new URL(`/documents/${document.id}`, 'http://localhost');
      next.searchParams.set('error', message.slice(0, 500));
      reply.code(303);
      return reply.redirect(`${next.pathname}${next.search}`);
    };
    if (isArchivedDocumentStatus(normalizedDocumentStatus)) {
      return redirectWithActionError('Archived documents are read-only.');
    }
    const redirectWithActionMessage = (message: string) => {
      const next = new URL(`/documents/${document.id}`, 'http://localhost');
      next.searchParams.set('message', message.slice(0, 500));
      reply.code(303);
      return reply.redirect(`${next.pathname}${next.search}`);
    };
    const assignmentGroupId = await resolveDocumentRbacGroupId(db, document);
    const groupName = await resolveGroupName(db, document.groupId ?? assignmentGroupId ?? null);
    const query = toFormRecord(request.query);
    const source = getFormString(query, 'source');
    const layoutButtonKinds = collectLayoutButtonKinds(templateJson);
    const layoutButtonKind = layoutButtonKinds.get(paramsParsed.data.controlKey);
    const isLayoutButtonAction = !!layoutButtonKind;
    const invocation = resolveActionInvocation({ source, layoutButtonKind, isLayoutButtonAction });
    if ('error' in invocation && invocation.error) {
      return redirectWithActionError(invocation.error);
    }
    const executionSource = invocation.executionSource;
    const isUiButtonRequest = executionSource === 'ui';
    const currentEditorSubmissions = supportsMultiAssignments ? await loadEditorSubmissionStates(db, document.id) : [];
    const currentApproverDecisions = supportsMultiAssignments ? await loadApproverDecisionStates(db, document.id) : [];
    const workflowEvaluation = evaluateWorkflow({
      workflow: workflowRuntime,
      status: normalizedDocumentStatus,
      editorSubmissions: currentEditorSubmissions,
      approverDecisions: currentApproverDecisions
    });
    const allowedButtons = workflowEvaluation.visibleButtons;

    if (!isUiButtonRequest && !isLayoutButtonAction && !allowedButtons.includes(paramsParsed.data.controlKey)) {
      return redirectWithActionError('Control is not allowed in the current status.');
    }

    const actions = ((templateJson as any).actions ?? {}) as Record<string, unknown>;
    const legacyControls = ((templateJson as any).controls ?? {}) as Record<string, { action?: string }>;
    const controlKey = paramsParsed.data.controlKey;
    const actionKey =
      (actions[controlKey] ? controlKey : undefined) ??
      legacyControls[controlKey]?.action ??
      (isLayoutButtonAction && actions[controlKey] ? controlKey : undefined) ??
      (isStandardProcessAction(controlKey) ? controlKey : undefined);
    if (!actionKey) {
      return redirectWithActionError('Control action is not configured.');
    }
    const implicitProcessAction =
      !isUiButtonRequest && !isLayoutButtonAction && isStandardProcessAction(controlKey)
        ? ({
            type: 'setStatus',
            to: workflowEvaluation.nextStatusByAction[controlKey] ?? normalizedDocumentStatus
          } as const)
        : null;
    const actionDef = actions[actionKey] ?? implicitProcessAction;
    if (!actionDef) {
      return redirectWithActionError(`Action "${actionKey}" is not defined.`);
    }
    const macroRefs = collectMacroRefsFromActionDefinition(actionDef);
    const currentUser = request.currentUser as CurrentUser | null;

    app.log.info({
      docId: document.id,
      actionKey,
      source: executionSource,
      activeUser: currentUser?.username ?? null,
      templateId: document.templateId,
      macroRefs
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
      const permission = evaluateGroupPermission({
        memberships: groupMembers,
        userId: currentUser!.id,
        requires: effectiveRequired
      });

      if (!permission.allowed) {
        return redirectWithActionError(permission.errorMessage);
      }
    }

    const controlName = paramsParsed.data.controlKey.toLowerCase();
    const actionName = actionKey.toLowerCase();
    const isSubmitAction = controlName.includes('submit') || actionName.includes('submit');
    const isRejectAction = controlName.includes('reject') || actionName.includes('reject');
    const isApproveOrRejectAction =
      controlName.includes('approve') ||
      controlName.includes('reject') ||
      actionName.includes('approve') ||
      actionName.includes('reject');

    if (supportsMultiAssignments && currentUser) {
      if (isSubmitAction) {
        const editorRows = await db.query.fpDocumentEditors.findMany({
          where: eq(fpDocumentEditors.documentId, document.id)
        });
        if (editorRows.length === 0) {
          return redirectWithActionError('No assigned editors. Assign at least one editor before submitting.');
        }
        if (editorRows.length > 0 && !editorRows.some((item) => item.userId === currentUser.id)) {
          return redirectWithActionError('Forbidden: submit is limited to assigned editors.');
        }
      }
      if (isApproveOrRejectAction) {
        const approvalRows = await db.query.fpDocumentApprovals.findMany({
          where: eq(fpDocumentApprovals.documentId, document.id)
        });
        if (approvalRows.length === 0) {
          return redirectWithActionError('No assigned approvers. Assign at least one approver before approval.');
        }
        if (approvalRows.length > 0 && !approvalRows.some((item) => item.userId === currentUser.id)) {
          return redirectWithActionError('Forbidden: approve/reject is limited to assigned approvers.');
        }
      }
    } else {
      if (isSubmitAction && !document.editorUserId) {
        return redirectWithActionError('No assigned editor. Set an editor before submitting.');
      }
      if (isSubmitAction && document.editorUserId && currentUser && currentUser.id !== document.editorUserId) {
        return redirectWithActionError('Forbidden: submit is limited to the assigned editor.');
      }
      if (isApproveOrRejectAction && !document.approverUserId) {
        return redirectWithActionError('No assigned approver. Set an approver before approval.');
      }
      if (isApproveOrRejectAction && document.approverUserId && currentUser && currentUser.id !== document.approverUserId) {
        return redirectWithActionError('Forbidden: approve/reject is limited to the assigned approver.');
      }
    }

    const form = toFormRecord(request.body);
    const editableKeys = resolveEditableFieldKeys(templateJson, normalizedDocumentStatus, workflowRuntime);
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

    if (isUiButtonRequest && !isUiSafeActionDefinition(actionDef)) {
      return redirectWithActionError('UI button cannot execute process action');
    }

    const runtimeTemplateContext = buildActionRuntimeTemplateContext(templateJson);
    app.log.info(
      {
        docId: document.id,
        templateId: document.templateId,
        actionKey,
        source: executionSource,
        actionType: resolveActionType(actionDef),
        macroRefs,
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
          doc: { id: document.id, status: normalizedDocumentStatus },
          data: actionDataContext,
          external: ((document.externalRefsJson ?? {}) as Record<string, unknown>) ?? {},
          snapshot: ((document.snapshotsJson ?? {}) as Record<string, unknown>) ?? {},
          integration: ((document.integrationContextJson ?? {}) as Record<string, unknown>) ?? {},
          vars: {}
        },
        erpBaseUrl,
        macroContext: {
          db,
          templateJson,
          templateDefinition: runtimeTemplateContext.templateDefinition,
          schema: runtimeTemplateContext.schema,
          document: { id: document.id, status: normalizedDocumentStatus },
          form
        },
        onMacroEvent: (event) => {
          app.log.info(
            {
              docId: document.id,
              actionKey,
              macroRef: event.macroRef,
              macro: `${event.namespace}/${event.name}@${event.version ?? 'n/a'}`,
              source: event.source ?? 'builtin',
              outcome: event.outcome,
              ...(event.errorMessage ? { error: event.errorMessage } : {})
            },
            'Macro execution'
          );
        }
      });

      let persistedNextStatus = normalizeDocumentStatus(result.status);
      let nextEditorSubmissions = currentEditorSubmissions.map((item) => ({ ...item }));
      let nextApproverDecisions = currentApproverDecisions.map((item) => ({ ...item }));
      let persistedDataJson = sanitizeStatusSourceOfTruthData(result.dataJson);
      let persistedExternalRefsJson = sanitizeStatusSourceOfTruthExternalRefs(result.externalRefsJson);
      let persistedSnapshotsJson = result.snapshotsJson;
      let persistedIntegrationContextJson = ((result.integrationContextJson ?? {}) as Record<string, unknown>) ?? {};
      await db.transaction(async (tx) => {
        const baseActionResultData = sanitizeStatusSourceOfTruthData(result.dataJson);
        const splitActionResult = hasDocumentActorColumns
          ? splitDocumentActorColumns(baseActionResultData)
          : { dataJson: baseActionResultData, editorUserId: undefined, approverUserId: undefined };
        let nextStatus = result.status;
        if (supportsMultiAssignments && isSubmitAction && currentUser) {
          await tx
            .update(fpDocumentSubmissions)
            .set({ status: 'submitted', submittedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(fpDocumentSubmissions.documentId, document.id), eq(fpDocumentSubmissions.userId, currentUser.id)));
          nextEditorSubmissions = nextEditorSubmissions.map((item) =>
            item.userId === currentUser.id ? { ...item, status: 'submitted', submittedAt: new Date() } : item
          );
        }
        if (supportsMultiAssignments && isApproveOrRejectAction && currentUser) {
          const decisionStatus = isRejectAction ? 'rejected' : 'approved';
          const decisionAt = new Date();
          await tx
            .update(fpDocumentApprovals)
            .set({
              status: decisionStatus,
              approvedAt: isRejectAction ? null : decisionAt,
              decidedAt: decisionAt,
              updatedAt: decisionAt
            })
            .where(and(eq(fpDocumentApprovals.documentId, document.id), eq(fpDocumentApprovals.userId, currentUser.id)));
          nextApproverDecisions = nextApproverDecisions.map((item) =>
            item.userId === currentUser.id ? { ...item, status: decisionStatus, decidedAt: decisionAt } : item
          );
        }
        if (supportsMultiAssignments) {
          const derivedEvaluation = evaluateWorkflow({
            workflow: workflowRuntime,
            status: normalizedDocumentStatus,
            editorSubmissions: nextEditorSubmissions,
            approverDecisions: nextApproverDecisions
          });
          if (isSubmitAction) {
            nextStatus = resolveNextStatus({
              workflow: workflowRuntime,
              status: normalizedDocumentStatus,
              editorSubmissions: nextEditorSubmissions,
              approverDecisions: nextApproverDecisions
            }).submit ?? nextStatus;
          }
          if (isApproveOrRejectAction) {
            nextStatus = resolveNextStatus({
              workflow: workflowRuntime,
              status: normalizedDocumentStatus,
              editorSubmissions: nextEditorSubmissions,
              approverDecisions: nextApproverDecisions
            }).approve ?? nextStatus;
            if (isRejectAction) {
              nextStatus = resolveNextStatus({
                workflow: workflowRuntime,
                status: normalizedDocumentStatus,
                editorSubmissions: nextEditorSubmissions,
                approverDecisions: nextApproverDecisions
              }).reject ?? nextStatus;
            }
          }
          if (!isSubmitAction && !isApproveOrRejectAction && derivedEvaluation.nextStatusByAction[actionKey]) {
            nextStatus = derivedEvaluation.nextStatusByAction[actionKey];
          }
        }
        persistedNextStatus = normalizeDocumentStatus(nextStatus);
        persistedDataJson = splitActionResult.dataJson;
        persistedExternalRefsJson = sanitizeStatusSourceOfTruthExternalRefs(result.externalRefsJson);
        persistedSnapshotsJson = result.snapshotsJson;
        await tx
          .update(fpDocuments)
          .set({
            status: nextStatus,
            dataJson: persistedDataJson,
            ...(hasDocumentActorColumns && splitActionResult.editorUserId !== undefined
              ? { editorUserId: splitActionResult.editorUserId, assigneeUserId: splitActionResult.editorUserId }
              : {}),
            ...(hasDocumentActorColumns && splitActionResult.approverUserId !== undefined
              ? { approverUserId: splitActionResult.approverUserId, reviewerUserId: splitActionResult.approverUserId }
              : {}),
            externalRefsJson: persistedExternalRefsJson,
            integrationContextJson: persistedIntegrationContextJson,
            snapshotsJson: persistedSnapshotsJson
          })
          .where(eq(fpDocuments.id, document.id));
      });
      const workflowHookLogs: Array<{
        trigger: 'transition' | 'enterState' | 'workflowAction';
        success: boolean;
        operationRef: string;
        description?: string;
        message?: string;
        error?: string;
      }> = [];
      if (persistedNextStatus !== normalizedDocumentStatus) {
        const hookResult = await executeWorkflowHookEffects({
          workflow: workflowRuntime,
          trigger: {
            type: 'transition',
            fromStatus: normalizedDocumentStatus,
            toStatus: persistedNextStatus
          },
          context: {
            doc: { id: document.id, status: persistedNextStatus },
            data: persistedDataJson,
            external: persistedExternalRefsJson,
            snapshot: persistedSnapshotsJson,
            integration: persistedIntegrationContextJson,
            vars: {}
          },
          erpBaseUrl
        });
        persistedDataJson = sanitizeStatusSourceOfTruthData(hookResult.dataJson);
        persistedExternalRefsJson = sanitizeStatusSourceOfTruthExternalRefs(hookResult.externalRefsJson);
        persistedSnapshotsJson = hookResult.snapshotsJson;
        persistedIntegrationContextJson = hookResult.integrationContextJson;
        workflowHookLogs.push(...hookResult.logs);
        const enterStateHookResult = await executeWorkflowHookEffects({
          workflow: workflowRuntime,
          trigger: {
            type: 'enterState',
            state: persistedNextStatus
          },
          context: {
            doc: { id: document.id, status: persistedNextStatus },
            data: persistedDataJson,
            external: persistedExternalRefsJson,
            snapshot: persistedSnapshotsJson,
            integration: persistedIntegrationContextJson,
            vars: {}
          },
          erpBaseUrl
        });
        persistedDataJson = sanitizeStatusSourceOfTruthData(enterStateHookResult.dataJson);
        persistedExternalRefsJson = sanitizeStatusSourceOfTruthExternalRefs(enterStateHookResult.externalRefsJson);
        persistedSnapshotsJson = enterStateHookResult.snapshotsJson;
        persistedIntegrationContextJson = enterStateHookResult.integrationContextJson;
        workflowHookLogs.push(...enterStateHookResult.logs);
      }
      if (actionKey) {
        const hookResult = await executeWorkflowHookEffects({
          workflow: workflowRuntime,
          trigger: {
            type: 'workflowAction',
            action: actionKey
          },
          context: {
            doc: { id: document.id, status: persistedNextStatus },
            data: persistedDataJson,
            external: persistedExternalRefsJson,
            snapshot: persistedSnapshotsJson,
            integration: persistedIntegrationContextJson,
            vars: {}
          },
          erpBaseUrl
        });
        persistedDataJson = sanitizeStatusSourceOfTruthData(hookResult.dataJson);
        persistedExternalRefsJson = sanitizeStatusSourceOfTruthExternalRefs(hookResult.externalRefsJson);
        persistedSnapshotsJson = hookResult.snapshotsJson;
        persistedIntegrationContextJson = hookResult.integrationContextJson;
        workflowHookLogs.push(...hookResult.logs);
      }
      if (workflowHookLogs.length > 0) {
        await db
          .update(fpDocuments)
          .set({
            dataJson: persistedDataJson,
            externalRefsJson: persistedExternalRefsJson,
            integrationContextJson: persistedIntegrationContextJson,
            snapshotsJson: persistedSnapshotsJson
          })
          .where(eq(fpDocuments.id, document.id));
      }
      if (hasDocumentAuditTrail) {
        if (isSubmitAction) {
          await recordDocumentAuditEvent({
            db,
            request,
            documentId: document.id,
            eventType: 'submitted',
            summary: supportsMultiAssignments
              ? `${currentUser?.displayName ?? currentUser?.username ?? 'A user'} submitted their contribution.`
              : 'Document submitted.',
            detail: {
              actionKey,
              actorUserId: currentUser?.id ?? null,
              status: persistedNextStatus
            },
            auditGateway
          });
        } else if (isRejectAction) {
          await recordDocumentAuditEvent({
            db,
            request,
            documentId: document.id,
            eventType: 'rejected',
            summary: `${currentUser?.displayName ?? currentUser?.username ?? 'An approver'} rejected the document.`,
            detail: {
              actionKey,
              actorUserId: currentUser?.id ?? null,
              status: persistedNextStatus
            },
            auditGateway
          });
        } else if (isApproveOrRejectAction) {
          await recordDocumentAuditEvent({
            db,
            request,
            documentId: document.id,
            eventType: 'approved',
            summary: `${currentUser?.displayName ?? currentUser?.username ?? 'An approver'} approved the document.`,
            detail: {
              actionKey,
              actorUserId: currentUser?.id ?? null,
              status: persistedNextStatus
            },
            auditGateway
          });
        } else {
          await recordDocumentAuditEvent({
            db,
            request,
            documentId: document.id,
            eventType: 'action_executed',
            summary: `Executed action ${actionKey}.`,
            detail: {
              actionKey,
              controlKey,
              resultMessage: typeof result.message === 'string' ? result.message : null
            },
            auditGateway
          });
        }

        if (persistedNextStatus !== normalizedDocumentStatus) {
          await recordDocumentAuditEvent({
            db,
            request,
            documentId: document.id,
            eventType: 'status_changed',
            summary: `Status changed from ${normalizedDocumentStatus} to ${persistedNextStatus}.`,
            detail: {
              actionKey,
              fromStatus: normalizedDocumentStatus,
              toStatus: persistedNextStatus
            },
            auditGateway
          });
        }
        for (const hookLog of workflowHookLogs) {
          await recordDocumentAuditEvent({
            db,
            request,
            documentId: document.id,
            eventType: hookLog.success ? 'workflow_hook_executed' : 'workflow_hook_failed',
            summary: hookLog.success
              ? `Workflow hook executed: ${hookLog.operationRef}.`
              : `Workflow hook failed: ${hookLog.operationRef}${hookLog.error ? ` (${hookLog.error})` : ''}.`,
            detail: {
              operationRef: hookLog.operationRef,
              description: hookLog.description ?? null,
              message: hookLog.message ?? null,
              error: hookLog.error ?? null,
              trigger:
                hookLog.trigger === 'transition'
                  ? { type: 'transition', fromStatus: normalizedDocumentStatus, toStatus: persistedNextStatus }
                  : hookLog.trigger === 'workflowAction'
                    ? { type: 'workflowAction', action: actionKey }
                    : { type: 'enterState', state: persistedNextStatus }
            },
            auditGateway
          });
        }
      }
      if (persistedNextStatus === 'submitted' && normalizedDocumentStatus !== 'submitted') {
        const approverRecipientIds = supportsMultiAssignments
          ? nextApproverDecisions.map((item) => item.userId)
          : [document.approverUserId].filter((item): item is string => !!item);
        await publishDocumentNotification({
          db,
          request,
          notificationGateway,
          appBaseUrl,
          documentId: document.id,
          type: 'submitted_for_approval',
          subject: `Approval requested: ${document.id.slice(0, 8)}`,
          body: `Document ${document.id.slice(0, 8)} is ready for approval.`,
          recipientUserIds: approverRecipientIds,
          meta: {
            actionKey,
            status: persistedNextStatus
          }
        });
      }
      if (isRejectAction) {
        const editorRecipientIds = supportsMultiAssignments
          ? nextEditorSubmissions.map((item) => item.userId)
          : [document.editorUserId].filter((item): item is string => !!item);
        await publishDocumentNotification({
          db,
          request,
          notificationGateway,
          appBaseUrl,
          documentId: document.id,
          type: 'rejected',
          subject: `Document rejected: ${document.id.slice(0, 8)}`,
          body: `Document ${document.id.slice(0, 8)} was rejected and needs follow-up.`,
          recipientUserIds: editorRecipientIds,
          meta: {
            actionKey,
            status: persistedNextStatus
          }
        });
      } else if (persistedNextStatus === 'approved' && normalizedDocumentStatus !== 'approved') {
        const editorRecipientIds = supportsMultiAssignments
          ? nextEditorSubmissions.map((item) => item.userId)
          : [document.editorUserId].filter((item): item is string => !!item);
        await publishDocumentNotification({
          db,
          request,
          notificationGateway,
          appBaseUrl,
          documentId: document.id,
          type: 'approved',
          subject: `Document approved: ${document.id.slice(0, 8)}`,
          body: `Document ${document.id.slice(0, 8)} was approved.`,
          recipientUserIds: editorRecipientIds,
          meta: {
            actionKey,
            status: persistedNextStatus
          }
        });
      }
      if (typeof result.message === 'string' && result.message.trim().length > 0) {
        return redirectWithActionMessage(result.message);
      }
      reply.code(303);
      return reply.redirect(`/documents/${document.id}`);
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Action execution failed.';
      if (error instanceof ExternalCallError && error.status === 409) {
        message = `Action "${actionKey}" is not valid for current document status "${normalizedDocumentStatus}" (ERP transition rejected with 409).`;
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
          source: executionSource,
          activeUser: currentUser?.username ?? null,
          templateId: document.templateId,
          macroRefs,
          error: message,
          stack: error instanceof Error ? error.stack : undefined
        },
        'Action execution failed'
      );
      return redirectWithActionError(message);
    }
  });

  app.get('/api/lookup', async (request, reply) => {
    const query = toFormRecord(request.query);
    let parsedTemplateId = '';
    let parsedFieldKey = '';
    let resolvedSourceForLog: unknown = undefined;
    let resolvedUrlForLog: string | undefined = undefined;
    try {
      const parsed = lookupQuerySchema.safeParse(query);

      if (!parsed.success) {
        return reply.type('text/html').send('<option value="">Invalid lookup request</option>');
      }
      parsedTemplateId = parsed.data.templateId;
      parsedFieldKey = parsed.data.fieldKey;

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
      const source = await resolveLookupSource(field, { db });
      const { valueField, labelField } = resolveLookupFieldNames(field);
      resolvedSourceForLog = source;
      const lookupResult = await fetchLookupOptionsDetailed(erpBaseUrl, source, externalRefs, valueField, labelField);
      resolvedUrlForLog = lookupResult.url;
      app.log.info(
        {
          templateId: parsed.data.templateId,
          fieldKey: parsed.data.fieldKey,
          resolvedSource: lookupResult.source,
          resolvedUrl: lookupResult.url,
          rawItemCount: lookupResult.rawCount,
          mappedOptionCount: lookupResult.options.length
        },
        'Lookup resolved'
      );
      const options = lookupResult.options;
      const selectedValue = externalRefs[parsed.data.fieldKey] ?? '';

      const html = [
        '<option value="">Please choose...</option>',
        ...options.map((item) => {
          const selected = item.value === selectedValue ? ' selected' : '';
          return `<option value="${escapeHtml(item.value)}"${selected}>${escapeHtml(item.label)}</option>`;
        })
      ].join('');

      return reply.type('text/html').send(html);
    } catch (error) {
      app.log.warn(
        {
          templateId: parsedTemplateId || undefined,
          fieldKey: parsedFieldKey || undefined,
          resolvedSource: resolvedSourceForLog,
          resolvedUrl: resolvedUrlForLog,
          error: error instanceof Error ? error.message : String(error ?? 'Lookup failed')
        },
        'Lookup failed'
      );
      return reply.type('text/html').send('<option value="">Lookup unavailable</option>');
    }
  });
}
