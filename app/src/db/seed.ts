import dotenv from 'dotenv';
import { and, eq } from 'drizzle-orm';
import { resolve } from 'node:path';
import { makeDb } from './index.js';
import { fpGroupMembers, fpGroups, fpMacros, fpTemplateAssignments, fpTemplates, fpUsers } from './schema.js';

dotenv.config({ path: resolve(process.cwd(), '../.env') });

async function upsertUser(db: ReturnType<typeof makeDb>['db'], username: string, displayName: string) {
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

async function upsertGroup(db: ReturnType<typeof makeDb>['db'], key: string, name: string) {
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

async function upsertMembership(
  db: ReturnType<typeof makeDb>['db'],
  groupId: string,
  userId: string,
  rights: string
) {
  await db
    .insert(fpGroupMembers)
    .values({ groupId, userId, rights })
    .onConflictDoUpdate({
      target: [fpGroupMembers.groupId, fpGroupMembers.userId],
      set: { rights }
    });
}

async function upsertTemplateAssignment(db: ReturnType<typeof makeDb>['db'], templateId: string, groupId: string) {
  await db.insert(fpTemplateAssignments).values({ templateId, groupId }).onConflictDoNothing();
}

async function upsertMacro(
  db: ReturnType<typeof makeDb>['db'],
  values: {
    ref: string;
    namespace: string;
    name: string;
    version: number;
    kind?: string;
    description: string;
    isEnabled?: boolean;
    paramsSchemaJson?: Record<string, unknown> | null;
    definitionJson?: Record<string, unknown> | null;
    codeText?: string | null;
  }
) {
  await db
    .insert(fpMacros)
    .values({
      ref: values.ref,
      namespace: values.namespace,
      name: values.name,
      version: values.version,
      kind: values.kind ?? 'json',
      description: values.description,
      isEnabled: values.isEnabled ?? true,
      paramsSchemaJson: values.paramsSchemaJson ?? null,
      definitionJson: values.definitionJson ?? null,
      codeText: values.codeText ?? null
    })
    .onConflictDoUpdate({
      target: fpMacros.ref,
      set: {
        namespace: values.namespace,
        name: values.name,
        version: values.version,
        kind: values.kind ?? 'json',
        description: values.description,
        isEnabled: values.isEnabled ?? true,
        paramsSchemaJson: values.paramsSchemaJson ?? null,
        definitionJson: values.definitionJson ?? null,
        codeText: values.codeText ?? null,
        updatedAt: new Date()
      }
    });
}

async function findSeedTemplateId(db: ReturnType<typeof makeDb>['db']) {
  const byKey = await db.query.fpTemplates.findFirst({
    where: and(eq(fpTemplates.key, 'customer-order'), eq(fpTemplates.state, 'published'))
  });
  if (byKey) return byKey.id;

  const published = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.state, 'published') });
  return published?.id;
}

async function upsertTemplateVersion(
  db: ReturnType<typeof makeDb>['db'],
  values: {
    key: string;
    version: number;
    name: string;
    description: string;
    state: 'draft' | 'published' | 'archived';
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
      templateJson: values.templateJson
    })
    .onConflictDoUpdate({
      target: [fpTemplates.key, fpTemplates.version],
      set: {
        name: values.name,
        description: values.description,
        state: values.state,
        publishedAt: values.state === 'published' ? new Date() : null,
        templateJson: values.templateJson
      }
    })
    .returning({ id: fpTemplates.id });
  return rows[0].id;
}

