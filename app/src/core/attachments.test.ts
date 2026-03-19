import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalAttachmentStorage } from './attachments.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('local attachment storage', () => {
  it('saves and reads attachment bytes from local disk', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'fp-attachments-'));
    tempDirs.push(rootDir);
    const storage = createLocalAttachmentStorage({ rootDir });

    const saved = await storage.save({
      tenantKey: 'default',
      documentId: 'doc-1',
      attachmentId: 'att-1',
      filename: 'proof image.png',
      contentType: 'image/png',
      bytes: Buffer.from('hello-image')
    });

    expect(saved.attachmentKey).toContain('doc-1/att-1-proof-image.png');

    const bytes = await storage.read({
      tenantKey: 'default',
      attachmentKey: saved.attachmentKey
    });

    expect(Buffer.from(bytes ?? []).toString('utf8')).toBe('hello-image');
  });
});
