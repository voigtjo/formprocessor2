import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * V1 notification boundary.
 * The Core App emits domain notifications, but delivery currently stays in a
 * local Dev Outbox on disk rather than going through SMTP or a notification service.
 */

export type NotificationType =
  | 'editor_assigned'
  | 'approver_assigned'
  | 'submitted_for_approval'
  | 'approved'
  | 'rejected';

export type NotificationRecipient = {
  userId: string;
  displayName: string;
  email: string | null;
};

export type NotificationMessage = {
  type: NotificationType;
  subject: string;
  body: string;
  recipientUserIds: string[];
  recipients?: NotificationRecipient[];
  entityType: 'document';
  entityId: string;
  linkUrl: string;
  tenantKey?: string;
  meta?: Record<string, unknown>;
};

export type NotificationGateway = {
  provider: 'noop' | 'local-outbox';
  publish: (message: NotificationMessage) => Promise<void>;
};

export function createNoopNotificationGateway(): NotificationGateway {
  return {
    provider: 'noop',
    async publish() {
      return;
    }
  };
}

export function createLocalOutboxNotificationGateway(params: {
  rootDir: string;
  logger?: { info?: (payload: unknown, message?: string) => void };
}): NotificationGateway {
  return {
    provider: 'local-outbox',
    async publish(message) {
      await mkdir(params.rootDir, { recursive: true });
      const fileName = `${Date.now()}-${randomUUID()}.json`;
      const filePath = path.join(params.rootDir, fileName);
      const payload = {
        ...message,
        createdAt: new Date().toISOString()
      };
      await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
      params.logger?.info?.(
        {
          notificationType: message.type,
          entityType: message.entityType,
          entityId: message.entityId,
          recipients: message.recipients?.map((item) => ({
            userId: item.userId,
            displayName: item.displayName,
            email: item.email
          })) ?? [],
          linkUrl: message.linkUrl,
          outboxFile: filePath
        },
        'Notification queued in local outbox'
      );
    }
  };
}
