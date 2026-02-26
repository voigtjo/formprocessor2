import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { uiRoutes } from './ui.js';

function createMockDb() {
  const insertSpy = vi.fn();
  const templateFindSpy = vi.fn();

  const db = {
    query: {
      fpTemplates: {
        findFirst: templateFindSpy
      }
    },
    insert: insertSpy
  };

  return { db, insertSpy, templateFindSpy };
}

describe('documents create route', () => {
  it('POST /documents without templateId returns 400 and does not insert', async () => {
    const { db, insertSpy, templateFindSpy } = createMockDb();
    const app = Fastify();
    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001'
    });

    const res = await app.inject({
      method: 'POST',
      url: '/documents',
      payload: {}
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      message: 'Please start from a template. Missing or invalid templateId.'
    });
    expect(templateFindSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();

    await app.close();
  });
});
