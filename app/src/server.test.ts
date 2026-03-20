import { describe, expect, it, vi } from 'vitest';

vi.mock('./db/index.js', () => {
  const users = [{ id: '00000000-0000-0000-0000-000000000001', username: 'alice', displayName: 'Alice' }];
  return {
    makeDb: () => ({
      db: {
        select: () => ({
          from: () => ({
            orderBy: async () => users
          })
        })
      },
      pool: {
        end: async () => {}
      }
    })
  };
});

describe('server boot smoke', () => {
  it('normalizes attachment upload body-limit errors into a user-facing message', async () => {
    const { normalizeUiErrorMessage } = await import('./server.js');
    expect(
      normalizeUiErrorMessage({
        url: '/documents/doc-1/attachments',
        message: 'Request body is too large',
        statusCode: 413
      })
    ).toBe('Attachment upload is too large. V1 limit is 10 MB per file.');
  });

  it('builds app and serves /health', async () => {
    const { buildApp } = await import('./server.js');
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    await app.close();
  });
});
