import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { healthRoutes } from '../../app/src/routes/health.js';
import { uiRoutes } from '../../app/src/routes/ui.js';
import {
  buildV1CustomerOrderTemplateJson,
  buildV1EvidenceProductCheckTemplateJson,
  buildV1MinimalEvidenceTemplateJson,
  buildV1ProductionBatchTemplateJson
} from '../../app/src/routes/test-template-fixtures.js';

const alice = { id: '00000000-0000-0000-0000-0000000000a1', username: 'alice', displayName: 'Alice' };
const bob = { id: '00000000-0000-0000-0000-0000000000b1', username: 'bob', displayName: 'Bob' };
const ops = { id: '00000000-0000-0000-0000-0000000000g1', key: 'ops', name: 'Operations' };

function createCoreV1MockDb() {
  const templates = [
    {
      id: '00000000-0000-0000-0000-000000000101',
      key: 'evidence-basic',
      name: 'Evidence Basic',
      description: 'Basic evidence form',
      state: 'published',
      version: 1,
      workflowRef: 'evidence.group-submit.v1',
      templateJson: buildV1MinimalEvidenceTemplateJson()
    },
    {
      id: '00000000-0000-0000-0000-000000000102',
      key: 'evidence-product-check',
      name: 'Evidence Product Check',
      description: 'Evidence with product lookup',
      state: 'published',
      version: 1,
      workflowRef: 'evidence.group-submit.v1',
      templateJson: buildV1EvidenceProductCheckTemplateJson()
    },
    {
      id: '00000000-0000-0000-0000-000000000103',
      key: 'production-batch',
      name: 'Production Batch',
      description: 'Production batch form',
      state: 'published',
      version: 1,
      workflowRef: 'production.standard.v1',
      templateJson: buildV1ProductionBatchTemplateJson()
    },
    {
      id: '00000000-0000-0000-0000-000000000104',
      key: 'customer-order-test',
      name: 'Customer Order Test',
      description: 'Customer order form',
      state: 'published',
      version: 1,
      workflowRef: 'evidence.group-submit.v1',
      templateJson: buildV1CustomerOrderTemplateJson()
    }
  ];

  const workflows = [
    {
      id: 'wf-prod',
      key: 'production.standard.v1',
      name: 'Production Standard',
      state: 'active',
      version: 1,
      workflowJson: {
        initialStatus: 'created',
        order: ['created', 'assigned', 'approved', 'archived'],
        states: {
          created: { buttons: ['assign'] },
          assigned: { buttons: ['approve'] },
          approved: { buttons: ['archive'] },
          archived: { buttons: [] }
        },
        semantics: { submit: 'global', approval: 'global' }
      }
    },
    {
      id: 'wf-evidence',
      key: 'evidence.group-submit.v1',
      name: 'Evidence Group Submit',
      state: 'active',
      version: 1,
      workflowJson: {
        initialStatus: 'created',
        order: ['created', 'assigned', 'submitted', 'approved', 'archived'],
        states: {
          created: { buttons: ['assign'] },
          assigned: { buttons: ['submit'] },
          submitted: { buttons: ['approve'] },
          approved: { buttons: ['archive'] },
          archived: { buttons: [] }
        },
        semantics: { submit: 'individual', approval: 'individual' }
      }
    }
  ];

  const docs = [
    {
      id: '00000000-0000-0000-0000-000000000201',
      templateId: templates[0]!.id,
      status: 'submitted',
      templateVersion: 1,
      groupId: ops.id,
      editorUserId: alice.id,
      approverUserId: bob.id,
      dataJson: {
        note: 'Incoming delivery checked.',
        findings: [{ finding: 'Seal damaged', action: 'Replace seal', severity: 'high', closed: false }]
      },
      externalRefsJson: {},
      snapshotsJson: {},
      createdAt: new Date('2026-03-19T08:00:00Z'),
      updatedAt: new Date('2026-03-19T09:00:00Z')
    },
    {
      id: '00000000-0000-0000-0000-000000000202',
      templateId: templates[2]!.id,
      status: 'assigned',
      templateVersion: 1,
      groupId: ops.id,
      editorUserId: alice.id,
      approverUserId: bob.id,
      dataJson: {
        batch_priority: 'rush',
        batch_number: 'B-1001',
        inspection_steps: [{ step: 'Temperature', measured_value: 18, result: 'ok', confirmed: true }]
      },
      externalRefsJson: { product_id: 'prod-1' },
      snapshotsJson: { product_id: 'Product A' },
      createdAt: new Date('2026-03-19T10:00:00Z'),
      updatedAt: new Date('2026-03-19T11:00:00Z')
    }
  ];

  let createdDocCounter = 300;

  const attachmentsByDocumentId: Record<string, Array<Record<string, unknown>>> = {
    [docs[0]!.id]: [
      {
        id: 'att-1',
        documentId: docs[0]!.id,
        kind: 'image',
        filename: 'evidence-photo.png',
        mimeType: 'image/png',
        size: 1024,
        storageKey: 'local/att-1',
        uploadedBy: alice.id,
        createdAt: new Date('2026-03-19T09:15:00Z')
      }
    ]
  };

  const auditByDocumentId: Record<string, Array<Record<string, unknown>>> = {
    [docs[0]!.id]: [
      {
        id: 'au-1',
        documentId: docs[0]!.id,
        eventType: 'created',
        actorUserId: alice.id,
        actorDisplay: 'Alice',
        summary: 'Document created from template Evidence Basic.',
        detailJson: null,
        createdAt: new Date('2026-03-19T08:00:00Z')
      },
      {
        id: 'au-2',
        documentId: docs[0]!.id,
        eventType: 'attachment_uploaded',
        actorUserId: alice.id,
        actorDisplay: 'Alice',
        summary: 'Uploaded attachment evidence-photo.png.',
        detailJson: null,
        createdAt: new Date('2026-03-19T09:15:00Z')
      }
    ]
  };

  const editorRowsByDocumentId: Record<string, Array<Record<string, unknown>>> = {
    [docs[0]!.id]: [{ documentId: docs[0]!.id, userId: alice.id }]
  };
  const submissionRowsByDocumentId: Record<string, Array<Record<string, unknown>>> = {
    [docs[0]!.id]: [{ documentId: docs[0]!.id, userId: alice.id, status: 'submitted', submittedAt: new Date('2026-03-19T08:45:00Z') }]
  };
  const approvalRowsByDocumentId: Record<string, Array<Record<string, unknown>>> = {
    [docs[0]!.id]: [{ documentId: docs[0]!.id, userId: bob.id, status: 'pending', decidedAt: null }]
  };

  const users = [
    { ...alice, email: 'alice@example.local' },
    { ...bob, email: 'bob@example.local' }
  ];

  const db = {
    query: {
      fpTemplates: {
        findMany: async () => templates,
        findFirst: async ({ where }: any = {}) => {
          const text = String(where ?? '');
          return templates.find((item) => text.includes(item.id) || text.includes(item.key)) ?? templates[0]!;
        }
      },
      fpTemplateAssignments: {
        findMany: async ({ where }: any = {}) => {
          const text = String(where ?? '');
          const template = templates.find((item) => text.includes(item.id));
          return template ? [{ id: `assign-${template.id}`, templateId: template.id, groupId: ops.id }] : [];
        }
      },
      fpDocuments: {
        findFirst: async ({ where }: any = {}) => {
          const text = String(where ?? '');
          return docs.find((item) => text.includes(item.id)) ?? docs[0] ?? null;
        },
        findMany: async ({ where }: any = {}) => {
          const text = String(where ?? '');
          const template = templates.find((item) => text.includes(item.id));
          return template ? docs.filter((item) => item.templateId === template.id) : docs;
        }
      },
      fpGroups: {
        findFirst: async () => ops
      },
      fpDocumentEditors: {
        findMany: async ({ where }: any = {}) => {
          const text = String(where ?? '');
          const doc = docs.find((item) => text.includes(item.id));
          return doc ? editorRowsByDocumentId[doc.id] ?? [] : editorRowsByDocumentId[docs[0]!.id] ?? [];
        }
      },
      fpDocumentSubmissions: {
        findMany: async ({ where }: any = {}) => {
          const text = String(where ?? '');
          const doc = docs.find((item) => text.includes(item.id));
          return doc ? submissionRowsByDocumentId[doc.id] ?? [] : submissionRowsByDocumentId[docs[0]!.id] ?? [];
        }
      },
      fpDocumentApprovals: {
        findMany: async ({ where }: any = {}) => {
          const text = String(where ?? '');
          const doc = docs.find((item) => text.includes(item.id));
          return doc ? approvalRowsByDocumentId[doc.id] ?? [] : approvalRowsByDocumentId[docs[0]!.id] ?? [];
        }
      },
      fpDocumentAttachments: {
        findMany: async ({ where }: any = {}) => {
          const text = String(where ?? '');
          const doc = docs.find((item) => text.includes(item.id));
          return doc ? attachmentsByDocumentId[doc.id] ?? [] : attachmentsByDocumentId[docs[0]!.id] ?? [];
        }
      },
      fpDocumentAuditEvents: {
        findMany: async ({ where }: any = {}) => {
          const text = String(where ?? '');
          const doc = docs.find((item) => text.includes(item.id));
          return doc ? auditByDocumentId[doc.id] ?? [] : auditByDocumentId[docs[0]!.id] ?? [];
        }
      },
      fpUsers: {
        findMany: async () => users,
        findFirst: async ({ where }: any = {}) => {
          const text = String(where ?? '');
          return users.find((item) => text.includes(item.id)) ?? null;
        }
      }
    },
    select: (selection?: Record<string, unknown>) => {
      const keys = Object.keys(selection ?? {});
      if (keys.includes('id') && keys.includes('key') && keys.includes('workflowJson')) {
        return {
          from: () => ({
            where: (whereClause: any) => {
              const text = String(whereClause ?? '');
              const matched = workflows.find((item) => text.includes(item.key));
              const selected = matched ? [matched] : [workflows[0]!];
              return {
                orderBy: () => ({
                  limit: async () => selected
                })
              };
            }
          })
        };
      }
      if (keys.includes('id') && keys.includes('username') && keys.includes('displayName') && keys.includes('email')) {
        return {
          from: () => ({
            where: async () => users
          })
        };
      }
      if (keys.includes('userId') && keys.includes('rights')) {
        return {
          from: () => ({
            innerJoin: () => ({
              where: () => ({
                orderBy: async () => users.map((item, index) => ({
                  userId: item.id,
                  rights: index === 0 ? 'rwx' : 'rwx',
                  username: item.username,
                  displayName: item.displayName
                }))
              })
            })
          })
        };
      }
      if (keys.includes('id') && keys.includes('key') && keys.includes('name') && keys.includes('description')) {
        return {
          from: () => ({
            where: () => ({
              orderBy: async () => templates
            })
          })
        };
      }
      return {
        from: () => ({
          where: async () => [],
          innerJoin: () => ({
            where: () => ({
              orderBy: async () => []
            })
          })
        })
      };
    },
    insert: () => ({
      values: (values: any) => ({
        returning: async () => {
          const id = `00000000-0000-0000-0000-000000000${createdDocCounter++}`;
          docs.push({
            id,
            templateId: values.templateId,
            status: values.status,
            templateVersion: values.templateVersion ?? 1,
            groupId: values.groupId ?? null,
            editorUserId: values.editorUserId ?? null,
            approverUserId: values.approverUserId ?? null,
            dataJson: values.dataJson ?? {},
            externalRefsJson: values.externalRefsJson ?? {},
            snapshotsJson: values.snapshotsJson ?? {},
            createdAt: new Date(),
            updatedAt: new Date()
          });
          return [{ id }];
        }
      })
    }),
    update: () => ({
      set: () => ({
        where: async () => {}
      })
    }),
    transaction: async (cb: (tx: any) => Promise<void>) => {
      await cb({
        update: () => ({
          set: () => ({
            where: async () => {}
          })
        })
      });
    }
  };

  return { db, templates, docs };
}

