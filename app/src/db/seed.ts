import dotenv from 'dotenv';
import { eq, inArray } from 'drizzle-orm';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { makeDb } from './index.js';
import {
  fpApis,
  fpDocumentApprovals,
  fpDocumentAttachments,
  fpDocumentAuditEvents,
  fpDocumentEditors,
  fpDocuments,
  fpDocumentSubmissions,
  fpGroupMembers,
  fpGroups,
  fpTemplateAssignments,
  fpTemplateMacros,
  fpTemplates,
  fpUsers,
  fpWorkflows
} from './schema.js';
import { createLocalAttachmentStorage } from '../core/attachments.js';
import { listConnectorOperations, toApiCatalogEntry } from '../connectors/registry.js';

dotenv.config({ path: resolve(process.cwd(), '../.env') });

type Db = ReturnType<typeof makeDb>['db'];

const REFERENCE_WORKFLOW_KEYS = ['production.standard.v1', 'evidence.group-submit.v1', 'customer-order.group-submit.v1'] as const;
const REFERENCE_TEMPLATE_KEYS = ['evidence-basic', 'evidence-product-check', 'production-batch', 'customer-order-test'] as const;
const REFERENCE_DOCUMENT_IDS = [
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000004'
] as const;
const REFERENCE_ATTACHMENT_IDS = {
  evidenceImage: '20000000-0000-0000-0000-000000000001',
  batchReport: '20000000-0000-0000-0000-000000000002'
} as const;
const REFERENCE_AUDIT_IDS = {
  evidenceCreated: '30000000-0000-0000-0000-000000000001',
  evidenceSubmitted: '30000000-0000-0000-0000-000000000002',
  evidenceAttachmentUploaded: '30000000-0000-0000-0000-000000000003',
  batchCreated: '30000000-0000-0000-0000-000000000004',
  batchActionExecuted: '30000000-0000-0000-0000-000000000005',
  batchApproved: '30000000-0000-0000-0000-000000000006',
  productCheckAssigned: '30000000-0000-0000-0000-000000000007',
  customerOrderActionExecuted: '30000000-0000-0000-0000-000000000008'
} as const;
const DEFAULT_TENANT_KEY = 'default';

async function upsertUser(db: Db, username: string, displayName: string, email: string) {
  const rows = await db
    .insert(fpUsers)
    .values({ username, displayName, email })
    .onConflictDoUpdate({
      target: fpUsers.username,
      set: { displayName, email }
    })
    .returning({ id: fpUsers.id });
  return rows[0].id;
}

async function upsertGroup(db: Db, key: string, name: string) {
  const rows = await db
    .insert(fpGroups)
    .values({ key, name })
    .onConflictDoUpdate({
      target: fpGroups.key,
      set: { name }
    })
    .returning({ id: fpGroups.id });
  return rows[0].id;
}

async function upsertMembership(db: Db, groupId: string, userId: string, rights: string) {
  await db
    .insert(fpGroupMembers)
    .values({ groupId, userId, rights })
    .onConflictDoUpdate({
      target: [fpGroupMembers.groupId, fpGroupMembers.userId],
      set: { rights }
    });
}

async function upsertTemplateVersion(
  db: Db,
  values: {
    key: string;
    version: number;
    name: string;
    description: string;
    state: 'draft' | 'published' | 'inactive';
    workflowRef: string;
    templateJson: Record<string, unknown>;
  }
) {
  const rows = await db
    .insert(fpTemplates)
    .values({
      key: values.key,
      version: values.version,
      name: values.name,
      description: values.description,
      state: values.state,
      publishedAt: values.state === 'published' ? new Date() : null,
      workflowRef: values.workflowRef,
      templateJson: values.templateJson
    })
    .onConflictDoUpdate({
      target: [fpTemplates.key, fpTemplates.version],
      set: {
        name: values.name,
        description: values.description,
        state: values.state,
        publishedAt: values.state === 'published' ? new Date() : null,
        workflowRef: values.workflowRef,
        templateJson: values.templateJson
      }
    })
    .returning({ id: fpTemplates.id });
  return rows[0].id;
}

async function upsertTemplateAssignment(db: Db, templateId: string, groupId: string) {
  await db.insert(fpTemplateAssignments).values({ templateId, groupId }).onConflictDoNothing();
}

async function clearTemplateMacroLinks(db: Db, templateId: string) {
  await db.delete(fpTemplateMacros).where(eq(fpTemplateMacros.templateId, templateId));
}

async function upsertDocument(
  db: Db,
  values: {
    id: string;
    templateId: string;
    templateVersion: number;
    status: string;
    groupId: string | null;
    editorUserId?: string | null;
    approverUserId?: string | null;
    dataJson?: Record<string, unknown>;
    externalRefsJson?: Record<string, unknown>;
    snapshotsJson?: Record<string, unknown>;
  }
) {
  await db
    .insert(fpDocuments)
    .values({
      id: values.id,
      templateId: values.templateId,
      templateVersion: values.templateVersion,
      status: values.status,
      groupId: values.groupId,
      editorUserId: values.editorUserId ?? null,
      approverUserId: values.approverUserId ?? null,
      assigneeUserId: values.editorUserId ?? null,
      reviewerUserId: values.approverUserId ?? null,
      dataJson: values.dataJson ?? {},
      externalRefsJson: values.externalRefsJson ?? {},
      snapshotsJson: values.snapshotsJson ?? {},
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: fpDocuments.id,
      set: {
        templateId: values.templateId,
        templateVersion: values.templateVersion,
        status: values.status,
        groupId: values.groupId,
        editorUserId: values.editorUserId ?? null,
        approverUserId: values.approverUserId ?? null,
        assigneeUserId: values.editorUserId ?? null,
        reviewerUserId: values.approverUserId ?? null,
        dataJson: values.dataJson ?? {},
        externalRefsJson: values.externalRefsJson ?? {},
        snapshotsJson: values.snapshotsJson ?? {},
        updatedAt: new Date()
      }
    });
}

