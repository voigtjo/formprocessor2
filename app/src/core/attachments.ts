import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type AttachmentStorageSaveInput = {
  tenantKey: string;
  documentId: string;
  attachmentId: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
};

export type AttachmentStorageReadInput = {
  tenantKey: string;
  attachmentKey: string;
};

/**
 * Core boundary only.
 * Storage implementation stays outside the form/workflow core and can later
 * point to local disk, object storage or a dedicated attachment service.
 */
export type AttachmentStorage = {
  provider: 'noop' | 'local';
  save: (input: AttachmentStorageSaveInput) => Promise<{
    attachmentKey: string;
  }>;
  read: (input: AttachmentStorageReadInput) => Promise<Uint8Array | null>;
  remove: (input: AttachmentStorageReadInput) => Promise<void>;
  getDownloadUrl: (input: { tenantKey: string; attachmentKey: string }) => Promise<string | null>;
};

function sanitizePathPart(value: string) {
  return String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'file';
}

function resolveLocalAttachmentPath(rootDir: string, tenantKey: string, documentId: string, attachmentId: string, filename: string) {
  const safeTenant = sanitizePathPart(tenantKey);
  const safeDocument = sanitizePathPart(documentId);
  const safeAttachment = sanitizePathPart(attachmentId);
  const safeFilename = sanitizePathPart(filename);
  return path.join(rootDir, safeTenant, safeDocument, `${safeAttachment}-${safeFilename}`);
}

function resolveLocalReadPath(rootDir: string, tenantKey: string, attachmentKey: string) {
  return path.join(rootDir, sanitizePathPart(tenantKey), ...String(attachmentKey).split('/').map((part) => sanitizePathPart(part)));
}

export function createNoopAttachmentStorage(): AttachmentStorage {
  return {
    provider: 'noop',
    async save(input) {
      return {
        attachmentKey: `${input.documentId}/${input.attachmentId}-${sanitizePathPart(input.filename)}`
      };
    },
    async read() {
      return null;
    },
    async remove() {},
    async getDownloadUrl() {
      return null;
    }
  };
}

export function createLocalAttachmentStorage(params: { rootDir: string }): AttachmentStorage {
  return {
    provider: 'local',
    async save(input) {
      const filePath = resolveLocalAttachmentPath(
        params.rootDir,
        input.tenantKey,
        input.documentId,
        input.attachmentId,
        input.filename
      );
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, Buffer.from(input.bytes));
      return {
        attachmentKey: `${sanitizePathPart(input.documentId)}/${sanitizePathPart(input.attachmentId)}-${sanitizePathPart(input.filename)}`
      };
    },
    async read(input) {
      try {
        const filePath = resolveLocalReadPath(params.rootDir, input.tenantKey, input.attachmentKey);
        return await readFile(filePath);
      } catch {
        return null;
      }
    },
    async remove(input) {
      const filePath = resolveLocalReadPath(params.rootDir, input.tenantKey, input.attachmentKey);
      await rm(filePath, { force: true });
    },
    async getDownloadUrl() {
      return null;
    }
  };
}
