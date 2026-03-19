import { describeRequiredRights, hasRequiredRights, type PermissionName } from './authorization.js';

export type GroupMembershipRecord = {
  userId: string;
  rights: string;
};

export function findGroupMembership(
  memberships: GroupMembershipRecord[],
  userId: string | null | undefined
) {
  if (!userId) return null;
  return memberships.find((item) => item.userId === userId) ?? null;
}

export function evaluateGroupPermission(params: {
  memberships: GroupMembershipRecord[];
  userId: string | null | undefined;
  requires: PermissionName[];
}) {
  const membership = findGroupMembership(params.memberships, params.userId);
  const userRights = membership?.rights ?? '';
  const allowed = !!membership && hasRequiredRights(userRights, params.requires);
  return {
    allowed,
    membership,
    userRights,
    errorMessage: allowed
      ? ''
      : `Forbidden: requires ${describeRequiredRights(params.requires)}, user has ${userRights || '-'}`
  };
}

export function evaluateAssignmentTarget(params: {
  membership: GroupMembershipRecord | null;
  role: 'editor' | 'approver';
}) {
  if (!params.membership) {
    return {
      allowed: false,
      errorMessage: 'Selected user is not a member of the document group'
    };
  }
  const requiredFlag = params.role === 'editor' ? 'w' : 'x';
  const requiredName = params.role === 'editor' ? 'write' : 'execute';
  if (!params.membership.rights.includes(requiredFlag)) {
    return {
      allowed: false,
      errorMessage: `Selected user lacks ${requiredName} rights for ${params.role} assignment`
    };
  }
  return {
    allowed: true,
    errorMessage: ''
  };
}