async function upsertDocumentEditor(db: Db, documentId: string, userId: string) {
  await db.insert(fpDocumentEditors).values({ documentId, userId }).onConflictDoNothing();
}

async function upsertDocumentSubmission(
  db: Db,
  values: { documentId: string; userId: string; status: 'pending' | 'submitted'; submittedAt?: Date | null }
) {
  await db
    .insert(fpDocumentSubmissions)
    .values({
      documentId: values.documentId,
      userId: values.userId,
      status: values.status,
      submittedAt: values.submittedAt ?? null,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: [fpDocumentSubmissions.documentId, fpDocumentSubmissions.userId],
      set: {
        status: values.status,
        submittedAt: values.submittedAt ?? null,
        updatedAt: new Date()
      }
    });
}

async function upsertDocumentApproval(
  db: Db,
  values: {
    documentId: string;
    userId: string;
    status: 'pending' | 'approved' | 'rejected';
    approvedAt?: Date | null;
    decidedAt?: Date | null;
  }
) {
  await db
    .insert(fpDocumentApprovals)
    .values({
      documentId: values.documentId,
      userId: values.userId,
      status: values.status,
      approvedAt: values.approvedAt ?? null,
      decidedAt: values.decidedAt ?? null,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: [fpDocumentApprovals.documentId, fpDocumentApprovals.userId],
      set: {
        status: values.status,
        approvedAt: values.approvedAt ?? null,
        decidedAt: values.decidedAt ?? null,
        updatedAt: new Date()
      }
    });
}

async function upsertDocumentAttachment(
  db: Db,
  values: {
    id: string;
    documentId: string;
    kind: 'image' | 'file';
    filename: string;
    mimeType: string;
    size: number;
    storageKey: string;
    uploadedBy: string | null;
    createdAt?: Date;
  }
) {
  await db
    .insert(fpDocumentAttachments)
    .values({
      id: values.id,
      documentId: values.documentId,
      kind: values.kind,
      filename: values.filename,
      mimeType: values.mimeType,
      size: values.size,
      storageKey: values.storageKey,
      uploadedBy: values.uploadedBy,
      createdAt: values.createdAt ?? new Date()
    })
    .onConflictDoUpdate({
      target: fpDocumentAttachments.id,
      set: {
        documentId: values.documentId,
        kind: values.kind,
        filename: values.filename,
        mimeType: values.mimeType,
        size: values.size,
        storageKey: values.storageKey,
        uploadedBy: values.uploadedBy,
        createdAt: values.createdAt ?? new Date()
      }
    });
}

async function upsertDocumentAuditEvent(
  db: Db,
  values: {
    id: string;
    documentId: string;
    eventType: string;
    actorUserId?: string | null;
    actorDisplay?: string | null;
    summary: string;
    detailJson?: Record<string, unknown> | null;
    createdAt?: Date;
  }
) {
  await db
    .insert(fpDocumentAuditEvents)
    .values({
      id: values.id,
      documentId: values.documentId,
      eventType: values.eventType,
      actorUserId: values.actorUserId ?? null,
      actorDisplay: values.actorDisplay ?? null,
      summary: values.summary,
      detailJson: values.detailJson ?? null,
      createdAt: values.createdAt ?? new Date()
    })
    .onConflictDoUpdate({
      target: fpDocumentAuditEvents.id,
      set: {
        documentId: values.documentId,
        eventType: values.eventType,
        actorUserId: values.actorUserId ?? null,
        actorDisplay: values.actorDisplay ?? null,
        summary: values.summary,
        detailJson: values.detailJson ?? null,
        createdAt: values.createdAt ?? new Date()
      }
    });
}

async function upsertApi(
  db: Db,
  values: {
    key: string;
    name: string;
    description?: string;
    state?: 'active' | 'inactive';
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    baseUrl?: string | null;
    path: string;
    requestSchemaJson?: Record<string, unknown> | null;
    responseSchemaJson?: Record<string, unknown> | null;
  }
) {
  await db
    .insert(fpApis)
    .values({
      key: values.key,
      name: values.name,
      description: values.description ?? null,
      state: values.state ?? 'active',
      method: values.method,
      baseUrl: values.baseUrl ?? null,
      path: values.path,
      requestSchemaJson: values.requestSchemaJson ?? null,
      responseSchemaJson: values.responseSchemaJson ?? null
    })
    .onConflictDoUpdate({
      target: fpApis.key,
      set: {
        name: values.name,
        description: values.description ?? null,
        state: values.state ?? 'active',
        method: values.method,
        baseUrl: values.baseUrl ?? null,
        path: values.path,
        requestSchemaJson: values.requestSchemaJson ?? null,
        responseSchemaJson: values.responseSchemaJson ?? null,
        updatedAt: new Date()
      }
    });
}

