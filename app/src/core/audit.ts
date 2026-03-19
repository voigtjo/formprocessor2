export type AuditEvent = {
  tenantKey: string;
  entityType: 'document';
  entityId: string;
  eventType: string;
  actorUserId: string | null;
  actorDisplay?: string | null;
  summary?: string;
  payload: Record<string, unknown>;
};

export type AuditGateway = {
  provider: 'noop';
  record: (event: AuditEvent) => Promise<void>;
};

export function createNoopAuditGateway(): AuditGateway {
  return {
    provider: 'noop',
    async record() {}
  };
}
