import { describe, expect, it } from 'vitest';
import { evaluateAssignmentTarget, evaluateGroupPermission, findGroupMembership } from './policy.js';

describe('core policy helpers', () => {
  const memberships = [
    { userId: 'alice', rights: 'rwx' },
    { userId: 'bob', rights: 'rw' }
  ];

  it('finds group memberships for the active local user', () => {
    expect(findGroupMembership(memberships, 'alice')).toEqual({ userId: 'alice', rights: 'rwx' });
    expect(findGroupMembership(memberships, 'missing')).toBeNull();
  });

  it('evaluates required rights against group memberships', () => {
    expect(evaluateGroupPermission({ memberships, userId: 'alice', requires: ['execute'] }).allowed).toBe(true);
    expect(evaluateGroupPermission({ memberships, userId: 'bob', requires: ['execute'] }).allowed).toBe(false);
  });

  it('validates assignment targets by role intent', () => {
    expect(evaluateAssignmentTarget({ membership: { userId: 'alice', rights: 'rwx' }, role: 'editor' }).allowed).toBe(true);
    expect(evaluateAssignmentTarget({ membership: { userId: 'bob', rights: 'rw' }, role: 'approver' }).allowed).toBe(false);
  });
});
