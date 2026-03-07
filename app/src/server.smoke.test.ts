import { describe, expect, it, vi } from 'vitest';

vi.mock('./db/index.js', () => {
  const users: Array<{ id: string; username: string; displayName: string }> = [];
  const rowsChain = {
    orderBy: async () => users,
    where: () => rowsChain,
    innerJoin: () => rowsChain,
    leftJoin: () => rowsChain
  };
  return {
    makeDb: () => ({
      db: {
        select: () => ({
          from: () => rowsChain
        })
      },
      pool: {
        end: async () => {}
      }
    })
  };
});

describe('server smoke', () => {
  it('boots and serves /health, / and /workspaces/me without crashing', async () => {
    const { buildApp } = await import('./server.js');
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const rootRes = await app.inject({ method: 'GET', url: '/' });
    expect(rootRes.statusCode).toBe(302);
    expect(rootRes.headers.location).toBe('/templates');

    const workspaceRes = await app.inject({
      method: 'GET',
      url: '/workspaces/me',
      headers: { accept: 'text/html' }
    });
    expect(workspaceRes.statusCode).toBe(403);
    expect(workspaceRes.body).toContain('No active user');

    await app.close();
  });
});
