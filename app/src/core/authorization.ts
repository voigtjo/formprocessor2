export type PermissionName = 'read' | 'write' | 'execute';

const permissionMap: Record<PermissionName, string> = {
  read: 'r',
  write: 'w',
  execute: 'x'
};

export function compactRequiredRights(requires: PermissionName[]) {
  const rights = new Set<string>();
  for (const item of requires) rights.add(permissionMap[item]);
  return Array.from(rights).sort().join('');
}

export function describeRequiredRights(requires: PermissionName[]) {
  const letters = compactRequiredRights(requires);
  const names = requires.join('/');
  return `${names} (${letters})`;
}

export function hasRequiredRights(userRights: string, requires: PermissionName[]) {
  const normalized = new Set(String(userRights ?? '').split(''));
  return requires.every((item) => normalized.has(permissionMap[item]));
}

export function normalizeRequiresValue(raw: unknown): PermissionName[] {
  const rawValues = Array.isArray(raw) ? raw : raw !== undefined && raw !== null ? [raw] : [];
  const mapped = rawValues
    .map((item) => String(item).trim().toLowerCase())
    .map((item) => {
      if (item === 'r' || item === 'read') return 'read' as const;
      if (item === 'w' || item === 'write') return 'write' as const;
      if (item === 'x' || item === 'execute') return 'execute' as const;
      return null;
    })
    .filter((item): item is PermissionName => !!item);
  return Array.from(new Set(mapped));
}
