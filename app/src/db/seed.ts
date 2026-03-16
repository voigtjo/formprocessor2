import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import { resolve } from 'node:path';
import { makeDb } from './index.js';
import {
  fpApis,
  fpDocumentApprovals,
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

dotenv.config({ path: resolve(process.cwd(), '../.env') });

type Db = ReturnType<typeof makeDb>['db'];

async function upsertUser(db: Db, username: string, displayName: string) {
  const rows = await db
    .insert(fpUsers)
    .values({ username, displayName })
    .onConflictDoUpdate({
      target: fpUsers.username,
      set: { displayName }
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
      created: { buttons: ['assign'], editable: ['customer_id'], readonly: ['customer_order_number'] },
      assigned: { buttons: ['submit'], editable: ['customer_id'], readonly: ['customer_order_number'] },
      submitted: { buttons: ['approve'], editable: [], readonly: ['customer_id', 'customer_order_number'] },
      approved: { buttons: ['archive'], editable: [], readonly: ['customer_id', 'customer_order_number'] },
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
      }
    },
    layout: [
      { type: 'h1', text: 'Production Batch' },
      { type: 'field', key: 'product_id' },
      { type: 'button', key: 'create_batch', action: 'create_batch', kind: 'ui', label: 'Create Batch' },
      { type: 'field', key: 'batch_number' }
    ],
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
        label: 'Evidence Title'
      },
      evidence_note: {
        kind: 'editable',
        label: 'Evidence Note',
        multiline: true
      }
    },
    layout: [
      { type: 'h1', text: 'Evidence Basic' },
      { type: 'field', key: 'evidence_title' },
      { type: 'field', key: 'evidence_note' }
    ],
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
        multiline: true
      }
    },
    layout: [
      { type: 'h1', text: 'Evidence Product Check' },
      { type: 'field', key: 'product_id' },
      { type: 'field', key: 'inspection_note' }
    ],
    actions: {}
  } satisfies Record<string, unknown>;
}

function buildCustomerOrderTemplateJson() {
  return {
    fields: {
      customer_id: {
        kind: 'lookup',
        label: 'Customer',
        apiRef: 'customers.listValid',
        valueKey: 'id',
        labelKey: 'name',
        required: true
      },
      customer_order_number: {
        kind: 'editable',
        label: 'Customer Order Number'
      }
    },
    layout: [
      { type: 'h1', text: 'Customer Order Test' },
      { type: 'field', key: 'customer_id' },
      { type: 'button', key: 'create_customer_order', action: 'create_customer_order', kind: 'ui', label: 'Create Customer Order' },
      { type: 'field', key: 'customer_order_number' }
    ],
    actions: {
      create_customer_order: {
        type: 'composite',
        steps: [
          { type: 'require', from: 'external.customer_id', message: 'Select a customer first.' },
          {
            type: 'callApi',
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

async function run() {
  const { db, pool } = makeDb();

  try {
    const erpBaseUrl = process.env.ERP_SIM_BASE_URL ?? 'http://localhost:3001';

    const aliceId = await upsertUser(db, 'alice', 'Alice');
    const bobId = await upsertUser(db, 'bob', 'Bob');
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
      workflowRef: evidenceWorkflow.key,
      templateJson: buildCustomerOrderTemplateJson()
    });
    await clearTemplateMacroLinks(db, customerOrderTemplateId);
    await upsertTemplateAssignment(db, customerOrderTemplateId, opsId);

    await upsertApi(db, {
      key: 'products.listValid',
      name: 'List Valid Products',
      description: 'Fetch products with valid=true from ERP',
      method: 'GET',
      baseUrl: erpBaseUrl,
      path: '/api/products',
      requestSchemaJson: { query: { valid: true } }
    });
    await upsertApi(db, {
      key: 'customers.listValid',
      name: 'List Valid Customers',
      description: 'Fetch customers with valid=true from ERP',
      method: 'GET',
      baseUrl: erpBaseUrl,
      path: '/api/customers',
      requestSchemaJson: { query: { valid: true } }
    });
    await upsertApi(db, {
      key: 'customerOrders.create',
      name: 'Create Customer Order',
      description: 'Create customer order in ERP',
      method: 'POST',
      baseUrl: erpBaseUrl,
      path: '/api/customer-orders',
      requestSchemaJson: { body: { customer_id: 'uuid' } },
      responseSchemaJson: { id: 'uuid', order_number: 'string', status: 'string' }
    });
    await upsertApi(db, {
      key: 'batches.create',
      name: 'Create Batch',
      description: 'Create batch in ERP',
      method: 'POST',
      baseUrl: erpBaseUrl,
      path: '/api/batches',
      requestSchemaJson: { body: { product_id: 'uuid' } },
      responseSchemaJson: { id: 'uuid', batch_number: 'string', status: 'string' }
    });

    // Two small reference documents make the seeded V1 flows immediately visible
    // in the browser without reintroducing a demo zoo.
    await upsertDocument(db, {
      id: '10000000-0000-0000-0000-000000000001',
      templateId: evidenceBasicTemplateId,
      templateVersion: 1,
      status: 'assigned',
      groupId: opsId,
      editorUserId: aliceId,
      approverUserId: bobId,
      dataJson: {
        evidence_title: 'Incoming delivery evidence',
        evidence_note: 'Initial evidence note captured for review.'
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
      status: 'created',
      groupId: opsId,
      dataJson: {}
    });

    console.log(
      'Seed complete: users(alice,bob), group(ops), 2 workflows, 4 APIs, 4 published templates, 2 reference documents.'
    );
  } finally {
    await pool.end();
  }
}

await run();
