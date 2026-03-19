export type LocalUser = {
  id: string;
  username: string;
  displayName: string;
};

export type TenantContext = {
  tenantKey: string;
  tenantId: string | null;
  source: 'default';
};

export type CurrentUserContext = {
  kind: 'anonymous' | 'local-user';
  localUserId: string | null;
  username: string | null;
  displayName: string | null;
  externalSubject: string | null;
};

export type CoreRequestContext = {
  tenant: TenantContext;
  currentUser: CurrentUserContext;
};

export function buildDefaultTenantContext(tenantKey = 'default'): TenantContext {
  return {
    tenantKey,
    tenantId: null,
    source: 'default'
  };
}

export function buildCurrentUserContext(user: LocalUser | null | undefined): CurrentUserContext {
  if (!user) {
    return {
      kind: 'anonymous',
      localUserId: null,
      username: null,
      displayName: null,
      externalSubject: null
    };
  }

  return {
    kind: 'local-user',
    localUserId: user.id,
    username: user.username,
    displayName: user.displayName,
    externalSubject: null
  };
}

export function buildCoreRequestContext(input: { tenantKey?: string; user?: LocalUser | null }): CoreRequestContext {
  return {
    tenant: buildDefaultTenantContext(input.tenantKey),
    currentUser: buildCurrentUserContext(input.user)
  };
}
