import { describe, expect, it } from 'vitest';
import { buildCoreRequestContext, buildCurrentUserContext, buildDefaultTenantContext } from './request-context.js';

describe('core request context', () => {
  it('builds a default tenant context for local core runtime', () => {
    expect(buildDefaultTenantContext()).toEqual({
      tenantKey: 'default',
      tenantId: null,
      source: 'default'
    });
  });

  it('builds an anonymous current user context when no local user exists', () => {
    expect(buildCurrentUserContext(null)).toEqual({
      kind: 'anonymous',
      localUserId: null,
      username: null,
      displayName: null,
      externalSubject: null
    });
  });

  it('keeps local core user and tenant information in one request context', () => {
    const context = buildCoreRequestContext({
      tenantKey: 'default',
      user: {
        id: 'u1',
        username: 'alice',
        displayName: 'Alice'
      }
    });

    expect(context).toEqual({
      tenant: {
        tenantKey: 'default',
        tenantId: null,
        source: 'default'
      },
      currentUser: {
        kind: 'local-user',
        localUserId: 'u1',
        username: 'alice',
        displayName: 'Alice',
        externalSubject: null
      }
    });
  });
});