async function upsertWorkflow(
  db: Db,
  values: {
    key: string;
    version: number;
    name: string;
    description?: string;
    state?: 'draft' | 'active' | 'inactive';
    workflowJson: Record<string, unknown>;
  }
) {
  const rows = await db
    .insert(fpWorkflows)
    .values({
      key: values.key,
      version: values.version,
      name: values.name,
      description: values.description ?? null,
      state: values.state ?? 'active',
      workflowJson: values.workflowJson,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: [fpWorkflows.key, fpWorkflows.version],
      set: {
        name: values.name,
        description: values.description ?? null,
        state: values.state ?? 'active',
        workflowJson: values.workflowJson,
        updatedAt: new Date()
      }
    })
    .returning({ id: fpWorkflows.id, key: fpWorkflows.key });

  return rows[0];
}

function buildProductionStandardWorkflowJson() {
  return {
    statuses: ['created', 'assigned', 'approved', 'archived'],
    initialStatus: 'created',
    order: ['created', 'assigned', 'approved', 'archived'],
    states: {
      created: { buttons: ['assign'], editable: ['product_id'], readonly: ['batch_number'] },
      assigned: { buttons: ['approve'], editable: [], readonly: ['product_id', 'batch_number'] },
      approved: { buttons: ['archive'], editable: [], readonly: ['product_id', 'batch_number'] },
      archived: { buttons: [] }
    },
    semantics: {
      submit: 'global',
      approval: 'global',
      completionRule: 'global_approval'
    },
    actorModel: {
      editors: 'single',
      approvers: 'multiple'
    }
  } satisfies Record<string, unknown>;
}

function buildEvidenceGroupSubmitWorkflowJson() {
  return {
    statuses: ['created', 'assigned', 'submitted', 'approved', 'archived'],
    initialStatus: 'created',
    order: ['created', 'assigned', 'submitted', 'approved', 'archived'],
    states: {
      created: { buttons: ['assign'], editable: ['customer_id', 'fulfillment_flags'], readonly: ['customer_order_number'] },
      assigned: { buttons: ['submit'], editable: ['customer_id', 'fulfillment_flags'], readonly: ['customer_order_number'] },
      submitted: { buttons: ['approve'], editable: [], readonly: ['customer_id', 'fulfillment_flags', 'customer_order_number'] },
      approved: { buttons: ['archive'], editable: [], readonly: ['customer_id', 'fulfillment_flags', 'customer_order_number'] },
      archived: { buttons: [] }
    },
    semantics: {
      submit: 'individual',
      approval: 'individual',
      completionRule: 'all_required_approvers'
    },
    actorModel: {
      editors: 'multiple',
      approvers: 'multiple'
    }
  } satisfies Record<string, unknown>;
}

function buildCustomerOrderWorkflowJson() {
  return {
    statuses: ['created', 'assigned', 'submitted', 'approved', 'archived'],
    initialStatus: 'created',
    order: ['created', 'assigned', 'submitted', 'approved', 'archived'],
    states: {
      created: { buttons: ['assign'], editable: ['customer_id', 'fulfillment_flags'], readonly: ['customer_order_number'] },
      assigned: { buttons: ['submit'], editable: ['customer_id', 'fulfillment_flags'], readonly: ['customer_order_number'] },
      submitted: { buttons: ['approve'], editable: [], readonly: ['customer_id', 'fulfillment_flags', 'customer_order_number'] },
      approved: { buttons: ['archive'], editable: [], readonly: ['customer_id', 'fulfillment_flags', 'customer_order_number'] },
      archived: { buttons: [] }
    },
    semantics: {
      submit: 'individual',
      approval: 'individual',
      completionRule: 'all_required_approvers'
    },
    actorModel: {
      editors: 'multiple',
      approvers: 'multiple'
    },
    hooks: {
      onTransition: [
        {
          from: 'submitted',
          to: 'approved',
          effects: [
            {
              operationRef: 'customerOrders.setStatusFromContext',
              apiRef: 'customerOrders.setStatus',
              request: {
                status: 'approved'
              },
              responseMapping: {
                snapshot: {
                  customer_order_sync_ok: 'ok'
                }
              },
              description: 'Sync ERP customer order status when the workflow is approved.'
            }
          ]
        }
      ]
    }
  } satisfies Record<string, unknown>;
}

