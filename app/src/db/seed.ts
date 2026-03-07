import dotenv from 'dotenv';
import { and, eq } from 'drizzle-orm';
import { resolve } from 'node:path';
import { makeDb } from './index.js';
import { fpGroupMembers, fpGroups, fpTemplateAssignments, fpTemplates, fpUsers } from './schema.js';

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

async function run() {
  const { db, pool } = makeDb();

  try {
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
    await upsertTemplateAssignment(db, rbacTemplateId, opsId);

    console.log('Seed ensured groups: ops, qa');
    console.log('Seed ensured users: alice, bob, charly');
    console.log('Seed ensured memberships: alice->ops(rwx), bob->ops(rwx), charly->ops(rw)');
    if (templateId) {
      console.log(`Seed ensured assignment: template ${templateId} -> ops`);
    } else {
      console.log('Seed note: no published template found for automatic ops assignment.');
    }
    console.log(`Seed ensured template versions: rbac-test-v2 v1 published + v2 draft (published id ${rbacTemplateId})`);
  } finally {
    await pool.end();
  }
}

await run();
