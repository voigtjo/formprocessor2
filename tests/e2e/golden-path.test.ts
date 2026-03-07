import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { healthRoutes } from '../../app/src/routes/health.js';
import { uiRoutes } from '../../app/src/routes/ui.js';

const alice = { id: '00000000-0000-0000-0000-0000000000a1', username: 'alice', displayName: 'Alice' };
const bob = { id: '00000000-0000-0000-0000-0000000000b1', username: 'bob', displayName: 'Bob' };
const groupId = '00000000-0000-0000-0000-0000000000a9';
const templateId = '00000000-0000-0000-0000-0000000000a8';
const documentId = '00000000-0000-0000-0000-0000000000a7';

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

function userCookie(userId: string) {
  return `fp_user=${encodeURIComponent(userId)}`;
}

function createMockDb() {
  let doc:
    | {
        id: string;
        templateId: string;
        status: string;
        groupId: string | null;
        dataJson: Record<string, unknown>;
        externalRefsJson: Record<string, unknown>;
        snapshotsJson: Record<string, unknown>;
      }
    | null = null;

  const template = {
    id: templateId,
    key: 'change-request',
    name: 'Change Request',
    state: 'active',
    templateJson: {
      fields: {},
      layout: [{ type: 'button', key: 'reload', action: 'reload' }],
      workflow: {
        initial: 'Assigned',
        states: {
          Assigned: { editable: [], readonly: [], buttons: ['assign', 'start'] },
          Started: { editable: [], readonly: [], buttons: ['submit'] },
          Submitted: { editable: [], readonly: [], buttons: ['approve'] },
          Approved: { editable: [], readonly: [], buttons: [] }
        }
      },
      controls: {
        assign: { label: 'Assign', action: 'assignAction' },
        start: { label: 'Start', action: 'startAction' },
        submit: { label: 'Submit', action: 'submitAction' },
        approve: { label: 'Approve', action: 'approveAction' },
        reload: { label: 'Reload', action: 'reloadAction' }
      },
      actions: {
        assignAction: { type: 'composite', steps: [{ type: 'setStatus', to: 'Assigned' }] },
        startAction: { type: 'composite', steps: [{ type: 'setStatus', to: 'Started' }] },
        submitAction: { type: 'composite', steps: [{ type: 'setStatus', to: 'Submitted' }] },
        approveAction: { type: 'composite', steps: [{ type: 'setStatus', to: 'Approved' }] },
        reloadAction: { type: 'macro', name: 'reloadLookup' }
      },
      permissions: {
        actions: {
          approve: { requires: ['execute'] }
        }
      }
    }
  };

  const db = {
    query: {
      fpTemplates: {
        findMany: async () => [template],
        findFirst: async ({ where }: any) => {
          const whereText = String(where ?? '');
          if (whereText.includes(templateId)) return template;
          return template;
        }
      },
      fpTemplateAssignments: {
        findMany: async () => [{ id: 'as-1', templateId, groupId }]
      },
      fpDocuments: {
        findFirst: async () => (doc ? { ...doc } : null)
      },
      fpGroupMembers: {
        findMany: async () => [
          { id: 'm1', groupId, userId: alice.id, rights: 'rwx' },
          { id: 'm2', groupId, userId: bob.id, rights: 'r' }
        ]
      },
      fpGroups: {
        findFirst: async () => ({ id: groupId, key: 'ops', name: 'Operations' })
      }
    },
    insert: () => ({
      values: (values: any) => ({
        returning: async () => {
          doc = {
            id: documentId,
            templateId: values.templateId,
            status: values.status,
            groupId: values.groupId ?? null,
            dataJson: values.dataJson ?? {},
            externalRefsJson: values.externalRefsJson ?? {},
            snapshotsJson: values.snapshotsJson ?? {}
          };
          return [{ id: documentId }];
        }
      })
    }),
    update: () => ({
      set: (values: any) => ({
        where: async () => {
          if (!doc) return;
          doc = {
            ...doc,
            ...values
          };
        }
      })
    }),
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          orderBy: async () => []
        })
      })
    }),
    transaction: async (cb: (tx: any) => Promise<void>) => {
      const tx = {
        update: () => ({
          set: (values: any) => ({
            where: async () => {
              if (!doc) return;
              doc = {
                ...doc,
                ...values
              };
            }
          })
        })
      };
      await cb(tx);
    }
  };

  return {
    db,
    getDoc: () => doc
  };
}

async function createApp() {
  const mock = createMockDb();
  const app = Fastify();

  app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
    this.type('text/html').send(JSON.stringify(data));
  });

  app.addHook('preHandler', async (request) => {
    const cookie = parseCookie(request.headers.cookie);
    const userId = cookie.fp_user;
    request.users = [alice, bob];
    request.currentUser = userId === bob.id ? bob : alice;
  });

  await app.register(healthRoutes);
  await app.register(uiRoutes, {
    db: mock.db as any,
    erpBaseUrl: 'http://localhost:3001'
  });

  return { app, mock };
}

describe('golden path e2e via inject', () => {
  it('boot smoke + happy path (alice) + deny (bob)', async () => {
    const { app, mock } = await createApp();

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });

    const createRes = await app.inject({
      method: 'POST',
      url: '/documents',
      headers: { cookie: userCookie(alice.id) },
      payload: { templateId }
    });
    expect(createRes.statusCode).toBe(303);
    expect(createRes.headers.location).toBe(`/documents/${documentId}`);
    expect(mock.getDoc()?.status).toBe('Assigned');

    const assignRes = await app.inject({
      method: 'POST',
      url: `/documents/${documentId}/action/assign`,
      headers: { cookie: userCookie(alice.id) },
      payload: {}
    });
    expect(assignRes.statusCode).toBe(303);

    const startRes = await app.inject({
      method: 'POST',
      url: `/documents/${documentId}/action/start`,
      headers: { cookie: userCookie(alice.id) },
      payload: {}
    });
    expect(startRes.statusCode).toBe(303);
    expect(mock.getDoc()?.status).toBe('Started');

    const submitRes = await app.inject({
      method: 'POST',
      url: `/documents/${documentId}/action/submit`,
      headers: { cookie: userCookie(alice.id) },
      payload: {}
    });
    expect(submitRes.statusCode).toBe(303);
    expect(mock.getDoc()?.status).toBe('Submitted');

    const bobApprove = await app.inject({
      method: 'POST',
      url: `/documents/${documentId}/action/approve`,
      headers: { cookie: userCookie(bob.id) },
      payload: {}
    });
    expect(bobApprove.statusCode).toBe(403);

    const aliceApprove = await app.inject({
      method: 'POST',
      url: `/documents/${documentId}/action/approve`,
      headers: { cookie: userCookie(alice.id) },
      payload: {}
    });
    expect(aliceApprove.statusCode).toBe(303);
    expect(['Approved', 'Done']).toContain(String(mock.getDoc()?.status));

    await app.close();
  });
});
