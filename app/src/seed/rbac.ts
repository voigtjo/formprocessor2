import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import { resolve } from 'node:path';
import { makeDb } from '../db/index.js';
import { fpGroupMembers, fpGroups, fpTemplateAssignments, fpTemplates, fpUsers } from '../db/schema.js';

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
  const byKey = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.key, 'customer-order') });
  if (byKey) return byKey.id;

  const active = await db.query.fpTemplates.findFirst({ where: eq(fpTemplates.state, 'active') });
  return active?.id;
}

async function run() {
  const { db, pool } = makeDb();

  try {
    const aliceId = await upsertUser(db, 'alice', 'Alice');
    const bobId = await upsertUser(db, 'bob', 'Bob');
    const opsId = await upsertGroup(db, 'ops', 'Operations');
    await upsertGroup(db, 'qa', 'QA');

    await upsertMembership(db, opsId, aliceId, 'rwx');
    await upsertMembership(db, opsId, bobId, 'r');

    const templateId = await findSeedTemplateId(db);
    if (templateId) {
      await upsertTemplateAssignment(db, templateId, opsId);
      console.log(`RBAC seed done (template assigned: ${templateId}).`);
    } else {
      console.log('RBAC seed done (no active template found for assignment).');
    }
  } finally {
    await pool.end();
  }
}

await run();
