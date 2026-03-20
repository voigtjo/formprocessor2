import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { buildV1ProductionBatchTemplateJson } from './test-template-fixtures.js';
import { uiRoutes } from './ui.js';

function createSelectMock(workflows: Array<Record<string, unknown>>) {
  function asyncRows(rows: Array<Record<string, unknown>>) {
    const promise = Promise.resolve(rows) as Promise<Array<Record<string, unknown>>> & {
      orderBy: () => Promise<Array<Record<string, unknown>>>;
      limit: () => Promise<Array<Record<string, unknown>>>;
    };
    promise.orderBy = async () => rows;
    promise.limit = async () => rows;
    return promise;
  }

  return vi.fn(() => ({
    from: () => ({
      where: () => asyncRows(workflows),
      orderBy: async () => [],
      limit: async () => []
    })
  }));
}

describe('template builder pages', () => {
  it('renders the new template page with builder enabled and V1 starter json', async () => {
    const db = {
      select: createSelectMock([{ id: 'wf-1', key: 'evidence.group-submit.v1', name: 'Evidence', version: 1, state: 'active' }])
    };

    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      this.type('text/plain').send(
        [
          `builder=${String(data.builderEnabled ?? false)}`,
          `workflow=${String((data.form as any)?.workflow_ref ?? '')}`,
          `json=${String((data.form as any)?.template_json ?? '')}`
        ].join('\n')
      );
    });
    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001'
    });

    const res = await app.inject({ method: 'GET', url: '/templates/new' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('builder=true');
    expect(res.body).toContain('workflow=evidence.group-submit.v1');
    expect(res.body).toContain('"fields"');
    expect(res.body).toContain('"layout"');

    await app.close();
  });

  it('renders the edit template page with builder enabled and existing V1 json', async () => {
    const template = {
      id: '00000000-0000-0000-0000-0000000000a1',
      key: 'production-batch',
      name: 'Production Batch',
      description: 'Reference',
      state: 'draft',
      version: 1,
      workflowRef: 'production.standard.v1',
      templateJson: buildV1ProductionBatchTemplateJson()
    };
    const db = {
      query: {
        fpTemplates: {
          findFirst: vi.fn(async () => template)
        },
        fpTemplateAssignments: {
          findMany: vi.fn(async () => [])
        }
      },
      select: createSelectMock([])
    };

    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      this.type('text/plain').send(
        [
          `builder=${String(data.builderEnabled ?? false)}`,
          `workflow=${String((data.form as any)?.workflow_ref ?? '')}`,
          `json=${String((data.form as any)?.template_json ?? '')}`
        ].join('\n')
      );
    });
    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001'
    });

    const res = await app.inject({ method: 'GET', url: `/templates/${template.id}/edit` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('builder=true');
    expect(res.body).toContain('workflow=production.standard.v1');
    expect(res.body).toContain('"inspection_steps"');
    expect(res.body).toContain('"documentTable"');

    await app.close();
  });
});