async function upsertRbacTestV2Template(db: ReturnType<typeof makeDb>['db']) {
  const templateJson = {
    fields: {
      assignee_user_id: { kind: 'workflow', label: 'Editor' },
      reviewer_user_id: { kind: 'workflow', label: 'Approver' }
    },
    layout: [],
    workflow: {
      initial: 'Created',
      order: ['Created', 'Assigned', 'Submitted', 'Approved'],
      states: {
        Created: { editable: [], readonly: [], buttons: ['assign_editor', 'assign_approver', 'submit'] },
        Assigned: { editable: [], readonly: [], buttons: ['assign_approver', 'submit'] },
        Submitted: { editable: [], readonly: [], buttons: ['approve'] },
        Approved: { editable: [], readonly: [], buttons: [] }
      }
    },
    controls: {
      assign_editor: { label: 'Assign Editor', action: 'assign_editor' },
      assign_approver: { label: 'Assign Approver', action: 'assign_approver' },
      submit: { label: 'Submit', action: 'submit' },
      approve: { label: 'Approve', action: 'approve' }
    },
    actions: {
      assign_editor: {
        type: 'composite',
        steps: [
          { type: 'requireField', key: 'assignee_user_id', message: 'Assign Editor requires selecting an editor first.' },
          { type: 'setField', key: 'assignee_user_id', value: '{{data.assignee_user_id}}' },
          { type: 'setStatus', to: 'Assigned' }
        ]
      },
      assign_approver: {
        type: 'composite',
        steps: [
          { type: 'requireField', key: 'reviewer_user_id', message: 'Assign Approver requires selecting an approver first.' },
          { type: 'setField', key: 'reviewer_user_id', value: '{{data.reviewer_user_id}}' }
        ]
      },
      submit: {
        type: 'composite',
        steps: [
          { type: 'requireField', key: 'assignee_user_id', message: 'Submit requires editor assignment first.' },
          { type: 'setStatus', to: 'Submitted' }
        ]
      },
      approve: {
        type: 'composite',
        steps: [
          { type: 'requireField', key: 'reviewer_user_id', message: 'Approve requires approver assignment first.' },
          { type: 'setStatus', to: 'Approved' }
        ]
      }
    },
    permissions: {
      actions: {
        approve: { requires: ['execute'] }
      }
    }
  };
  const draftTemplateJson = {
    ...templateJson,
    workflow: {
      ...templateJson.workflow,
      states: {
        ...templateJson.workflow.states,
        Created: { editable: [], readonly: [], buttons: ['assign_editor'] }
      }
    }
  };

  const publishedId = await upsertTemplateVersion(db, {
    key: 'rbac-test-v2',
    version: 1,
    name: 'RBAC Test v2',
    description: 'RBAC workflow with explicit editor/approver assignment',
    state: 'published',
    templateJson
  });
  await upsertTemplateVersion(db, {
    key: 'rbac-test-v2',
    version: 2,
    name: 'RBAC Test v2',
    description: 'Draft next version for RBAC workflow',
    state: 'draft',
    templateJson: draftTemplateJson
  });
  return publishedId;
}

