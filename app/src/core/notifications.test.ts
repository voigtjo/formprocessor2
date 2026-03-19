import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalOutboxNotificationGateway } from './notifications.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('local outbox notifications', () => {
  it('writes notification payloads to the local outbox', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'fp-notifications-'));
    tempDirs.push(rootDir);
    const gateway = createLocalOutboxNotificationGateway({ rootDir });

    await gateway.publish({
      type: 'editor_assigned',
      subject: 'Assigned as editor',
      body: 'Please review the document.',
      recipientUserIds: ['u1'],
      recipients: [{ userId: 'u1', displayName: 'Alice', email: 'alice@example.local' }],
      entityType: 'document',
      entityId: 'doc-1',
      linkUrl: 'http://localhost:3000/documents/doc-1'
    });

    const files = await (await import('node:fs/promises')).readdir(rootDir);
    expect(files).toHaveLength(1);
    const payload = JSON.parse(await readFile(path.join(rootDir, files[0]!), 'utf8'));
    expect(payload.type).toBe('editor_assigned');
    expect(payload.linkUrl).toBe('http://localhost:3000/documents/doc-1');
    expect(payload.recipients[0].email).toBe('alice@example.local');
  });
});