function buildProductionBatchTemplateJson() {
  return {
    fields: {
      product_id: {
        kind: 'lookup',
        label: 'Product',
        apiRef: 'products.listValid',
        valueKey: 'id',
        labelKey: 'name',
        required: true
      },
      batch_number: {
        kind: 'editable',
        label: 'Batch Number'
      },
      batch_priority: {
        kind: 'editable',
        label: 'Priority',
        control: 'radioGroup',
        options: [
          { value: 'normal', label: 'Normal' },
          { value: 'rush', label: 'Rush' }
        ],
        helpText: 'Use rush only when the batch must bypass the normal queue.'
      },
      inspection_steps: {
        kind: 'journal',
        label: 'Inspection Steps',
        helpText: 'Capture measured checkpoints or confirmations row by row.',
        columns: [
          { key: 'step', label: 'Step', type: 'text', placeholder: 'Inspection step' },
          { key: 'measured_value', label: 'Measured Value', type: 'number', placeholder: '0' },
          {
            key: 'result',
            label: 'Result',
            type: 'select',
            options: [
              { value: 'ok', label: 'OK' },
              { value: 'hold', label: 'Hold' },
              { value: 'fail', label: 'Fail' }
            ]
          },
          { key: 'confirmed', label: 'Confirmed', type: 'checkbox' }
        ]
      }
    },
    form: {
      rows: [
        {
          cells: [
            { width: 12, content: { type: 'markdown', style: 'heading1', text: 'Production Batch' } }
          ]
        },
        {
          cells: [
            { width: 7, content: { type: 'field', fieldKey: 'product_id' } },
            { width: 5, align: 'right', content: { type: 'field', fieldKey: 'batch_priority' } }
          ]
        },
        {
          cells: [
            { width: 5, content: { type: 'button', action: 'create_batch', label: 'Create Batch', key: 'create_batch', kind: 'ui' } },
            { width: 1, content: { type: 'spacer', size: 'sm' } },
            { width: 6, content: { type: 'field', fieldKey: 'batch_number' } }
          ]
        },
        {
          cells: [
            { width: 8, content: { type: 'journal', fieldKey: 'inspection_steps' } },
            {
              width: 4,
              content: {
                type: 'attachmentArea',
                title: 'Batch Attachments',
                helpText: 'Store certificates, photos and production evidence here.'
              }
            }
          ]
        }
      ]
    },
    documentTable: {
      columns: [
        { key: 'product_id', label: 'Product' },
        { key: 'batch_priority', label: 'Priority' },
        { key: 'batch_number', label: 'Batch Number' },
        { key: 'inspection_steps', label: 'Inspection Steps' }
      ]
    },
    actions: {
      create_batch: {
        type: 'composite',
        steps: [
          { type: 'require', from: 'external.product_id', message: 'Select a product first.' },
          {
            type: 'callApi',
            apiRef: 'batches.create',
            request: { product_id: '{{external.product_id}}' },
            to: 'vars.batchResponse'
          },
          { type: 'write', to: 'data.batch_number', value: '{{vars.batchResponse.batch_number}}' },
          { type: 'write', to: 'external.batch_id', value: '{{vars.batchResponse.id}}' },
          { type: 'write', to: 'snapshot.batch_number', value: '{{vars.batchResponse.batch_number}}' },
          { type: 'message', value: 'Batch created: {{vars.batchResponse.batch_number}}' }
        ]
      }
    }
  } satisfies Record<string, unknown>;
}

function buildEvidenceBasicTemplateJson() {
  return {
    fields: {
      evidence_title: {
        kind: 'editable',
        label: 'Evidence Title',
        placeholder: 'Short working title for the evidence set'
      },
      evidence_type: {
        kind: 'editable',
        label: 'Evidence Type',
        control: 'radioGroup',
        options: [
          { value: 'photo', label: 'Photo evidence' },
          { value: 'checklist', label: 'Checklist proof' },
          { value: 'note', label: 'Written note' }
        ]
      },
      evidence_flags: {
        kind: 'editable',
        label: 'Evidence Flags',
        control: 'checkboxGroup',
        options: [
          { value: 'complete', label: 'Complete' },
          { value: 'signed', label: 'Signed off' },
          { value: 'exception', label: 'Has exception' }
        ]
      },
      evidence_note: {
        kind: 'editable',
        label: 'Evidence Note',
        multiline: true,
        rows: 5,
        placeholder: 'Describe what was checked, captured, or confirmed.'
      },
      findings: {
        kind: 'journal',
        label: 'Findings',
        helpText: 'Add concrete findings or actions as separate rows.',
        columns: [
          { key: 'finding', label: 'Finding', type: 'text', placeholder: 'Describe the finding' },
          { key: 'action', label: 'Action', type: 'text', placeholder: 'Next step or owner' },
          {
            key: 'severity',
            label: 'Severity',
            type: 'select',
            options: [
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' }
            ]
          },
          { key: 'closed', label: 'Closed', type: 'checkbox' }
        ]
      }
    },
    form: {
      rows: [
        {
          cells: [
            { width: 12, content: { type: 'markdown', style: 'heading1', text: 'Evidence Basic' } }
          ]
        },
        {
          cells: [
            { width: 6, content: { type: 'field', fieldKey: 'evidence_title' } },
            { width: 6, align: 'center', content: { type: 'field', fieldKey: 'evidence_type' } }
          ]
        },
        {
          cells: [
            { width: 12, content: { type: 'field', fieldKey: 'evidence_flags' } }
          ]
        },
        {
          cells: [
            { width: 12, content: { type: 'field', fieldKey: 'evidence_note' } }
          ]
        },
        {
          cells: [
            { width: 8, content: { type: 'journal', fieldKey: 'findings' } },
            {
              width: 4,
              content: {
                type: 'attachmentArea',
                title: 'Evidence Attachments',
                helpText: 'Upload photos or files that support this evidence note.'
              }
            }
          ]
        }
      ]
    },
    documentTable: {
      columns: [
        { key: 'evidence_title', label: 'Title' },
        { key: 'evidence_type', label: 'Type' },
        { key: 'evidence_flags', label: 'Flags' },
        { key: 'evidence_note', label: 'Note' },
        { key: 'findings', label: 'Findings' }
      ]
    },
    actions: {}
  } satisfies Record<string, unknown>;
}