async function createApp() {
  const mock = createCoreV1MockDb();
  const app = Fastify();
  app.decorateReply('renderPage', async function renderPage(view: string, data: Record<string, unknown> = {}) {
    if (view === 'templates/list.ejs') {
      const templates = Array.isArray(data.templates) ? (data.templates as Array<Record<string, unknown>>) : [];
      this.type('text/plain').send(`templates=${templates.map((item) => item.key).join(',')}`);
      return;
    }
    if (view === 'templates/detail.ejs') {
      const columns = Array.isArray(data.documentTableColumns)
        ? (data.documentTableColumns as Array<Record<string, unknown>>).map((item) => item.label).join(',')
        : '';
      const rows = Array.isArray(data.documentTableRows) ? (data.documentTableRows as Array<Record<string, unknown>>) : [];
      this.type('text/plain').send(`template=${String((data.template as any)?.key ?? '')}\ncolumns=${columns}\nrows=${rows.length}`);
      return;
    }
    if (view === 'documents/new.ejs') {
      const templates = Array.isArray(data.templates) ? (data.templates as Array<Record<string, unknown>>) : [];
      this.type('text/plain').send(`templates=${templates.map((item) => item.key).join(',')}\nselected=${String(data.selectedTemplateId ?? '')}`);
      return;
    }
    if (view === 'documents/detail.ejs') {
      const processButtons = Array.isArray(data.processButtons)
        ? (data.processButtons as Array<Record<string, unknown>>).map((item) => item.label).join(',')
        : '';
      const templateButtons = Array.isArray(data.templateActionButtons)
        ? (data.templateActionButtons as Array<Record<string, unknown>>).map((item) => item.label).join(',')
        : '';
      const auditEvents = Array.isArray(data.auditEvents) ? (data.auditEvents as Array<Record<string, unknown>>) : [];
      const journalSummaries = Array.isArray(data.journalSummaries)
        ? (data.journalSummaries as Array<Record<string, unknown>>).map((item) => `${String(item.label)}:${String(item.rowCount)}`).join(',')
        : '';
      this.type('text/plain').send(
        [
          `document=${String((data.document as any)?.id ?? '')}`,
          `status=${String((data.document as any)?.status ?? '')}`,
          `workflowHint=${String(data.workflowHint ?? '')}`,
          `openWork=${Array.isArray(data.openWorkItems) ? (data.openWorkItems as string[]).join(' | ') : ''}`,
          `processButtons=${processButtons}`,
          `templateButtons=${templateButtons}`,
          `attachments=${String(data.attachmentCount ?? 0)}`,
          `journal=${journalSummaries}`,
          `history=${auditEvents.length}`
        ].join('\n')
      );
      return;
    }
    this.type('text/plain').send(JSON.stringify(data));
  });

  app.addHook('preHandler', async (request) => {
    request.users = [alice, bob];
    request.currentUser = alice;
    request.tenantContext = { tenantKey: 'default', tenantId: null, source: 'default' } as any;
    request.currentUserContext = null as any;
    request.requestContext = null as any;
  });

  await app.register(healthRoutes);
  await app.register(uiRoutes, {
    db: mock.db as any,
    erpBaseUrl: 'http://localhost:3001',
    hasDocumentActorColumns: true,
    hasDocumentTemplateVersion: true,
    hasDocumentMultiAssignments: true,
    hasDocumentAttachments: true,
    hasDocumentAuditTrail: true,
    appBaseUrl: 'http://localhost:3000'
  });

  return { app, mock };
}

