import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { buildV1CustomerOrderTemplateJson } from './test-template-fixtures.js';
import { uiRoutes } from './ui.js';

describe('template document data view', () => {
  it('renders system columns plus configured documentTable fields for a template', async () => {
    const templateId = '00000000-0000-0000-0000-0000000000a1';
    const documentId = '00000000-0000-0000-0000-0000000000d1';

    const db = {
      query: {
        fpTemplates: {
          findFirst: vi.fn(async () => ({
            id: templateId,
            key: 'customer-order-test',
            name: 'Customer Order Test',
            description: 'Reference template',
            state: 'published',
            version: 1,
            workflowRef: 'evidence.group-submit.v1',
            templateJson: buildV1CustomerOrderTemplateJson()
          }))
        },
        fpWorkflows: {
          findMany: vi.fn(async () => [
            {
              id: 'wf-1',
              key: 'evidence.group-submit.v1',
              name: 'Evidence Group Submit',
              version: 1
            }
          ])
        },
        fpDocuments: {
          findMany: vi.fn(async () => [
            {
              id: documentId,
              status: 'submitted',
              templateVersion: 1,
              createdAt: new Date('2026-03-16T09:00:00Z'),
              updatedAt: new Date('2026-03-16T10:00:00Z'),
              dataJson: { customer_order_number: 'CO-42' },
              externalRefsJson: { customer_id: 'cust-1' },
              snapshotsJson: { customer_id: 'Customer A' }
            }
          ])
        },
        fpDocumentEditors: {
          findMany: vi.fn(async () => [{ documentId, userId: 'u1' }])
        },
        fpDocumentApprovals: {
          findMany: vi.fn(async () => [{ documentId, userId: 'u2' }])
        },
        fpUsers: {
          findMany: vi.fn(async () => [
            { id: 'u1', username: 'alice', displayName: 'Alice' },
            { id: 'u2', username: 'bob', displayName: 'Bob' }
          ])
        }
      },
      select: vi.fn(() => ({
        from: () => ({
          where: async () => []
        })
      }))
    };

    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      const columns = Array.isArray(data.documentTableColumns)
        ? (data.documentTableColumns as Array<{ label: string }>).map((item) => item.label).join(', ')
        : '';
      const rows = Array.isArray(data.documentTableRows)
        ? (data.documentTableRows as Array<Record<string, unknown>>)
        : [];
      const firstRow = rows[0] ?? {};
      const firstValues = Array.isArray(firstRow.values)
        ? (firstRow.values as Array<{ value: string }>).map((item) => item.value).join(', ')
        : '';
      this.type('text/plain').send(
        [
          `columns=${columns}`,
          `status=${String(firstRow.status ?? '')}`,
          `editors=${Array.isArray(firstRow.editors) ? (firstRow.editors as string[]).join(', ') : ''}`,
          `approvers=${Array.isArray(firstRow.approvers) ? (firstRow.approvers as string[]).join(', ') : ''}`,
          `values=${firstValues}`
        ].join('\n')
      );
    });

    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001',
      hasDocumentActorColumns: true,
      hasDocumentMultiAssignments: true
    });

    const res = await app.inject({
      method: 'GET',
      url: `/templates/${templateId}`
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('columns=Customer, Flags, Customer Order Number');
    expect(res.body).toContain('status=submitted');
    expect(res.body).toContain('editors=Alice');
    expect(res.body).toContain('approvers=Bob');
    expect(res.body).toContain('values=Customer A, —, CO-42');

    await app.close();
  });
});