function buildEvidenceProductCheckTemplateJson() {
  return {
    fields: {
      product_id: {
        kind: 'lookup',
        label: 'Product',
        apiRef: 'products.listValid',
        valueKey: 'id',
        labelKey: 'name',
        required: true
      },
      inspection_note: {
        kind: 'editable',
        label: 'Inspection Note',
        multiline: true,
        rows: 5,
        placeholder: 'Record the observed condition, deviations, and follow-up.'
      },
      check_result: {
        kind: 'editable',
        label: 'Check Result',
        control: 'radioGroup',
        options: [
          { value: 'pass', label: 'Pass' },
          { value: 'hold', label: 'Hold' },
          { value: 'fail', label: 'Fail' }
        ]
      },
      issue_tags: {
        kind: 'editable',
        label: 'Issue Tags',
        control: 'checkboxGroup',
        options: [
          { value: 'labeling', label: 'Labeling' },
          { value: 'packaging', label: 'Packaging' },
          { value: 'quality', label: 'Quality' }
        ]
      }
    },
    form: {
      rows: [
        {
          cells: [
            { width: 12, content: { type: 'markdown', style: 'heading1', text: 'Evidence Product Check' } }
          ]
        },
        {
          cells: [
            { width: 5, content: { type: 'field', fieldKey: 'product_id' } },
            { width: 4, content: { type: 'field', fieldKey: 'check_result' } },
            { width: 3, align: 'right', content: { type: 'field', fieldKey: 'issue_tags' } }
          ]
        },
        {
          cells: [
            { width: 12, content: { type: 'field', fieldKey: 'inspection_note' } }
          ]
        },
        {
          cells: [
            {
              width: 12,
              content: {
                type: 'attachmentArea',
                title: 'Product Evidence',
                helpText: 'Keep product photos and supporting files together with this check.'
              }
            }
          ]
        }
      ]
    },
    documentTable: {
      columns: [
        { key: 'product_id', label: 'Product' },
        { key: 'check_result', label: 'Result' },
        { key: 'issue_tags', label: 'Issue Tags' },
        { key: 'inspection_note', label: 'Inspection Note' }
      ]
    },
    actions: {}
  } satisfies Record<string, unknown>;
}

function buildCustomerOrderTemplateJson() {
  return {
    fields: {
      customer_id: {
        kind: 'lookup',
        label: 'Customer',
        operationRef: 'customers.listValid',
        apiRef: 'customers.listValid',
        valueKey: 'id',
        labelKey: 'name',
        required: true
      },
      customer_order_number: {
        kind: 'editable',
        label: 'Customer Order Number'
      },
      fulfillment_flags: {
        kind: 'editable',
        label: 'Fulfillment Flags',
        control: 'checkboxGroup',
        options: [
          { value: 'expedite', label: 'Expedite' },
          { value: 'gift', label: 'Gift wrap' },
          { value: 'quality_hold', label: 'Quality hold' }
        ]
      }
    },
    form: {
      rows: [
        {
          cells: [
            { width: 12, content: { type: 'markdown', style: 'heading1', text: 'Customer Order Test' } }
          ]
        },
        {
          cells: [
            { width: 7, content: { type: 'field', fieldKey: 'customer_id' } },
            { width: 5, align: 'center', content: { type: 'field', fieldKey: 'fulfillment_flags' } }
          ]
        },
        {
          cells: [
            { width: 5, content: { type: 'button', action: 'create_customer_order', label: 'Create Customer Order', key: 'create_customer_order', kind: 'ui' } },
            { width: 1, content: { type: 'spacer', size: 'sm' } },
            { width: 6, content: { type: 'field', fieldKey: 'customer_order_number' } }
          ]
        }
      ]
    },
    documentTable: {
      columns: [
        { key: 'customer_id', label: 'Customer' },
        { key: 'fulfillment_flags', label: 'Flags' },
        { key: 'customer_order_number', label: 'Customer Order Number' }
      ]
    },
    actions: {
      create_customer_order: {
        type: 'composite',
        steps: [
          { type: 'require', from: 'external.customer_id', message: 'Select a customer first.' },
          {
            type: 'callApi',
            operationRef: 'customerOrders.create',
            apiRef: 'customerOrders.create',
            request: { customer_id: '{{external.customer_id}}' },
            to: 'vars.customerOrderResponse'
          },
          { type: 'write', to: 'data.customer_order_number', value: '{{vars.customerOrderResponse.order_number}}' },
          { type: 'write', to: 'external.customer_order_id', value: '{{vars.customerOrderResponse.id}}' },
          { type: 'write', to: 'snapshot.customer_order_number', value: '{{vars.customerOrderResponse.order_number}}' },
          { type: 'message', value: 'Customer order created: {{vars.customerOrderResponse.order_number}}' }
        ]
      }
    }
  } satisfies Record<string, unknown>;
}

