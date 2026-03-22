import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const fpTemplates = pgTable(
  'fp_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    state: text('state').notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    workflowRef: text('workflow_ref'),
    templateJson: jsonb('template_json').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex('ux_fp_templates_key_version').on(table.key, table.version)]
);

export const fpWorkflows = pgTable(
  'fp_workflows',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    state: text('state').notNull().default('draft'),
    version: integer('version').notNull().default(1),
    workflowJson: jsonb('workflow_json').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex('ux_fp_workflows_key_version').on(table.key, table.version), index('idx_fp_workflows_state').on(table.state)]
);

export const fpUsers = pgTable(
  'fp_users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    email: text('email'),
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
    integrationContextJson: jsonb('integration_context_json').notNull().default(sql`'{}'::jsonb`),
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

export const fpDocumentEditors = pgTable(
  'fp_document_editors',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => fpDocuments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => fpUsers.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('ux_fp_document_editors_document_user').on(table.documentId, table.userId),
    index('idx_fp_document_editors_document').on(table.documentId),
    index('idx_fp_document_editors_user').on(table.userId)
  ]
);

export const fpDocumentSubmissions = pgTable(
  'fp_document_submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => fpDocuments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => fpUsers.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('ux_fp_document_submissions_document_user').on(table.documentId, table.userId),
    index('idx_fp_document_submissions_document').on(table.documentId),
    index('idx_fp_document_submissions_user').on(table.userId),
    index('idx_fp_document_submissions_status').on(table.status)
  ]
);

export const fpDocumentApprovals = pgTable(
  'fp_document_approvals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => fpDocuments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => fpUsers.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('ux_fp_document_approvals_document_user').on(table.documentId, table.userId),
    index('idx_fp_document_approvals_document').on(table.documentId),
    index('idx_fp_document_approvals_user').on(table.userId),
    index('idx_fp_document_approvals_status').on(table.status)
  ]
);

export const fpDocumentAttachments = pgTable(
  'fp_document_attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => fpDocuments.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('file'),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull().default(0),
    storageKey: text('storage_key').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => fpUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('idx_fp_document_attachments_document').on(table.documentId),
    index('idx_fp_document_attachments_uploaded_by').on(table.uploadedBy),
    index('idx_fp_document_attachments_kind').on(table.kind)
  ]
);

export const fpDocumentAuditEvents = pgTable(
  'fp_document_audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => fpDocuments.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => fpUsers.id, { onDelete: 'set null' }),
    actorDisplay: text('actor_display'),
    summary: text('summary').notNull(),
    detailJson: jsonb('detail_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('idx_fp_document_audit_events_document').on(table.documentId),
    index('idx_fp_document_audit_events_event_type').on(table.eventType),
    index('idx_fp_document_audit_events_actor').on(table.actorUserId),
    index('idx_fp_document_audit_events_created_at').on(table.createdAt)
  ]
);

export const fpMacros = pgTable(
  'fp_macros',
  {
    ref: text('ref').primaryKey(),
    namespace: text('namespace').notNull(),
    name: text('name').notNull(),
    version: integer('version').notNull(),
    kind: text('kind').notNull().default('json'),
    description: text('description'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    paramsSchemaJson: jsonb('params_schema_json'),
    definitionJson: jsonb('definition_json'),
    codeText: text('code_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('idx_fp_macros_enabled').on(table.isEnabled)]
);

export const fpApis = pgTable(
  'fp_apis',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    state: text('state').notNull().default('active'),
    method: text('method').notNull(),
    baseUrl: text('base_url'),
    path: text('path').notNull(),
    requestSchemaJson: jsonb('request_schema_json'),
    responseSchemaJson: jsonb('response_schema_json'),
    handlerCode: text('handler_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('ux_fp_apis_key').on(table.key),
    index('idx_fp_apis_state').on(table.state)
  ]
);

export const fpTemplateMacros = pgTable(
  'fp_template_macros',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => fpTemplates.id, { onDelete: 'cascade' }),
    macroRef: text('macro_ref')
      .notNull()
      .references(() => fpMacros.ref, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex('ux_fp_template_macros_template_macro').on(table.templateId, table.macroRef)]
);
