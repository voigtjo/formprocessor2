import Fastify from 'fastify';
import ejs from 'ejs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { uiRoutes } from './ui.js';

const groupId = '00000000-0000-0000-0000-0000000000a9';
const templateId = '00000000-0000-0000-0000-0000000000t1';
const alice = { id: '00000000-0000-0000-0000-0000000000a1', username: 'alice', displayName: 'Alice' };
const bob = { id: '00000000-0000-0000-0000-0000000000b1', username: 'bob', displayName: 'Bob' };
const charly = { id: '00000000-0000-0000-0000-0000000000c1', username: 'charly', displayName: 'Charly' };
const viewer = { id: '00000000-0000-0000-0000-0000000000d1', username: 'viewer', displayName: 'Viewer' };
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

function createMockDb(
  aliceRights = 'rwx',
  bobRights = 'r',
  charlyRights = 'rw',
  viewerRights = 'r',
  docGroupId: string | null = groupId
) {
  let currentStatus = 'created';
  let editorUserId: string | null = null;
  let approverUserId: string | null = null;
  const doc = {
    id: '00000000-0000-0000-0000-0000000000d1',
    templateId,
    groupId: docGroupId,
    status: currentStatus,
    templateVersion: 1,
    editorUserId,
    approverUserId,
    dataJson: {},
    externalRefsJson: {},
    snapshotsJson: {}
  };
  const updates: Array<Record<string, unknown>> = [];

  const db = {
    query: {
      fpDocuments: {
        findFirst: async () => ({ ...doc, status: currentStatus, editorUserId, approverUserId })
      },
      fpTemplates: {
        findFirst: async () => ({
          id: templateId,
          key: 'rbac-test-v2',
          name: 'RBAC Test v2',
          templateJson: {
            fields: {
              title: { kind: 'editable', label: 'Title' }
            },
            layout: [{ type: 'field', key: 'title' }],
            workflow: {
              initial: 'created',
              order: ['created', 'assigned', 'submitted', 'approved'],
              states: {
                created: { editable: ['title'], readonly: [], buttons: ['submit'] },
                submitted: { editable: [], readonly: [], buttons: ['approve'] },
                approved: { editable: [], readonly: [], buttons: [] }
              }
            },
            controls: {
              submit: { action: 'submitAction' },
              approve: { action: 'approveAction' }
            },
            actions: {
              submitAction: { type: 'composite', steps: [{ type: 'setStatus', to: 'submitted' }] },
              approveAction: { type: 'composite', steps: [{ type: 'setStatus', to: 'approved' }] }
            }
          }
        })
      },
      fpGroups: {
        findFirst: async () => ({ id: groupId, key: 'ops', name: 'Operations' })
      },
      fpTemplateAssignments: {
        findMany: async () => [{ id: 'as1', templateId, groupId }]
      },
      fpGroupMembers: {
        findMany: async () => [
          { id: 'm1', groupId, userId: alice.id, rights: aliceRights },
          { id: 'm2', groupId, userId: bob.id, rights: bobRights },
          { id: 'm3', groupId, userId: charly.id, rights: charlyRights },
          { id: 'm4', groupId, userId: viewer.id, rights: viewerRights }
        ]
      }
    },
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: async () => [
              {
                userId: alice.id,
                rights: aliceRights,
                username: alice.username,
                displayName: alice.displayName
              },
              {
                userId: bob.id,
                rights: bobRights,
                username: bob.username,
                displayName: bob.displayName
              },
              {
                userId: charly.id,
                rights: charlyRights,
                username: charly.username,
                displayName: charly.displayName
              },
              {
                userId: viewer.id,
                rights: viewerRights,
                username: viewer.username,
                displayName: viewer.displayName
              }
            ]
          })
        })
      })
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
          if (Object.prototype.hasOwnProperty.call(values, 'editorUserId')) {
            editorUserId = (values.editorUserId as string | null) ?? null;
          }
          if (Object.prototype.hasOwnProperty.call(values, 'approverUserId')) {
            approverUserId = (values.approverUserId as string | null) ?? null;
          }
        }
      })
    }),
    transaction: async (cb: (tx: any) => Promise<void>) => {
      const tx = {
        update: () => ({
          set: (values: Record<string, unknown>) => ({
            where: async () => {
              updates.push(values);
              if (typeof values.status === 'string') {
                currentStatus = values.status;
              }
              if (Object.prototype.hasOwnProperty.call(values, 'editorUserId')) {
                editorUserId = (values.editorUserId as string | null) ?? null;
              }
              if (Object.prototype.hasOwnProperty.call(values, 'approverUserId')) {
                approverUserId = (values.approverUserId as string | null) ?? null;
              }
            }
          })
        })
      };
      await cb(tx);
    }
  };

  return {
    db,
    state: () => ({ currentStatus, editorUserId, approverUserId, updates })
  };
}