describe('core v1 smoke via inject', () => {
  it('covers the visible V1 working surface', async () => {
    const { app, mock } = await createApp();

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    const templatesRes = await app.inject({ method: 'GET', url: '/templates' });
    expect(templatesRes.statusCode).toBe(200);
    expect(templatesRes.body).toContain('evidence-basic');
    expect(templatesRes.body).toContain('evidence-product-check');
    expect(templatesRes.body).toContain('production-batch');
    expect(templatesRes.body).toContain('customer-order-test');

    const newDocWizard = await app.inject({ method: 'GET', url: '/documents/new' });
    expect(newDocWizard.statusCode).toBe(200);
    expect(newDocWizard.body).toContain('evidence-basic');

    const createDoc = await app.inject({
      method: 'POST',
      url: '/documents',
      payload: { templateId: mock.templates[1]!.id }
    });
    expect(createDoc.statusCode).toBe(303);

    const detailRes = await app.inject({
      method: 'GET',
      url: `/documents/${mock.docs[0]!.id}`
    });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.body).toContain(`document=${mock.docs[0]!.id}`);
    expect(detailRes.body).toContain('status=submitted');
    expect(detailRes.body).toContain('workflowHint=Waiting for 1 approver decision before the document can become approved.');
    expect(detailRes.body).toContain('openWork=Waiting for 1 approver decision(s).');
    expect(detailRes.body).toContain('attachments=1');
    expect(detailRes.body).toContain('journal=Findings:1');
    expect(detailRes.body).toContain('history=2');

    const templateDetailRes = await app.inject({
      method: 'GET',
      url: `/templates/${mock.templates[2]!.id}`
    });
    expect(templateDetailRes.statusCode).toBe(200);
    expect(templateDetailRes.body).toContain('template=');
    expect(templateDetailRes.body).toContain('columns=');
    expect(templateDetailRes.body).toContain('rows=');

    const evidenceTemplateDetailRes = await app.inject({
      method: 'GET',
      url: `/templates/${mock.templates[0]!.id}`
    });
    expect(evidenceTemplateDetailRes.statusCode).toBe(200);
    expect(evidenceTemplateDetailRes.body).toContain('Findings');
    expect(evidenceTemplateDetailRes.body).toContain('rows=');

    await app.close();
  });
});
