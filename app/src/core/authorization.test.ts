import { describe, expect, it } from 'vitest';
import {
  compactRequiredRights,
  describeRequiredRights,
  hasRequiredRights,
  normalizeRequiresValue
} from './authorization.js';

describe('core authorization helpers', () => {
  it('normalizes permission aliases into canonical permission names', () => {
    expect(normalizeRequiresValue(['r', 'write', 'x', 'read', 'invalid'])).toEqual(['read', 'write', 'execute']);
  });

  it('checks required rights against compact membership strings', () => {
    expect(hasRequiredRights('rwx', ['read', 'write'])).toBe(true);
    expect(hasRequiredRights('r', ['read', 'execute'])).toBe(false);
  });

  it('describes required rights consistently for UI messaging', () => {
    expect(compactRequiredRights(['execute', 'read', 'read'])).toBe('rx');
    expect(describeRequiredRights(['read', 'write'])).toBe('read/write (rw)');
  });
});