async function createApp(mockDb: any) {
  const app = Fastify();
  app.decorateReply('renderPage', async function renderPage(view: string, data: Record<string, unknown> = {}) {
    const viewsDir = path.resolve(__dirname, '../views');
    const html = await ejs.renderFile(path.join(viewsDir, view), data, {
      async: true,
      views: [viewsDir]
    });
    this.type('text/html').send(html);
  });
  app.addHook('preHandler', async (request) => {
    const cookies = parseCookie(request.headers.cookie);
    const userId = cookies.fp_user;
    request.users = [alice, bob, charly, viewer];
    request.currentUser = userId === bob.id ? bob : userId === charly.id ? charly : userId === viewer.id ? viewer : alice;
  });
  await app.register(uiRoutes, {
    db: mockDb as any,
    erpBaseUrl: 'http://localhost:3001',
    hasDocumentActorColumns: true
  });
  return app;
}

describe('document assignments routes', () => {
  it('happy: alice sets editor=charly (rw) and approver=bob (rwx)', async () => {
    const mock = createMockDb('rwx', 'rwx', 'rw', 'r');
    const app = await createApp(mock.db);

    const setEditor = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/assign/editor',
      headers: { cookie: `fp_user=${encodeURIComponent(alice.id)}` },
      payload: { userId: charly.id }
    });
    expect(setEditor.statusCode).toBe(303);
    expect(mock.state().editorUserId).toBe(charly.id);

    const setApprover = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/assign/approver',
      headers: { cookie: `fp_user=${encodeURIComponent(alice.id)}` },
      payload: { userId: bob.id }
    });
    expect(setApprover.statusCode).toBe(303);
    expect(mock.state().approverUserId).toBe(bob.id);

    await app.close();
  });

  it('happy: alice assigns, then charly submits, then bob approves', async () => {
    const mock = createMockDb('rwx', 'rwx', 'rw', 'r');
    const app = await createApp(mock.db);

    const setEditor = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/assign/editor',
      headers: { cookie: `fp_user=${encodeURIComponent(alice.id)}` },
      payload: { userId: charly.id }
    });
    expect(setEditor.statusCode).toBe(303);

    const setApprover = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/assign/approver',
      headers: { cookie: `fp_user=${encodeURIComponent(alice.id)}` },
      payload: { userId: bob.id }
    });
    expect(setApprover.statusCode).toBe(303);

    const submitRes = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/action/submit',
      headers: { cookie: `fp_user=${encodeURIComponent(charly.id)}` },
      payload: {}
    });
    expect(submitRes.statusCode).toBe(303);
    expect(mock.state().currentStatus).toBe('submitted');

    const approveRes = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/action/approve',
      headers: { cookie: `fp_user=${encodeURIComponent(bob.id)}` },
      payload: {}
    });
    expect(approveRes.statusCode).toBe(303);
    expect(mock.state().currentStatus).toBe('approved');

    await app.close();
  });

  it('deny: bob without execute cannot set assignments', async () => {
    const mock = createMockDb('rwx', 'r');
    const app = await createApp(mock.db);

    const setEditor = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/assign/editor',
      headers: { cookie: `fp_user=${encodeURIComponent(bob.id)}` },
      payload: { userId: alice.id }
    });

    expect(setEditor.statusCode).toBe(403);
    expect(mock.state().editorUserId).toBeNull();
    await app.close();
  });

  it('deny: viewer with read-only rights is not listed as approver and endpoint rejects forced request', async () => {
    const mock = createMockDb('rwx', 'rwx', 'rw', 'r');
    const app = await createApp(mock.db);

    const detail = await app.inject({
      method: 'GET',
      url: '/documents/00000000-0000-0000-0000-0000000000d1',
      headers: { cookie: `fp_user=${encodeURIComponent(alice.id)}` }
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).not.toContain('Viewer (@viewer)');

    const setApprover = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/assign/approver',
      headers: {
        cookie: `fp_user=${encodeURIComponent(viewer.id)}`,
        accept: 'text/html',
        referer: '/documents/00000000-0000-0000-0000-0000000000d1'
      },
      payload: { userId: bob.id }
    });
    expect(setApprover.statusCode).toBe(403);
    expect(setApprover.body).toContain('Forbidden: requires execute (x), user has r');
    expect(setApprover.body).toContain('Back');
    expect(setApprover.body).toContain('href="/documents/00000000-0000-0000-0000-0000000000d1"');
    expect(mock.state().approverUserId).toBeNull();

    await app.close();
  });

  it('uses template assignment group context when document.groupId is null', async () => {
    const mock = createMockDb('rwx', 'rwx', 'rw', 'r', null);
    const app = await createApp(mock.db);

    const setEditor = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/assign/editor',
      headers: { cookie: `fp_user=${encodeURIComponent(alice.id)}` },
      payload: { userId: charly.id }
    });

    expect(setEditor.statusCode).toBe(303);
    expect(mock.state().editorUserId).toBe(charly.id);
    await app.close();
  });
});
