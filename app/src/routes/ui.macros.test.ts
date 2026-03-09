import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { uiRoutes } from './ui.js';

function createMacroDb() {
  const macros: Array<any> = [
    {
      ref: 'macro:erp/createBatch@1',
      namespace: 'erp',
      name: 'createBatch',
      version: 1,
      kind: 'json',
      isEnabled: true,
      description: 'Create batch',
      paramsSchemaJson: null,
      definitionJson: { steps: [] },
      codeText: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  const db = {
    select: () => ({
      from: () => ({
        orderBy: async () => macros,
        where: () => ({
          limit: async () => macros.slice(0, 1)
        })
      })
    }),
    query: {
      fpMacros: {
        findFirst: async () => macros[0] ?? null
      }
    },
    insert: () => ({
      values: async (values: any) => {
        macros.push({
          ...values,
          createdAt: values.createdAt ?? new Date().toISOString(),
          updatedAt: values.updatedAt ?? new Date().toISOString()
        });
      }
    }),
    update: () => ({
      set: (values: any) => ({
        where: async () => {
          if (!macros[0]) return;
          macros[0] = { ...macros[0], ...values };
        }
      })
    })
  };

  return { db, macros };
}

describe('macros ui', () => {
  it('renders macro list page', async () => {
    const { db } = createMacroDb();
    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(view: string, data: Record<string, unknown> = {}) {
      this.type('application/json').send({ view, data });
    });
    await app.register(uiRoutes, { db: db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({ method: 'GET', url: '/macros' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.view).toBe('macros/list.ejs');
    expect(body.data.macros[0].ref).toBe('macro:erp/createBatch@1');

    await app.close();
  });

  it('creates a macro row from form data', async () => {
    const { db, macros } = createMacroDb();
    const app = Fastify();
    await app.register(uiRoutes, { db: db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'POST',
      url: '/macros',
      payload: {
        ref: 'macro:test/new@1',
        namespace: 'test',
        name: 'newMacro',
        version: '1',
        enabled: '1',
        kind: 'json',
        description: 'Test macro',
        params_schema_json: '{"type":"object"}',
        definition_json: '{"steps":[{"type":"noop"}]}',
        code_text: ''
      }
    });

    expect(res.statusCode).toBe(303);
    expect(macros.some((item) => item.ref === 'macro:test/new@1')).toBe(true);
    const created = macros.find((item) => item.ref === 'macro:test/new@1');
    expect(created?.definitionJson).toEqual({ steps: [{ type: 'noop' }] });

    await app.close();
  });

  it('edits an existing macro row', async () => {
    const { db, macros } = createMacroDb();
    const app = Fastify();
    await app.register(uiRoutes, { db: db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'POST',
      url: `/macros/${encodeURIComponent('macro:erp/createBatch@1')}`,
      payload: {
        ref: 'macro:erp/createBatch@1',
        namespace: 'erp',
        name: 'createBatch',
        version: '1',
        kind: 'json',
        description: 'Updated description',
        definition_json: '{"steps":[{"type":"macro"}]}',
        params_schema_json: '',
        code_text: '/* saved only */'
      }
    });

    expect(res.statusCode).toBe(303);
    expect(macros[0].description).toBe('Updated description');
    expect(macros[0].definitionJson).toEqual({ steps: [{ type: 'macro' }] });

    await app.close();
  });

  it('returns validation error on invalid definition_json', async () => {
    const { db } = createMacroDb();
    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(view: string, data: Record<string, unknown> = {}) {
      this.type('application/json').send({ view, data });
    });
    await app.register(uiRoutes, { db: db as any, erpBaseUrl: 'http://localhost:3001' });

    const res = await app.inject({
      method: 'POST',
      url: '/macros',
      payload: {
        ref: 'macro:test/invalid@1',
        namespace: 'test',
        name: 'bad',
        version: '1',
        kind: 'json',
        definition_json: '{bad json'
      }
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as any;
    expect(body.view).toBe('macros/new.ejs');
    expect(String(body.data.errorMessage)).toContain('definition_json must be valid JSON');

    await app.close();
  });
});
