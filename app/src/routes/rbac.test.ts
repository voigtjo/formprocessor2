import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { uiRoutes } from './ui.js';

const alice = { id: '00000000-0000-0000-0000-0000000000a1', username: 'alice', displayName: 'Alice' };
const bob = { id: '00000000-0000-0000-0000-0000000000b1', username: 'bob', displayName: 'Bob' };

function parseCookie(cookieHeader: string | undefined) {
  if (!cookieHeader) return {} as Record<string, string>;
  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const i = part.indexOf('=');
        if (i === -1) return [part, ''];
        return [part.slice(0, i), decodeURIComponent(part.slice(i + 1))];
      })
  );
}

function createMockDb(rightsForAlice = 'rwx', rightsForBob = 'r') {
  return {
    query: {
      fpDocuments: {
        findFirst: async () => ({
          id: '00000000-0000-0000-0000-0000000000d1',
          templateId: '00000000-0000-0000-0000-0000000000t1',
          status: 'Started',
          dataJson: {},
          externalRefsJson: {},
          snapshotsJson: {}
        })
      },
      fpTemplates: {
        findFirst: async () => ({
          id: '00000000-0000-0000-0000-0000000000t1',
          key: 'customer-order',
          name: 'Customer Order',
          templateJson: {
            fields: {},
            layout: [],
            workflow: {
              initial: 'Started',
              states: {
                Started: {
                  editable: [],
                  readonly: [],
                  buttons: ['approve']
                }
              }
            },
            controls: {
              approve: { label: 'Approve', action: 'approveAction' }
            },
            actions: {
              approveAction: { type: 'composite', steps: [{ type: 'setStatus', to: 'Approved' }] }
            },
            permissions: {
              actions: {
                approve: { requires: ['execute'] }
              }
            }
          }
        })
      },
      fpTemplateAssignments: {
        findMany: async () => [
          {
            id: '00000000-0000-0000-0000-0000000000as',
            templateId: '00000000-0000-0000-0000-0000000000t1',
            groupId: '00000000-0000-0000-0000-0000000000g1'
          }
        ]
      },
      fpGroupMembers: {
        findMany: async () => [
          { id: 'm1', groupId: 'g1', userId: alice.id, rights: rightsForAlice },
          { id: 'm2', groupId: 'g1', userId: bob.id, rights: rightsForBob }
        ]
      }
    },
    transaction: async (cb: (tx: any) => Promise<void>) => {
      const tx = {
        update: () => ({
          set: () => ({
            where: async () => {}
          })
        })
      };
      await cb(tx);
    }
  };
}

async function createApp(mockDb: any) {
  const app = Fastify();

  app.addHook('preHandler', async (request) => {
    const cookies = parseCookie(request.headers.cookie);
    const userId = cookies.fp_user;
    request.users = [alice, bob];
    request.currentUser = userId === bob.id ? bob : alice;
  });

  await app.register(uiRoutes, {
    db: mockDb as any,
    erpBaseUrl: 'http://localhost:3001'
  });

  return app;
}

describe('RBAC action permissions', () => {
  it('allows alice (rwx) to execute execute-protected action', async () => {
    const app = await createApp(createMockDb('rwx', 'r'));
    const res = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/action/approve',
      headers: {
        cookie: `fp_user=${encodeURIComponent(alice.id)}`
      },
      payload: {}
    });

    expect(res.statusCode).toBe(303);
    await app.close();
  });

  it('denies bob (r) for execute-protected action with 403', async () => {
    const app = await createApp(createMockDb('rwx', 'r'));
    const res = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/action/approve',
      headers: {
        cookie: `fp_user=${encodeURIComponent(bob.id)}`
      },
      payload: {}
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain('Missing rights');
    expect(res.json().message).toContain('Required: x');
    expect(res.json().message).toContain('User rights: r');
    await app.close();
  });
});
