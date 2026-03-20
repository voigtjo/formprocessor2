import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { NotificationMessage } from '../core/notifications.js';
import { uiRoutes } from './ui.js';

const alice = { id: '00000000-0000-0000-0000-0000000000a1', username: 'alice', displayName: 'Alice' };
const bob = { id: '00000000-0000-0000-0000-0000000000b1', username: 'bob', displayName: 'Bob' };
const docId = '00000000-0000-0000-0000-0000000000d1';
const templateId = '00000000-0000-0000-0000-0000000000t1';
const groupId = '00000000-0000-0000-0000-0000000000g1';

function createAssignmentDb() {
  let editorUserId: string | null = null;
  let approverUserId: string | null = null;
  const publishCalls: NotificationMessage[] = [];

  const db = {
    query: {
      fpDocuments: {
        findFirst: vi.fn(async () => ({
          id: docId,
          templateId,
          groupId,
          status: 'created',
          templateVersion: 1,
          editorUserId,
          approverUserId,
          dataJson: {},
          externalRefsJson: {},
          snapshotsJson: {}
        }))
      },
      fpTemplates: {
        findFirst: vi.fn(async () => ({
          id: templateId,
          key: 'evidence-basic',
          name: 'Evidence Basic',
          templateJson: {
            fields: { note: { kind: 'editable', label: 'Note' } },
            layout: [{ type: 'field', key: 'note' }]
          }
        }))
      },
      fpGroups: {
        findFirst: vi.fn(async () => ({ id: groupId, key: 'ops', name: 'Operations' }))
      },
      fpTemplateAssignments: {
        findMany: vi.fn(async () => [{ id: 'a1', templateId, groupId }])
      },
      fpGroupMembers: {
        findMany: vi.fn(async () => [
          { id: 'm1', groupId, userId: alice.id, rights: 'rwx' },
          { id: 'm2', groupId, userId: bob.id, rights: 'rwx' }
        ])
      }
    },
    update: vi.fn(() => ({
      set: vi.fn((values: any) => ({
        where: vi.fn(async () => {
          if (Object.prototype.hasOwnProperty.call(values, 'editorUserId')) editorUserId = values.editorUserId ?? null;
          if (Object.prototype.hasOwnProperty.call(values, 'approverUserId')) approverUserId = values.approverUserId ?? null;
        })
      }))
    }))
  };

  return {
    db,
    publishCalls,
    notificationGateway: {
      provider: 'noop' as const,
      publish: vi.fn(async (message: NotificationMessage) => {
        publishCalls.push(message);
      })
    }
  };
}

function createSubmitDb() {
  let currentStatus = 'assigned';
  const publishCalls: NotificationMessage[] = [];
  const db = {
    query: {
      fpDocuments: {
        findFirst: vi.fn(async () => ({
          id: docId,
          templateId,
          groupId: null,
          status: currentStatus,
          templateVersion: 1,
          editorUserId: alice.id,
          approverUserId: bob.id,
          dataJson: {},
          externalRefsJson: {},
          snapshotsJson: {}
        }))
      },
      fpTemplates: {
        findFirst: vi.fn(async () => ({
          id: templateId,
          key: 'legacy-notify',
          name: 'Legacy Notify',
          templateJson: {
            fields: {},
            layout: [],
            workflow: {
              initial: 'assigned',
              states: {
                assigned: { editable: [], readonly: [], buttons: ['submit'] },
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
        }))
      },
      fpTemplateAssignments: {
        findMany: vi.fn(async () => [])
      }
    },
    transaction: vi.fn(async (cb: (tx: any) => Promise<void>) => {
      const tx = {
        update: vi.fn(() => ({
          set: vi.fn((values: any) => ({
            where: vi.fn(async () => {
              if (typeof values.status === 'string') currentStatus = values.status;
            })
          }))
        }))
      };
      await cb(tx);
    })
  };
  return {
    db,
    publishCalls,
    notificationGateway: {
      provider: 'noop' as const,
      publish: vi.fn(async (message: NotificationMessage) => {
        publishCalls.push(message);
      })
    }
  };
}

describe('document notifications', () => {
  it('publishes assignment notifications with a deep link', async () => {
    const mock = createAssignmentDb();
    const app = Fastify();
    app.addHook('preHandler', async (request) => {
      request.currentUser = alice;
      request.users = [alice, bob];
      request.tenantContext = { tenantKey: 'default', tenantId: null, source: 'default' } as any;
      request.currentUserContext = null as any;
      request.requestContext = null as any;
    });
    await app.register(uiRoutes, {
      db: mock.db as any,
      erpBaseUrl: 'http://localhost:3001',
      hasDocumentActorColumns: true,
      appBaseUrl: 'http://localhost:3000',
      notificationGateway: mock.notificationGateway
    });

    const editorRes = await app.inject({
      method: 'POST',
      url: `/documents/${docId}/assign/editor`,
      payload: { userId: bob.id }
    });
    expect(editorRes.statusCode).toBe(303);

    const approverRes = await app.inject({
      method: 'POST',
      url: `/documents/${docId}/assign/approver`,
      payload: { userId: bob.id }
    });
    expect(approverRes.statusCode).toBe(303);

    expect(mock.publishCalls.map((item) => item.type)).toEqual(['editor_assigned', 'approver_assigned']);
    expect(mock.publishCalls[0]?.linkUrl).toBe(`http://localhost:3000/documents/${docId}`);
    expect(mock.publishCalls[0]?.recipients?.[0]?.email).toBe(`${bob.id}@example.local`);
    await app.close();
  });

  it('publishes approval-context notifications on submit and final approval', async () => {
    const mock = createSubmitDb();
    let activeUser = alice;
    const app = Fastify();
    app.addHook('preHandler', async (request) => {
      request.currentUser = activeUser;
      request.users = [alice, bob];
      request.tenantContext = { tenantKey: 'default', tenantId: null, source: 'default' } as any;
      request.currentUserContext = null as any;
      request.requestContext = null as any;
    });
    await app.register(uiRoutes, {
      db: mock.db as any,
      erpBaseUrl: 'http://localhost:3001',
      hasDocumentActorColumns: true,
      appBaseUrl: 'http://localhost:3000',
      notificationGateway: mock.notificationGateway
    });

    const submitRes = await app.inject({
      method: 'POST',
      url: `/documents/${docId}/action/submit`,
      payload: {}
    });
    expect(submitRes.statusCode).toBe(303);

    activeUser = bob;
    const approveRes = await app.inject({
      method: 'POST',
      url: `/documents/${docId}/action/approve`,
      payload: {}
    });
    expect(approveRes.statusCode).toBe(303);

    await app.close();
    expect(mock.publishCalls.map((item) => item.type)).toContain('submitted_for_approval');
    expect(mock.publishCalls.map((item) => item.type)).toContain('approved');
  });
});
