import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const fpTemplates = pgTable(
  'fp_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    state: text('state').notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    templateJson: jsonb('template_json').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex('ux_fp_templates_key_version').on(table.key, table.version)]
);

export const fpUsers = pgTable(
  'fp_users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex('ux_fp_users_username').on(table.username)]
);

export const fpGroups = pgTable(
  'fp_groups',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex('ux_fp_groups_key').on(table.key)]
);

export const fpGroupMembers = pgTable(
  'fp_group_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => fpGroups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => fpUsers.id, { onDelete: 'cascade' }),
    rights: text('rights').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex('ux_fp_group_members_group_user').on(table.groupId, table.userId)]
);

export const fpTemplateAssignments = pgTable(
  'fp_template_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => fpTemplates.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => fpGroups.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex('ux_fp_template_assignments_template_group').on(table.templateId, table.groupId)]
);

export const fpDocuments = pgTable(
  'fp_documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => fpTemplates.id, { onDelete: 'restrict' }),
    status: text('status').notNull(),
    templateVersion: integer('template_version').notNull().default(1),
    groupId: uuid('group_id').references(() => fpGroups.id, { onDelete: 'set null' }),
    editorUserId: uuid('editor_user_id').references(() => fpUsers.id, { onDelete: 'set null' }),
    approverUserId: uuid('approver_user_id').references(() => fpUsers.id, { onDelete: 'set null' }),
    assigneeUserId: uuid('assignee_user_id').references(() => fpUsers.id, { onDelete: 'set null' }),
    reviewerUserId: uuid('reviewer_user_id').references(() => fpUsers.id, { onDelete: 'set null' }),
    dataJson: jsonb('data_json').notNull().default(sql`'{}'::jsonb`),
    externalRefsJson: jsonb('external_refs_json').notNull().default(sql`'{}'::jsonb`),
    snapshotsJson: jsonb('snapshots_json').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('idx_fp_documents_template_status').on(table.templateId, table.status),
    index('idx_fp_documents_group').on(table.groupId),
    index('idx_fp_documents_editor').on(table.editorUserId),
    index('idx_fp_documents_approver').on(table.approverUserId),
    index('idx_fp_documents_assignee').on(table.assigneeUserId),
    index('idx_fp_documents_reviewer').on(table.reviewerUserId)
  ]
);
