import Fastify from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalAttachmentStorage } from '../core/attachments.js';
import { uiRoutes } from './ui.js';
import { buildV1MinimalEvidenceTemplateJson } from './test-template-fixtures.js';
import { normalizeUiErrorMessage } from '../server.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('document attachments', () => {
  it('uploads an attachment and persists metadata', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'fp-attachments-route-'));
    tempDirs.push(rootDir);
    const attachmentStorage = createLocalAttachmentStorage({ rootDir });
    const insertedValues: Array<Record<string, unknown>> = [];

    const db = {
      query: {
        fpDocuments: {
          findFirst: vi.fn(async () => ({
            id: '00000000-0000-0000-0000-0000000000d1',
            templateId: 'tpl-1',
            status: 'assigned',
            groupId: null,
            dataJson: {},
            externalRefsJson: {},
            snapshotsJson: {},
            templateVersion: 1
          }))
        },
        fpDocumentAttachments: {
          findMany: vi.fn(async () => []),
          findFirst: vi.fn(async () => null)
        },
        fpTemplateAssignments: {
          findMany: vi.fn(async () => [])
        }
      },
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => {
          insertedValues.push(values);
          return { returning: vi.fn(async () => [values]) };
        })
      }))
    };

    const app = Fastify();
    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001',
      hasDocumentActorColumns: true,
      hasDocumentTemplateVersion: true,
      hasDocumentAttachments: true,
      attachmentStorage
    });

    const response = await app.inject({
      method: 'POST',
      url: '/documents/00000000-0000-0000-0000-0000000000d1/attachments',
      payload: {
        filename: 'evidence.png',
        contentType: 'image/png',
        base64Data: Buffer.from('image-proof').toString('base64'),
        kind: 'image'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({
      documentId: '00000000-0000-0000-0000-0000000000d1',
      filename: 'evidence.png',
      kind: 'image',
      mimeType: 'image/png',
      size: 11
    });

    await app.close();
  });

  it('serves attachment content with the stored mime type', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'fp-attachments-content-'));
    tempDirs.push(rootDir);
    const attachmentStorage = createLocalAttachmentStorage({ rootDir });
    const saved = await attachmentStorage.save({
      tenantKey: 'default',
      documentId: 'doc-1',
      attachmentId: 'att-1',
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      bytes: Buffer.from('jpeg-bytes')
    });

    const db = {
      query: {
        fpDocumentAttachments: {
          findFirst: vi.fn(async () => ({
            id: 'att-1',
            documentId: 'doc-1',
            kind: 'image',
            filename: 'photo.jpg',
            mimeType: 'image/jpeg',
            size: 10,
            storageKey: saved.attachmentKey,
            uploadedBy: null,
            createdAt: new Date()
          }))
        },
        fpDocuments: {
          findFirst: vi.fn(async () => ({
            id: '00000000-0000-0000-0000-0000000000d1',
            templateId: 'tpl-1',
            status: 'assigned',
            groupId: null,
            dataJson: {},
            externalRefsJson: {},
            snapshotsJson: {},
            templateVersion: 1
          }))
        },
        fpTemplateAssignments: {
          findMany: vi.fn(async () => [])
        }
      }
    };

    const app = Fastify();
    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001',
      hasDocumentActorColumns: true,
      hasDocumentTemplateVersion: true,
      hasDocumentAttachments: true,
      attachmentStorage
    });

    const response = await app.inject({
      method: 'GET',
      url: '/attachments/att-1/content'
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(response.body).toBe('jpeg-bytes');

    await app.close();
  });

  it('maps oversized upload failures to a friendly attachment message', () => {
    expect(
      normalizeUiErrorMessage({
        url: '/documents/00000000-0000-0000-0000-0000000000d1/attachments',
        message: 'Request body is too large',
        statusCode: 413
      })
    ).toBe('Attachment upload is too large. V1 limit is 10 MB per file.');
  });

  it('renders attachments on the document detail page', async () => {
    const db = {
      query: {
        fpDocuments: {
          findFirst: vi.fn(async () => ({
            id: 'doc-1',
            templateId: 'tpl-1',
            status: 'assigned',
            groupId: null,
            editorUserId: null,
            approverUserId: null,
            dataJson: {},
            externalRefsJson: {},
            snapshotsJson: {},
            templateVersion: 1
          }))
        },
        fpTemplates: {
          findFirst: vi.fn(async () => ({
            id: 'tpl-1',
            key: 'evidence-basic',
            name: 'Evidence Basic',
            workflowRef: 'evidence.group-submit.v1',
            templateJson: buildV1MinimalEvidenceTemplateJson()
          }))
        },
        fpWorkflows: {
          findMany: vi.fn(async () => [
            { id: 'wf-1', key: 'evidence.group-submit.v1', name: 'Evidence Group Submit', version: 1, workflowJson: { states: {} } }
          ])
        },
        fpTemplateAssignments: {
          findMany: vi.fn(async () => [])
        },
        fpDocumentEditors: {
          findMany: vi.fn(async () => [])
        },
        fpDocumentApprovals: {
          findMany: vi.fn(async () => [])
        },
        fpDocumentSubmissions: {
          findMany: vi.fn(async () => [])
        },
        fpDocumentAttachments: {
          findMany: vi.fn(async () => [
            {
              id: 'att-1',
              documentId: '00000000-0000-0000-0000-0000000000d1',
              kind: 'image',
              filename: 'proof.png',
              mimeType: 'image/png',
              size: 1024,
              storageKey: 'doc-1/att-1-proof.png',
              uploadedBy: 'u1',
              createdAt: new Date('2026-03-19T12:00:00Z')
            }
          ])
        },
        fpUsers: {
          findMany: vi.fn(async () => [{ id: 'u1', username: 'alice', displayName: 'Alice' }])
        }
      },
      select: vi.fn(() => ({
        from: () => ({
          where: async () => []
        })
      }))
    };

    const app = Fastify();
    app.decorateReply('renderPage', async function renderPage(_view: string, data: Record<string, unknown> = {}) {
      const attachments = Array.isArray(data.attachments) ? (data.attachments as Array<Record<string, unknown>>) : [];
      this.type('text/plain').send(
        attachments
          .map((item) => `${String(item.filename)}|${String(item.kind)}|${String(item.uploadedByName)}|${String(item.contentUrl)}`)
          .join('\n')
      );
    });
    await app.register(uiRoutes, {
      db: db as any,
      erpBaseUrl: 'http://localhost:3001',
      hasDocumentActorColumns: true,
      hasDocumentTemplateVersion: true,
      hasDocumentMultiAssignments: true,
      hasDocumentAttachments: true
    });

    const response = await app.inject({
      method: 'GET',
      url: '/documents/00000000-0000-0000-0000-0000000000d1'
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('proof.png|image|Alice|/attachments/att-1/content');

    await app.close();
  });
});
