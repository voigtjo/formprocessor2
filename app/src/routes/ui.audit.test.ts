import Fastify from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalAttachmentStorage } from '../core/attachments.js';
import { fpDocumentAttachments, fpDocumentAuditEvents, fpDocuments } from '../db/schema.js';
import { uiRoutes } from './ui.js';
import { buildV1MinimalEvidenceTemplateJson, buildV1ProductionBatchTemplateJson } from './test-template-fixtures.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createSelectDb(params?: {
  users?: Array<{ id: string; username: string; displayName: string }>;
  workflows?: Array<Record<string, unknown>>;
}) {
  const users = params?.users ?? [{ id: '00000000-0000-0000-0000-000000000011', username: 'alice', displayName: 'Alice' }];
  const workflows = params?.workflows ?? [];
  return vi.fn(() => ({
    from: () => ({
      orderBy: async () => users,
      where: () => ({
        orderBy: () => ({
          limit: async () => workflows
        }),
        limit: async () => workflows
      }),
      limit: async () => workflows
    })
  }));
}

describe('document audit trail', () => {
  it('writes a created audit entry when a document is created', async () => {
    const insertCalls: Array<{ table: unknown; values: any }> = [];
    const db = {
      select: createSelectDb({
        workflows: [
          {
            id: 'wf-1',
            key: 'evidence.group-submit.v1',
            name: 'Evidence Group Submit',
            state: 'active',
            version: 1,
            workflowJson: {
              initialStatus: 'created',
              order: ['created', 'assigned', 'submitted', 'approved', 'archived'],
              states: { created: { buttons: ['assign'] } }
            }
          }
        ]
      }),
      query: {
        fpTemplates: {
          findFirst: vi.fn(async () => ({
            id: '00000000-0000-0000-0000-0000000000a1',
            key: 'evidence-basic',
            name: 'Evidence Basic',
            state: 'published',
            version: 1,
            workflowRef: 'evidence.group-submit.v1',
            templateJson: buildV1MinimalEvidenceTemplateJson()
          }))
        },
        fpTemplateAssignments: {
          findMany: vi.fn(async () => [])
        },
      },
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((values: any) => {
          insertCalls.push({ table, values });
          if (table === fpDocuments) {
            return { returning: vi.fn(async () => [{ id: '00000000-0000-0000-0000-0000000000d1' }]) };
          }
          return {};
        })
      }))
    };

    const app = Fastify();
    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001',
      hasDocumentAuditTrail: true
    });

    const res = await app.inject({
      method: 'POST',
      url: '/documents',
      payload: { templateId: '00000000-0000-0000-0000-0000000000a1' }
    });

    expect(res.statusCode).toBe(303);
    const auditInsert = insertCalls.find((item) => item.table === fpDocumentAuditEvents);
    expect(auditInsert?.values).toMatchObject({
      documentId: '00000000-0000-0000-0000-0000000000d1',
      eventType: 'created'
    });

    await app.close();
  });

  it('writes form and journal audit entries on save', async () => {
    const insertCalls: Array<{ table: unknown; values: any }> = [];
    const updateCalls: any[] = [];
    const document = {
      id: '00000000-0000-0000-0000-0000000000d2',
      templateId: '00000000-0000-0000-0000-0000000000a2',
      status: 'created',
      groupId: null,
      editorUserId: null,
      approverUserId: null,
      assigneeUserId: null,
      reviewerUserId: null,
      templateVersion: 1,
      dataJson: {
        note: 'Old note',
        findings: [{ finding: 'Old row', closed: false }]
      },
      externalRefsJson: {},
      snapshotsJson: {}
    };
    const templateJson = buildV1MinimalEvidenceTemplateJson();

    const db = {
      select: createSelectDb({
        workflows: [
          {
            id: 'wf-1',
            key: 'evidence.group-submit.v1',
            name: 'Evidence Group Submit',
            state: 'active',
            version: 1,
            workflowJson: {
              initialStatus: 'created',
              order: ['created', 'assigned', 'submitted', 'approved', 'archived'],
              states: { created: { editable: ['note', 'findings'], buttons: ['assign'] } }
            }
          }
        ]
      }),
      query: {
        fpDocuments: { findFirst: vi.fn(async () => document) },
        fpTemplates: {
          findFirst: vi.fn(async () => ({
            id: '00000000-0000-0000-0000-0000000000a2',
            workflowRef: 'evidence.group-submit.v1',
            templateJson
          }))
        },
      },
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((values: any) => {
          insertCalls.push({ table, values });
          return {};
        })
      })),
      update: vi.fn(() => ({
        set: vi.fn((values: any) => ({
          where: vi.fn(async () => {
            updateCalls.push(values);
          })
        }))
      }))
    };

    const app = Fastify();
    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001',
      hasDocumentActorColumns: true,
      hasDocumentTemplateVersion: true,
      hasDocumentAuditTrail: true
    });

    const res = await app.inject({
      method: 'POST',
      url: `/documents/${document.id}/save`,
      payload: {
        'data:note': 'New note',
        'data:findings': JSON.stringify([
          { finding: 'Old row', closed: false },
          { finding: 'New row', closed: true }
        ])
      }
    });

    expect(res.statusCode).toBe(303);
    expect(updateCalls[0]?.dataJson).toMatchObject({
      note: 'New note'
    });
    const auditEvents = insertCalls.filter((item) => item.table === fpDocumentAuditEvents).map((item) => item.values.eventType);
    expect(auditEvents).toContain('form_updated');
    expect(auditEvents).toContain('journal_row_added');

    await app.close();
  });

  it('writes process audit entries for submit action', async () => {
    const insertCalls: Array<{ table: unknown; values: any }> = [];
    let currentStatus = 'assigned';
    const document = {
      id: '00000000-0000-0000-0000-0000000000d3',
      templateId: '00000000-0000-0000-0000-0000000000a3',
      status: currentStatus,
      groupId: null,
      editorUserId: '00000000-0000-0000-0000-000000000011',
      approverUserId: null,
      assigneeUserId: '00000000-0000-0000-0000-000000000011',
      reviewerUserId: null,
      templateVersion: 1,
      dataJson: {},
      externalRefsJson: {},
      snapshotsJson: {}
    };

    const db = {
      select: createSelectDb({
        workflows: [
          {
            id: 'wf-1',
            key: 'evidence.group-submit.v1',
            name: 'Evidence Group Submit',
            state: 'active',
            version: 1,
            workflowJson: {
              initialStatus: 'created',
              order: ['created', 'assigned', 'submitted', 'approved', 'archived'],
              states: {
                assigned: { buttons: ['submit'] },
                submitted: { buttons: ['approve'] }
              },
              semantics: { submit: 'global', approval: 'individual', completionRule: 'all_required_approvers' }
            }
          }
        ]
      }),
      query: {
        fpDocuments: { findFirst: vi.fn(async () => ({ ...document, status: currentStatus })) },
        fpTemplates: {
          findFirst: vi.fn(async () => ({
            id: '00000000-0000-0000-0000-0000000000a3',
            key: 'evidence-basic',
            workflowRef: 'evidence.group-submit.v1',
            templateJson: buildV1MinimalEvidenceTemplateJson()
          }))
        },
        fpTemplateAssignments: { findMany: vi.fn(async () => []) },
      },
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((values: any) => {
          insertCalls.push({ table, values });
          return {};
        })
      })),
      transaction: vi.fn(async (cb: (tx: any) => Promise<void>) => {
        const tx = {
          update: vi.fn(() => ({
            set: vi.fn((values: any) => ({
              where: vi.fn(async () => {
                if (typeof values.status === 'string') currentStatus = values.status;
              })
            }))
          }))
        };
        await cb(tx);
      })
    };

    const app = Fastify();
    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001',
      hasDocumentActorColumns: true,
      hasDocumentTemplateVersion: true,
      hasDocumentAuditTrail: true
    });

    const res = await app.inject({
      method: 'POST',
      url: `/documents/${document.id}/action/submit`
    });

    expect(res.statusCode).toBe(303);
    const eventTypes = insertCalls.filter((item) => item.table === fpDocumentAuditEvents).map((item) => item.values.eventType);
    expect(eventTypes).toContain('submitted');
    expect(eventTypes).toContain('status_changed');

    await app.close();
  });

  it('writes attachment audit entries on upload', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'fp-audit-attachments-'));
    tempDirs.push(rootDir);
    const attachmentStorage = createLocalAttachmentStorage({ rootDir });
    const insertCalls: Array<{ table: unknown; values: any }> = [];

    const db = {
      select: createSelectDb(),
      query: {
        fpDocuments: {
          findFirst: vi.fn(async () => ({
            id: '00000000-0000-0000-0000-0000000000d4',
            templateId: '00000000-0000-0000-0000-0000000000a4',
            status: 'assigned',
            groupId: null,
            dataJson: {},
            externalRefsJson: {},
            snapshotsJson: {},
            templateVersion: 1
          }))
        },
        fpDocumentAttachments: {
          findMany: vi.fn(async () => []),
          findFirst: vi.fn(async () => null)
        },
        fpTemplateAssignments: { findMany: vi.fn(async () => []) }
      },
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((values: any) => {
          insertCalls.push({ table, values });
          return table === fpDocumentAttachments ? { returning: vi.fn(async () => [values]) } : {};
        })
      }))
    };

    const app = Fastify();
    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001',
      hasDocumentActorColumns: true,
      hasDocumentTemplateVersion: true,
      hasDocumentAttachments: true,
      hasDocumentAuditTrail: true,
      attachmentStorage
    });

    const res = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d4/attachments',
      payload: {
        filename: 'evidence.png',
        contentType: 'image/png',
        base64Data: Buffer.from('proof').toString('base64'),
        kind: 'image'
      }
    });

    expect(res.statusCode).toBe(200);
    const auditInsert = insertCalls.find((item) => item.table === fpDocumentAuditEvents);
    expect(auditInsert?.values).toMatchObject({
      documentId: '00000000-0000-0000-0000-0000000000d4',
      eventType: 'attachment_uploaded'
    });

    await app.close();
  });

  it('renders audit history on the document detail page', async () => {
    const db = {
      select: createSelectDb({
        workflows: [
          {
            id: 'wf-1',
            key: 'production.standard.v1',
            name: 'Production Standard',
            state: 'active',
            version: 1,
            workflowJson: {
              initialStatus: 'created',
              order: ['created', 'assigned', 'approved', 'archived'],
              states: { submitted: { buttons: ['approve'] } }
            }
          }
        ]
      }),
      query: {
        fpDocuments: {
          findFirst: vi.fn(async () => ({
            id: '00000000-0000-0000-0000-0000000000d5',
            templateId: '00000000-0000-0000-0000-0000000000a5',
            status: 'submitted',
            groupId: null,
            editorUserId: null,
            approverUserId: null,
            dataJson: {},
            externalRefsJson: {},
            snapshotsJson: {},
            templateVersion: 1
          }))
        },
        fpTemplates: {
          findFirst: vi.fn(async () => ({
            id: '00000000-0000-0000-0000-0000000000a5',
            key: 'production-batch',
            name: 'Production Batch',
            workflowRef: 'production.standard.v1',
            templateJson: buildV1ProductionBatchTemplateJson()
          }))
        },
        fpTemplateAssignments: { findMany: vi.fn(async () => []) },
        fpDocumentEditors: { findMany: vi.fn(async () => []) },
        fpDocumentApprovals: { findMany: vi.fn(async () => []) },
        fpDocumentSubmissions: { findMany: vi.fn(async () => []) },
        fpDocumentAttachments: { findMany: vi.fn(async () => []) },
        fpDocumentAuditEvents: {
          findMany: vi.fn(async () => [
            {
              id: 'audit-2',
              documentId: '00000000-0000-0000-0000-0000000000d5',
              eventType: 'approved',
              actorUserId: 'u1',
              actorDisplay: 'Alice',
              summary: 'Alice approved the document.',
              detailJson: null,
              createdAt: new Date('2026-03-19T12:00:00Z')
            },
            {
              id: 'audit-1',
              documentId: '00000000-0000-0000-0000-0000000000d5',
              eventType: 'created',
              actorUserId: 'u1',
              actorDisplay: 'Alice',
              summary: 'Document created from template Production Batch.',
              detailJson: null,
              createdAt: new Date('2026-03-19T10:00:00Z')
            }
          ])
        }
      }
    };

    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      const auditEvents = Array.isArray(data.auditEvents) ? (data.auditEvents as Array<Record<string, unknown>>) : [];
      this.type('text/plain').send(
        auditEvents.map((item) => `${String(item.eventType)}|${String(item.actorDisplay)}|${String(item.summary)}`).join('\n')
      );
    });
    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001',
      hasDocumentActorColumns: true,
      hasDocumentTemplateVersion: true,
      hasDocumentMultiAssignments: true,
      hasDocumentAttachments: true,
      hasDocumentAuditTrail: true
    });

    const res = await app.inject({
      method: 'GET',
      url: '/documents/00000000-0000-0000-0000-0000000000d5'
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('approved|Alice|Alice approved the document.');
    expect(res.body).toContain('created|Alice|Document created from template Production Batch.');

    await app.close();
  });
});