async function deleteReferenceContent(db: Db) {
  await db.delete(fpDocuments).where(inArray(fpDocuments.id, [...REFERENCE_DOCUMENT_IDS]));

  const existingTemplateRows = await db
    .select({ id: fpTemplates.id })
    .from(fpTemplates)
    .where(inArray(fpTemplates.key, [...REFERENCE_TEMPLATE_KEYS]));
  const existingTemplateIds = existingTemplateRows.map((row) => row.id);

  if (existingTemplateIds.length > 0) {
    await db.delete(fpDocuments).where(inArray(fpDocuments.templateId, existingTemplateIds));
  }

  await db.delete(fpTemplates).where(inArray(fpTemplates.key, [...REFERENCE_TEMPLATE_KEYS]));
  await db.delete(fpWorkflows).where(inArray(fpWorkflows.key, [...REFERENCE_WORKFLOW_KEYS]));
}

async function clearReferenceArtifacts(rootDir: string) {
  const attachmentRoot = resolve(rootDir, 'var', 'attachments', DEFAULT_TENANT_KEY);
  for (const documentId of REFERENCE_DOCUMENT_IDS) {
    await rm(resolve(attachmentRoot, documentId), { recursive: true, force: true });
  }

  const notificationRoot = resolve(rootDir, 'var', 'notifications');
  await rm(notificationRoot, { recursive: true, force: true });
  await mkdir(notificationRoot, { recursive: true });
}