async function upsertCustomerOrderTestTemplate(db: ReturnType<typeof makeDb>['db']) {
  const templateJson = {
    fields: {
      customer_id: {
        kind: 'lookup',
        label: 'Customer',
        source: {
          service: 'erp-sim',
          path: '/api/customers',
          method: 'GET',
          query: { valid: true },
          valueKey: 'id',
          labelKey: 'name'
        },
        required: true,
        snapshot: {
          labelKey: 'name'
        }
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
    workflow: {
      initial: 'Created',
      states: {
        Created: {
          editable: ['customer_id'],
          readonly: ['customer_order_number'],
          buttons: []
        }
      }
    },
    controls: {
      create_customer_order: { label: 'Create Customer Order', action: 'create_customer_order' }
    },
    actions: {
      create_customer_order: {
        type: 'macro',
        ref: 'macro:erp/ensureErpCustomerOrder@1',
        params: {
          customerRefKey: 'customer_id',
          writeFieldKey: 'customer_order_number',
          writeExternalRefKey: 'customer_order_id',
          writeSnapshotKey: 'customer_order_number'
        }
      }
    }
  };

  return upsertTemplateVersion(db, {
    key: 'customer-order-test',
    version: 1,
    name: 'Customer Order Test',
    description: 'Lookup customer and create ERP customer order via macro',
    state: 'published',
    templateJson
  });
}

async function run() {
  const { db, pool } = makeDb();

  try {
    const createBatchMacroDefinition = {
      ops: [
        { op: 'read', from: 'external.{{params.productRefKey}}', to: 'vars.productId' },
        { op: 'fallback', from: 'data.{{params.productRefKey}}', to: 'vars.productId' },
        { op: 'require', from: 'vars.productId', message: 'Select a product first.' },
        {
          op: 'http.post',
          service: 'erp',
          path: '/api/batches',
          body: { product_id: '{{vars.productId}}' },
          to: 'vars.batchResponse'
        },
        { op: 'require', from: 'vars.batchResponse.id', message: 'ERP create batch response missing id.' },
        {
          op: 'require',
          from: 'vars.batchResponse.batch_number',
          message: 'ERP create batch response missing batch_number.'
        },
        { op: 'write', to: 'data.{{params.writeFieldKey}}', value: '{{vars.batchResponse.batch_number}}' },
        { op: 'write', to: 'external.{{params.writeExternalRefKey}}', value: '{{vars.batchResponse.id}}' },
        { op: 'write', to: 'snapshot.{{params.writeSnapshotKey}}', value: '{{vars.batchResponse.batch_number}}' },
        { op: 'message', value: 'Batch created: {{vars.batchResponse.batch_number}}' }
      ]
    } satisfies Record<string, unknown>;
    const ensureErpCustomerOrderDefinition = {
      ops: [
        { op: 'read', from: 'external.{{params.customerRefKey}}', to: 'vars.customerId' },
        { op: 'fallback', from: 'data.{{params.customerRefKey}}', to: 'vars.customerId' },
        { op: 'require', from: 'vars.customerId', message: 'Select a customer first.' },
        {
          op: 'http.post',
          service: 'erp',
          path: '/api/customer-orders',
          body: { customer_id: '{{vars.customerId}}' },
          to: 'vars.response'
        },
        {
          op: 'require',
          from: 'vars.response.id',
          message: 'ERP customer order response missing id.'
        },
        {
          op: 'require',
          from: 'vars.response.order_number',
          message: 'ERP customer order response missing order_number.'
        },
        { op: 'write', to: 'data.{{params.writeFieldKey}}', value: '{{vars.response.order_number}}' },
        { op: 'write', to: 'external.{{params.writeExternalRefKey}}', value: '{{vars.response.id}}' },
        { op: 'write', to: 'snapshot.{{params.writeSnapshotKey}}', value: '{{vars.response.order_number}}' },
        { op: 'message', value: 'Customer order created via DB macro: {{vars.response.order_number}}' }
      ]
    } satisfies Record<string, unknown>;
    const reloadLookupDefinition = {
      ops: [{ op: 'log', value: 'reloadLookup requested' }],
      message: 'Lookup reloaded.'
    } satisfies Record<string, unknown>;

    const aliceId = await upsertUser(db, 'alice', 'Alice');
    const bobId = await upsertUser(db, 'bob', 'Bob');
    const charlyId = await upsertUser(db, 'charly', 'Charly');
    const opsId = await upsertGroup(db, 'ops', 'Operations');
    await upsertGroup(db, 'qa', 'QA');

    await upsertMembership(db, opsId, aliceId, 'rwx');
    await upsertMembership(db, opsId, bobId, 'rwx');
    await upsertMembership(db, opsId, charlyId, 'rw');

    const templateId = await findSeedTemplateId(db);
    if (templateId) {
      await upsertTemplateAssignment(db, templateId, opsId);
    }
    const rbacTemplateId = await upsertRbacTestV2Template(db);
    const customerOrderTemplateId = await upsertCustomerOrderTestTemplate(db);
    await upsertTemplateAssignment(db, rbacTemplateId, opsId);
    await upsertTemplateAssignment(db, customerOrderTemplateId, opsId);
    await upsertMacro(db, {
      ref: 'macro:erp/createBatch@1',
      namespace: 'erp',
      name: 'createBatch',
      version: 1,
      kind: 'json',
      description: 'Create ERP batch for a batch product',
      isEnabled: true,
      paramsSchemaJson: {
        type: 'object',
        additionalProperties: false,
        properties: {
          productRefKey: { type: 'string', default: 'product_id' },
          writeFieldKey: { type: 'string', default: 'batch_number' },
          writeExternalRefKey: { type: 'string', default: 'batch_id' },
          writeSnapshotKey: { type: 'string', default: 'batch_number' }
        }
      },
      definitionJson: createBatchMacroDefinition
    });
    await upsertMacro(db, {
      ref: 'macro:erp/ensureErpCustomerOrder@1',
      namespace: 'erp',
      name: 'ensureErpCustomerOrder',
      version: 1,
      kind: 'json',
      description: 'Ensure ERP customer order reference exists',
      isEnabled: true,
      paramsSchemaJson: {
        type: 'object',
        additionalProperties: false,
        properties: {
          customerRefKey: { type: 'string', default: 'customer_id' },
          writeFieldKey: { type: 'string', default: 'customer_order_number' },
          writeExternalRefKey: { type: 'string', default: 'customer_order_id' },
          writeSnapshotKey: { type: 'string', default: 'customer_order_number' }
        }
      },
      definitionJson: ensureErpCustomerOrderDefinition
    });
    await upsertMacro(db, {
      ref: 'macro:ui/reloadLookup@1',
      namespace: 'ui',
      name: 'reloadLookup',
      version: 1,
      kind: 'json',
      description: 'UI helper macro to trigger lookup refresh',
      isEnabled: true,
      paramsSchemaJson: {
        type: 'object',
        additionalProperties: true
      },
      definitionJson: reloadLookupDefinition
    });

    console.log('Seed ensured groups: ops, qa');
    console.log('Seed ensured users: alice, bob, charly');
    console.log('Seed ensured memberships: alice->ops(rwx), bob->ops(rwx), charly->ops(rw)');
    if (templateId) {
      console.log(`Seed ensured assignment: template ${templateId} -> ops`);
    } else {
      console.log('Seed note: no published template found for automatic ops assignment.');
    }
    console.log(`Seed ensured template versions: rbac-test-v2 v1 published + v2 draft (published id ${rbacTemplateId})`);
    console.log(`Seed ensured template version: customer-order-test v1 published (id ${customerOrderTemplateId})`);
    console.log('Seed ensured macros: macro:erp/createBatch@1, macro:erp/ensureErpCustomerOrder@1, macro:ui/reloadLookup@1');
  } finally {
    await pool.end();
  }
}

await run();
