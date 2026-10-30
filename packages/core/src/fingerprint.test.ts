import { describe, expect, it } from 'vitest';
import { deriveFingerprint } from './fingerprint.js';

const project = '6f1d2c3b-0000-4000-8000-000000000001';
const other = '6f1d2c3b-0000-4000-8000-000000000002';

describe('A derived Fingerprint', () => {
  it('is the same for the same Project, title and Environment', () => {
    expect(deriveFingerprint(project, 'Payment provider timed out', 'production')).toBe(
      deriveFingerprint(project, 'Payment provider timed out', 'production'),
    );
  });

  it('differs when the title, the Environment or the Project differs', () => {
    const base = deriveFingerprint(project, 'Payment provider timed out', 'production');
    expect(deriveFingerprint(project, 'Queue backed up', 'production')).not.toBe(base);
    expect(deriveFingerprint(project, 'Payment provider timed out', 'staging')).not.toBe(base);
    expect(deriveFingerprint(other, 'Payment provider timed out', 'production')).not.toBe(base);
  });

  it('tells a missing Environment apart from every named one', () => {
    expect(deriveFingerprint(project, 'Job failed', null)).not.toBe(
      deriveFingerprint(project, 'Job failed', 'production'),
    );
  });

  it('cannot be forged by moving text between the title and the Environment', () => {
    expect(deriveFingerprint(project, 'a b', 'c')).not.toBe(deriveFingerprint(project, 'a', 'b c'));
  });

  it('is a fixed-length hexadecimal digest', () => {
    expect(deriveFingerprint(project, 'Job failed', null)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores spaces around the title', () => {
    expect(deriveFingerprint(project, '  Job failed \n', null)).toBe(
      deriveFingerprint(project, 'Job failed', null),
    );
  });
});