async function run() {
  const { db, pool } = makeDb();

  try {
    await deleteReferenceContent(db);
    await clearReferenceArtifacts(process.cwd());

    const erpBaseUrl = process.env.ERP_SIM_BASE_URL ?? 'http://localhost:3001';
    const attachmentStorage = createLocalAttachmentStorage({
      rootDir: resolve(process.cwd(), 'var', 'attachments')
    });

    const aliceId = await upsertUser(db, 'alice', 'Alice', 'alice@example.local');
    const bobId = await upsertUser(db, 'bob', 'Bob', 'bob@example.local');
    const opsId = await upsertGroup(db, 'ops', 'Operations');

    await upsertMembership(db, opsId, aliceId, 'rwx');
    await upsertMembership(db, opsId, bobId, 'rwx');

    const productionWorkflow = await upsertWorkflow(db, {
      key: 'production.standard.v1',
      version: 1,
      name: 'Production Standard V1',
      description: 'Simple production workflow with assign, approve and archive.',
      state: 'active',
      workflowJson: buildProductionStandardWorkflowJson()
    });
    const evidenceWorkflow = await upsertWorkflow(db, {
      key: 'evidence.group-submit.v1',
      version: 1,
      name: 'Evidence Group Submit V1',
      description: 'Individual editor submit and person-specific approvals until all required approvers approved.',
      state: 'active',
      workflowJson: buildEvidenceGroupSubmitWorkflowJson()
    });
    const customerOrderWorkflow = await upsertWorkflow(db, {
      key: 'customer-order.group-submit.v1',
      version: 1,
      name: 'Customer Order Group Submit V1',
      description: 'Evidence-style review workflow with approval hook to sync external customer order status.',
      state: 'active',
      workflowJson: buildCustomerOrderWorkflowJson()
    });

    const productionTemplateId = await upsertTemplateVersion(db, {
      key: 'production-batch',
      version: 1,
      name: 'Production Batch',
      description: 'Reference template for production batch workflow',
      state: 'published',
      workflowRef: productionWorkflow.key,
      templateJson: buildProductionBatchTemplateJson()
    });
    await clearTemplateMacroLinks(db, productionTemplateId);
    await upsertTemplateAssignment(db, productionTemplateId, opsId);

    const evidenceBasicTemplateId = await upsertTemplateVersion(db, {
      key: 'evidence-basic',
      version: 1,
      name: 'Evidence Basic',
      description: 'Minimal reference template for evidence capture',
      state: 'published',
      workflowRef: evidenceWorkflow.key,
      templateJson: buildEvidenceBasicTemplateJson()
    });
    await clearTemplateMacroLinks(db, evidenceBasicTemplateId);
    await upsertTemplateAssignment(db, evidenceBasicTemplateId, opsId);

    const evidenceProductCheckTemplateId = await upsertTemplateVersion(db, {
      key: 'evidence-product-check',
      version: 1,
      name: 'Evidence Product Check',
      description: 'Reference evidence template with product lookup via apiRef',
      state: 'published',
      workflowRef: evidenceWorkflow.key,
      templateJson: buildEvidenceProductCheckTemplateJson()
    });
    await clearTemplateMacroLinks(db, evidenceProductCheckTemplateId);
    await upsertTemplateAssignment(db, evidenceProductCheckTemplateId, opsId);

    const customerOrderTemplateId = await upsertTemplateVersion(db, {
      key: 'customer-order-test',
      version: 1,
      name: 'Customer Order Test',
      description: 'Reference template for evidence/customer-order workflow',
      state: 'published',
      workflowRef: customerOrderWorkflow.key,
      templateJson: buildCustomerOrderTemplateJson()
    });
    await clearTemplateMacroLinks(db, customerOrderTemplateId);
    await upsertTemplateAssignment(db, customerOrderTemplateId, opsId);

    for (const connectorOperation of listConnectorOperations().filter((item) =>
      ['products.listValid', 'customers.listValid', 'customerOrders.create', 'customerOrders.setStatus', 'batches.create'].includes(item.ref)
    )) {
      const catalogEntry = toApiCatalogEntry(connectorOperation, {
        defaultErpBaseUrl: erpBaseUrl,
        env: process.env as Record<string, string | undefined>
      });
      await upsertApi(db, {
        key: catalogEntry.key,
        name: catalogEntry.name,
        description: `[TS Connector] ${catalogEntry.description ?? catalogEntry.name}`,
        method: catalogEntry.method,
        baseUrl: catalogEntry.baseUrl ?? erpBaseUrl,
        path: catalogEntry.path,
        requestSchemaJson: catalogEntry.requestSchemaJson ?? null,
        responseSchemaJson: catalogEntry.responseSchemaJson ?? null
      });
    }

    // A few stable reference documents make the recent V1 capabilities visible:
    // richer controls, journal, attachments, audit, approval flow and document tables.
    await upsertDocument(db, {
      id: '10000000-0000-0000-0000-000000000001',
      templateId: evidenceBasicTemplateId,
      templateVersion: 1,
      status: 'submitted',
      groupId: opsId,
      editorUserId: aliceId,
      approverUserId: bobId,
      dataJson: {
        evidence_type: 'photo',
        evidence_flags: ['complete', 'exception'],
        evidence_title: 'Incoming delivery evidence',
        evidence_note: 'Initial evidence note captured for review.',
        findings: [
          { finding: 'Seal damaged on pallet 4', action: 'Request replacement', severity: 'high', closed: false },
          { finding: 'Label partially unreadable', action: 'Reprint label', severity: 'medium', closed: true }
        ]
      },
      snapshotsJson: {
        evidence_title: 'Incoming delivery evidence'
      }
    });
    await upsertDocumentEditor(db, '10000000-0000-0000-0000-000000000001', aliceId);
    await upsertDocumentEditor(db, '10000000-0000-0000-0000-000000000001', bobId);
    await upsertDocumentSubmission(db, {
      documentId: '10000000-0000-0000-0000-000000000001',
      userId: aliceId,
      status: 'submitted',
      submittedAt: new Date('2026-03-16T09:00:00Z')
    });
    await upsertDocumentSubmission(db, {
      documentId: '10000000-0000-0000-0000-000000000001',
      userId: bobId,
      status: 'pending'
    });
    await upsertDocumentApproval(db, {
      documentId: '10000000-0000-0000-0000-000000000001',
      userId: bobId,
      status: 'pending'
    });

    await upsertDocument(db, {
      id: '10000000-0000-0000-0000-000000000002',
      templateId: productionTemplateId,
      templateVersion: 1,
      status: 'approved',
      groupId: opsId,
      editorUserId: aliceId,
      approverUserId: bobId,
      dataJson: {
        batch_priority: 'rush',
        batch_number: 'B-2026-0042',
        inspection_steps: [
          { step: 'Temperature', measured_value: 18.4, result: 'ok', confirmed: true },
          { step: 'Viscosity', measured_value: 42, result: 'ok', confirmed: true }
        ]
      },
      externalRefsJson: {
        product_id: 'prod-1'
      },
      snapshotsJson: {
        product_id: 'Starter Culture A',
        batch_number: 'B-2026-0042'
      }
    });
    await upsertDocumentApproval(db, {
      documentId: '10000000-0000-0000-0000-000000000002',
      userId: bobId,
      status: 'approved',
      approvedAt: new Date('2026-03-17T14:00:00Z'),
      decidedAt: new Date('2026-03-17T14:00:00Z')
    });

    await upsertDocument(db, {
      id: '10000000-0000-0000-0000-000000000003',
      templateId: evidenceProductCheckTemplateId,
      templateVersion: 1,
      status: 'assigned',
      groupId: opsId,
      editorUserId: aliceId,
      approverUserId: bobId,
      dataJson: {
        check_result: 'hold',
        issue_tags: ['quality', 'packaging'],
        inspection_note: 'Packaging seam split on two units. Waiting for attachment evidence.'
      },
      externalRefsJson: {
        product_id: 'prod-2'
      },
      snapshotsJson: {
        product_id: 'Packaging Film B'
      }
    });
    await upsertDocumentEditor(db, '10000000-0000-0000-0000-000000000003', aliceId);
    await upsertDocumentApproval(db, {
      documentId: '10000000-0000-0000-0000-000000000003',
      userId: bobId,
      status: 'pending'
    });

    await upsertDocument(db, {
      id: '10000000-0000-0000-0000-000000000004',
      templateId: customerOrderTemplateId,
      templateVersion: 1,
      status: 'assigned',
      groupId: opsId,
      editorUserId: aliceId,
      approverUserId: bobId,
      dataJson: {
        fulfillment_flags: ['expedite'],
        customer_order_number: 'CO-2026-0901'
      },
      externalRefsJson: {
        customer_id: 'cust-1',
        customer_order_id: 'order-1'
      },
      snapshotsJson: {
        customer_id: 'Northwind Trading',
        customer_order_number: 'CO-2026-0901'
      }
    });
    await upsertDocumentEditor(db, '10000000-0000-0000-0000-000000000004', aliceId);
    await upsertDocumentApproval(db, {
      documentId: '10000000-0000-0000-0000-000000000004',
      userId: bobId,
      status: 'pending'
    });

    const imageBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII=',
      'base64'
    );
    const pdfBytes = Buffer.from('%PDF-1.4\n% reference proof\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8');

    const evidenceAttachment = await attachmentStorage.save({
      tenantKey: DEFAULT_TENANT_KEY,
      documentId: '10000000-0000-0000-0000-000000000001',
      attachmentId: REFERENCE_ATTACHMENT_IDS.evidenceImage,
      filename: 'incoming-delivery-photo.png',
      contentType: 'image/png',
      bytes: imageBytes
    });
    await upsertDocumentAttachment(db, {
      id: REFERENCE_ATTACHMENT_IDS.evidenceImage,
      documentId: '10000000-0000-0000-0000-000000000001',
      kind: 'image',
      filename: 'incoming-delivery-photo.png',
      mimeType: 'image/png',
      size: imageBytes.length,
      storageKey: evidenceAttachment.attachmentKey,
      uploadedBy: aliceId,
      createdAt: new Date('2026-03-16T09:05:00Z')
    });

    const batchAttachment = await attachmentStorage.save({
      tenantKey: DEFAULT_TENANT_KEY,
      documentId: '10000000-0000-0000-0000-000000000002',
      attachmentId: REFERENCE_ATTACHMENT_IDS.batchReport,
      filename: 'batch-release-note.pdf',
      contentType: 'application/pdf',
      bytes: pdfBytes
    });
    await upsertDocumentAttachment(db, {
      id: REFERENCE_ATTACHMENT_IDS.batchReport,
      documentId: '10000000-0000-0000-0000-000000000002',
      kind: 'file',
      filename: 'batch-release-note.pdf',
      mimeType: 'application/pdf',
      size: pdfBytes.length,
      storageKey: batchAttachment.attachmentKey,
      uploadedBy: bobId,
      createdAt: new Date('2026-03-17T14:05:00Z')
    });

    await upsertDocumentAuditEvent(db, {
      id: REFERENCE_AUDIT_IDS.evidenceCreated,
      documentId: '10000000-0000-0000-0000-000000000001',
      eventType: 'created',
      actorUserId: aliceId,
      actorDisplay: 'Alice',
      summary: 'Document created from template Evidence Basic.',
      createdAt: new Date('2026-03-16T08:30:00Z')
    });
    await upsertDocumentAuditEvent(db, {
      id: REFERENCE_AUDIT_IDS.evidenceSubmitted,
      documentId: '10000000-0000-0000-0000-000000000001',
      eventType: 'submitted',
      actorUserId: aliceId,
      actorDisplay: 'Alice',
      summary: 'Alice submitted her evidence contribution.',
      createdAt: new Date('2026-03-16T09:00:00Z')
    });
    await upsertDocumentAuditEvent(db, {
      id: REFERENCE_AUDIT_IDS.evidenceAttachmentUploaded,
      documentId: '10000000-0000-0000-0000-000000000001',
      eventType: 'attachment_uploaded',
      actorUserId: aliceId,
      actorDisplay: 'Alice',
      summary: 'Uploaded attachment incoming-delivery-photo.png.',
      createdAt: new Date('2026-03-16T09:05:00Z')
    });
    await upsertDocumentAuditEvent(db, {
      id: REFERENCE_AUDIT_IDS.batchCreated,
      documentId: '10000000-0000-0000-0000-000000000002',
      eventType: 'created',
      actorUserId: aliceId,
      actorDisplay: 'Alice',
      summary: 'Production batch document created.',
      createdAt: new Date('2026-03-17T13:00:00Z')
    });
    await upsertDocumentAuditEvent(db, {
      id: REFERENCE_AUDIT_IDS.batchActionExecuted,
      documentId: '10000000-0000-0000-0000-000000000002',
      eventType: 'action_executed',
      actorUserId: aliceId,
      actorDisplay: 'Alice',
      summary: 'Executed Create Batch to generate batch number B-2026-0042.',
      createdAt: new Date('2026-03-17T13:15:00Z')
    });
    await upsertDocumentAuditEvent(db, {
      id: REFERENCE_AUDIT_IDS.batchApproved,
      documentId: '10000000-0000-0000-0000-000000000002',
      eventType: 'approved',
      actorUserId: bobId,
      actorDisplay: 'Bob',
      summary: 'Document approved for release.',
      createdAt: new Date('2026-03-17T14:00:00Z')
    });
    await upsertDocumentAuditEvent(db, {
      id: REFERENCE_AUDIT_IDS.productCheckAssigned,
      documentId: '10000000-0000-0000-0000-000000000003',
      eventType: 'assigned_editor',
      actorUserId: bobId,
      actorDisplay: 'Bob',
      summary: 'Assigned Alice as editor for product check.',
      createdAt: new Date('2026-03-18T08:00:00Z')
    });
    await upsertDocumentAuditEvent(db, {
      id: REFERENCE_AUDIT_IDS.customerOrderActionExecuted,
      documentId: '10000000-0000-0000-0000-000000000004',
      eventType: 'action_executed',
      actorUserId: aliceId,
      actorDisplay: 'Alice',
      summary: 'Executed Create Customer Order and stored order number CO-2026-0901.',
      createdAt: new Date('2026-03-18T10:00:00Z')
    });

    console.log(
      'Reference rebuild complete: users/groups preserved, 2 workflows, 4 APIs, 4 published templates, 4 reference documents, attachments, audit trail and cleared notification outbox.'
    );
  } finally {
    await pool.end();
  }
}

await run();
