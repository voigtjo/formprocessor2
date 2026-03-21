import Fastify from 'fastify';
import ejs from 'ejs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { buildV1ProductionBatchTemplateJson } from './test-template-fixtures.js';
import { uiRoutes } from './ui.js';

const viewsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../views/templates');

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
    expect(res.body).toContain('"form"');

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
    expect(res.body).toContain('"form"');

    await app.close();
  });

  it('renders the new canvas builder workspace without promise artifacts', async () => {
    const html = await ejs.renderFile(path.join(viewsDir, 'new.ejs'), {
      errorMessage: '',
      warnings: [],
      builderPreviewHtml: '<div class="card"><h3 class="card-title">Preview Starter</h3></div>',
      workflows: [{ id: 'wf-1', key: 'evidence.group-submit.v1', name: 'Evidence', version: 1 }],
      form: {
        key: '',
        name: '',
        description: '',
        state: 'draft',
        workflow_ref: 'evidence.group-submit.v1',
        template_json: JSON.stringify({ fields: {}, form: { rows: [] }, actions: {} }, null, 2)
      }
    }, {
      async: true,
      views: [viewsDir]
    });

    expect(html).toContain('data-builder-view-tab="builder"');
    expect(html).toContain('data-builder-view-tab="preview"');
    expect(html).toContain('data-builder-view-tab="json"');
    expect(html).toContain('data-builder-view-panel="preview"');
    expect(html).toContain('Template JSON');
    expect(html).toContain('Preview Starter');
    expect(html).toContain('src="/public/template-builder.js"');
    expect(html).toContain('Grid Canvas Workspace');
    expect(html).toContain('data-template-builder');
    expect(html).toContain('data-builder-row-config');
    expect(html).toContain('data-builder-tools');
    expect(html).toContain('data-builder-form-rows');
    expect(html).toContain('data-builder-properties');
    expect(html).toContain('Builder Setup');
    expect(html).not.toContain('[object Promise]');
  });

  it('renders the edit canvas builder workspace without promise artifacts', async () => {
    const html = await ejs.renderFile(path.join(viewsDir, 'edit.ejs'), {
      template: {
        id: 'tpl-1',
        version: 1,
        state: 'draft'
      },
      errorMessage: '',
      warnings: [],
      builderPreviewHtml: '<div class="row"><div class="col"><h1>Production Preview</h1></div></div>',
      workflows: [{ id: 'wf-1', key: 'production.standard.v1', name: 'Production', version: 1 }],
      usedActions: [],
      usedMacros: [],
      missingMacroRefs: [],
      usedApis: [],
      missingApiRefs: [],
      assignedGroups: [],
      assignableGroups: [],
      hasGroups: false,
      form: {
        key: 'production-batch',
        name: 'Production Batch',
        description: 'Reference',
        state: 'draft',
        workflow_ref: 'production.standard.v1',
        template_json: JSON.stringify(buildV1ProductionBatchTemplateJson(), null, 2)
      }
    }, {
      async: true,
      views: [viewsDir]
    });

    expect(html).toContain('data-builder-view-tab="builder"');
    expect(html).toContain('data-builder-view-tab="preview"');
    expect(html).toContain('data-builder-view-tab="json"');
    expect(html).toContain('Preview');
    expect(html).toContain('Production Preview');
    expect(html).toContain('src="/public/template-builder.js"');
    expect(html).toContain('Grid Canvas Workspace');
    expect(html).toContain('data-template-builder');
    expect(html).toContain('data-builder-row-config');
    expect(html).toContain('data-builder-tools');
    expect(html).toContain('data-builder-form-rows');
    expect(html).toContain('data-builder-properties');
    expect(html).toContain('Builder Setup');
    expect(html).toContain('Workflow and References');
    expect(html).not.toContain('[object Promise]');
  });
});
