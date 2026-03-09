import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { uiRoutes } from './ui.js';

const opsGroupId = '00000000-0000-0000-0000-0000000000a9';
const alice = { id: '00000000-0000-0000-0000-0000000000a1', username: 'alice', displayName: 'Alice' };
const bob = { id: '00000000-0000-0000-0000-0000000000b1', username: 'bob', displayName: 'Bob' };
const charlie = { id: '00000000-0000-0000-0000-0000000000c1', username: 'charlie', displayName: 'Charlie' };

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

function createWorkflowMockDb() {
  let currentStatus = 'Created';
  let assigneeUserId: string | null = null;
  let reviewerUserId: string | null = null;
  let currentDataJson: Record<string, unknown> = {};

  const template = {
    id: '00000000-0000-0000-0000-0000000000t1',
    key: 'rbac-test-v2',
    name: 'RBAC Test v2',
    templateJson: {
      fields: {
        assignee_user_id: { kind: 'workflow', label: 'Assignee' },
        reviewer_user_id: { kind: 'workflow', label: 'Reviewer' }
      },
      layout: [],
      workflow: {
        initial: 'Created',
        states: {
          Created: { editable: [], readonly: [], buttons: ['assign_editor', 'assign_approver', 'submit'] },
          Assigned: { editable: [], readonly: [], buttons: ['assign_approver', 'submit'] },
          Submitted: { editable: [], readonly: [], buttons: ['approve'] }
        }
      },
      controls: {
        assign_editor: { action: 'assignEditorAction' },
        assign_approver: { action: 'assignApproverAction' },
        submit: { action: 'submitAction' },
        approve: { action: 'approveAction' }
      },
      actions: {
        assignEditorAction: {
          type: 'composite',
          steps: [
            { type: 'setField', key: 'assignee_user_id', value: alice.id },
            { type: 'setStatus', to: 'Assigned' }
          ]
        },
        assignApproverAction: {
          type: 'composite',
          steps: [{ type: 'setField', key: 'reviewer_user_id', value: bob.id }]
        },
        submitAction: {
          type: 'composite',
          steps: [
            { type: 'requireField', key: 'assignee_user_id', message: 'Submit requires editor assignment first.' },
            { type: 'setStatus', to: 'Submitted' }
          ]
        },
        approveAction: {
          type: 'composite',
          steps: [
            { type: 'requireField', key: 'reviewer_user_id', message: 'Approve requires approver assignment first.' },
            { type: 'setStatus', to: 'Approved' }
          ]
        }
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
      fpDocuments: {
        findFirst: async () => ({
          id: '00000000-0000-0000-0000-0000000000d1',
          templateId: template.id,
          groupId: opsGroupId,
          status: currentStatus,
          assigneeUserId,
          reviewerUserId,
          dataJson: currentDataJson,
          externalRefsJson: {},
          snapshotsJson: {}
        })
      },
      fpTemplates: {
        findFirst: async () => template
      },
      fpTemplateAssignments: {
        findMany: async () => []
      },
      fpGroupMembers: {
        findMany: async () => [
          { id: 'm1', groupId: opsGroupId, userId: alice.id, rights: 'rwx' },
          { id: 'm2', groupId: opsGroupId, userId: bob.id, rights: 'rwx' }
        ],
        findFirst: async () => null
      },
      fpGroups: {
        findFirst: async () => ({ id: opsGroupId, key: 'ops', name: 'Operations' })
      }
    },
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: async () => []
          })
        })
      })
    }),
    transaction: async (cb: (tx: any) => Promise<void>) => {
      const tx = {
        update: () => ({
          set: (values: any) => ({
            where: async () => {
              if (typeof values.status === 'string') currentStatus = values.status;
              if (Object.prototype.hasOwnProperty.call(values, 'assigneeUserId')) {
                assigneeUserId = values.assigneeUserId ?? null;
              }
              if (Object.prototype.hasOwnProperty.call(values, 'reviewerUserId')) {
                reviewerUserId = values.reviewerUserId ?? null;
              }
              if (values.dataJson && typeof values.dataJson === 'object') {
                currentDataJson = values.dataJson;
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
    state: () => ({ currentStatus, assigneeUserId, reviewerUserId, currentDataJson })
  };
}

async function createApp(mockDb: any) {
  const app = Fastify();
  app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
    this.type('text/plain').send(String(data.errorMessage ?? 'ok'));
  });
  app.addHook('preHandler', async (request) => {
    const cookies = parseCookie(request.headers.cookie);
    const userId = cookies.fp_user;
    request.users = [alice, bob, charlie];
    request.currentUser = userId === bob.id ? bob : userId === charlie.id ? charlie : alice;
  });
  await app.register(uiRoutes, {
    db: mockDb as any,
    erpBaseUrl: 'http://localhost:3001'
  });
  return app;
}

describe('workplaces / assignment flow', () => {
  it('happy path: assign + submit + approve sets assignee/reviewer columns and completes status', async () => {
    const mock = createWorkflowMockDb();
    const app = await createApp(mock.db);

    const assignRes = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/action/assign_editor',
      headers: { cookie: `fp_user=${encodeURIComponent(alice.id)}` },
      payload: {}
    });
    expect(assignRes.statusCode).toBe(303);
    expect(mock.state().currentStatus).toBe('Assigned');
    expect(mock.state().assigneeUserId).toBe(alice.id);

    const assignApproverRes = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/action/assign_approver',
      headers: { cookie: `fp_user=${encodeURIComponent(alice.id)}` },
      payload: {}
    });
    expect(assignApproverRes.statusCode).toBe(303);
    expect(mock.state().reviewerUserId).toBe(bob.id);
    expect((mock.state().currentDataJson as any).assignee_user_id).toBeUndefined();
    expect((mock.state().currentDataJson as any).reviewer_user_id).toBeUndefined();

    const submitRes = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/action/submit',
      headers: { cookie: `fp_user=${encodeURIComponent(alice.id)}` },
      payload: {}
    });
    expect(submitRes.statusCode).toBe(303);
    expect(mock.state().currentStatus).toBe('Submitted');

    const approveRes = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/action/approve',
      headers: { cookie: `fp_user=${encodeURIComponent(bob.id)}` },
      payload: {}
    });
    expect(approveRes.statusCode).toBe(303);
    expect(mock.state().currentStatus).toBe('Approved');

    await app.close();
  });

  it('deny: non-member cannot open group workspace', async () => {
    const mock = createWorkflowMockDb();
    const app = await createApp(mock.db);

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/groups/${opsGroupId}`,
      headers: { cookie: `fp_user=${encodeURIComponent(charlie.id)}` }
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain('Forbidden');
    await app.close();
  });

  it('submit fails with friendly message when editor is not set', async () => {
    const mock = createWorkflowMockDb();
    const app = await createApp(mock.db);

    const res = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/action/submit',
      headers: { cookie: `fp_user=${encodeURIComponent(alice.id)}` },
      payload: {}
    });

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toContain('/documents/00000000-0000-0000-0000-0000000000d1?error=');
    expect(String(res.headers.location)).toContain('Submit+requires+editor+assignment+first.');
    await app.close();
  });

  it('approve fails with friendly message when approver is not set', async () => {
    const mock = createWorkflowMockDb();
    const app = await createApp(mock.db);

    const assignEditorRes = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/action/assign_editor',
      headers: { cookie: `fp_user=${encodeURIComponent(alice.id)}` },
      payload: {}
    });
    expect(assignEditorRes.statusCode).toBe(303);

    const submitRes = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/action/submit',
      headers: { cookie: `fp_user=${encodeURIComponent(alice.id)}` },
      payload: {}
    });
    expect(submitRes.statusCode).toBe(303);

    const approveRes = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/action/approve',
      headers: { cookie: `fp_user=${encodeURIComponent(bob.id)}` },
      payload: {}
    });
    expect(approveRes.statusCode).toBe(303);
    expect(approveRes.headers.location).toContain('/documents/00000000-0000-0000-0000-0000000000d1?error=');
    expect(String(approveRes.headers.location)).toContain('Approve+requires+approver+assignment+first.');

    await app.close();
  });

  it('shows friendly guidance when document actor columns are unavailable', async () => {
    const mock = createWorkflowMockDb();
    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      this.type('text/plain').send(String(data.tasksUnavailableMessage ?? ''));
    });
    app.addHook('preHandler', async (request) => {
      request.users = [alice, bob, charlie];
      request.currentUser = alice;
    });
    await app.register(uiRoutes, {
      db: mock.db as any,
      erpBaseUrl: 'http://localhost:3001',
      hasDocumentActorColumns: false
    });

    const res = await app.inject({
      method: 'GET',
      url: '/workspaces/me',
      headers: { cookie: `fp_user=${encodeURIComponent(alice.id)}` }
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Run: cd app && npm run db:push');
    await app.close();
  });

  it('shows my tasks by assignee/reviewer and status rules', async () => {
    const aliceMemberships = [{ groupId: opsGroupId, rights: 'rwx', groupKey: 'ops', groupName: 'Operations' }];
    const bobMemberships = [{ groupId: opsGroupId, rights: 'rwx', groupKey: 'ops', groupName: 'Operations' }];
    const taskRows = [
      {
        id: 'd-created',
        createdAt: new Date().toISOString(),
        status: 'created',
        assigneeUserId: alice.id,
        reviewerUserId: bob.id,
        groupId: opsGroupId,
        groupName: 'Operations',
        templateKey: 'rbac-test-v2',
        templateName: 'RBAC Test v2'
      },
      {
        id: 'd-assigned',
        createdAt: new Date().toISOString(),
        status: 'assigned',
        assigneeUserId: alice.id,
        reviewerUserId: bob.id,
        groupId: opsGroupId,
        groupName: 'Operations',
        templateKey: 'rbac-test-v2',
        templateName: 'RBAC Test v2'
      },
      {
        id: 'd-submitted',
        createdAt: new Date().toISOString(),
        status: 'submitted',
        assigneeUserId: alice.id,
        reviewerUserId: bob.id,
        groupId: opsGroupId,
        groupName: 'Operations',
        templateKey: 'rbac-test-v2',
        templateName: 'RBAC Test v2'
      },
      {
        id: 'd-approved',
        createdAt: new Date().toISOString(),
        status: 'approved',
        assigneeUserId: alice.id,
        reviewerUserId: bob.id,
        groupId: opsGroupId,
        groupName: 'Operations',
        templateKey: 'rbac-test-v2',
        templateName: 'RBAC Test v2'
      }
    ];
    let selectCall = 0;
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              orderBy: async () => {
                selectCall += 1;
                if (selectCall === 1) return aliceMemberships;
                if (selectCall === 2) return taskRows;
                if (selectCall === 3) return bobMemberships;
                return taskRows;
              }
            }),
            leftJoin: () => ({
              where: () => ({
                orderBy: async () => {
                  selectCall += 1;
                  if (selectCall === 1) return aliceMemberships;
                  if (selectCall === 2) return taskRows;
                  if (selectCall === 3) return bobMemberships;
                  return taskRows;
                }
              })
            })
          })
        })
      })
    };

    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      this.type('application/json').send({ tasks: data.tasks ?? [] });
    });
    app.addHook('preHandler', async (request) => {
      const cookies = parseCookie(request.headers.cookie);
      const userId = cookies.fp_user;
      request.users = [alice, bob];
      request.currentUser = userId === bob.id ? bob : alice;
    });
    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001',
      hasDocumentActorColumns: true
    });

    const aliceRes = await app.inject({
      method: 'GET',
      url: '/workspaces/me',
      headers: { cookie: `fp_user=${encodeURIComponent(alice.id)}` }
    });
    expect(aliceRes.statusCode).toBe(200);
    const aliceTasks = (aliceRes.json() as any).tasks as Array<{ id: string; role: string }>;
    expect(aliceTasks.map((item) => item.id)).toEqual(['d-assigned', 'd-created', 'd-submitted', 'd-approved']);
    expect(aliceTasks.every((item) => item.role === 'Editor')).toBe(true);
    const aliceById = new Map(
      aliceTasks.map((item) => [item.id, item as { id: string; role: string; taskState: string; status: string }])
    );
    expect(aliceById.get('d-assigned')?.taskState).toBe('open');
    expect(aliceById.get('d-submitted')?.taskState).toBe('done');

    const bobRes = await app.inject({
      method: 'GET',
      url: '/workspaces/me',
      headers: { cookie: `fp_user=${encodeURIComponent(bob.id)}` }
    });
    expect(bobRes.statusCode).toBe(200);
    const bobTasks = (bobRes.json() as any).tasks as Array<{ id: string; role: string; taskState: string; status: string }>;
    expect(bobTasks.every((item) => item.role === 'Approver')).toBe(true);
    const bobById = new Map(bobTasks.map((item) => [item.id, item]));
    expect(bobById.get('d-submitted')?.taskState).toBe('open');
    expect(bobById.get('d-approved')?.taskState).toBe('done');

    await app.close();
  });
});
