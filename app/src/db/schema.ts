// P0 placeholder schema. Run 2 will fill this with full Drizzle tables.
import { pgTable, text, uuid, jsonb, timestamp, integer } from 'drizzle-orm/pg-core';

export const fpTemplates = pgTable('fp_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  version: integer('version').notNull().default(1),
  templateJson: jsonb('template_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const fpDocuments = pgTable('fp_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  templateId: uuid('template_id').notNull(),
  status: text('status').notNull(),
  dataJson: jsonb('data_json').notNull().default({}),
  externalRefsJson: jsonb('external_refs_json').notNull().default({}),
  snapshotsJson: jsonb('snapshots_json').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});
