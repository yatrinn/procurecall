import { describe, expect, it } from 'vitest';
import { canonicalize, fingerprintOf, shortFingerprint } from '@/core/canonical';
import { fingerprintOfSpec } from '@/core/jobspec';

describe('canonicalize', () => {
  it('sorts keys at every depth', () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('trims and collapses whitespace in strings', () => {
    expect(canonicalize({ s: '  Stuttgart   Hauptstr.  7 ' })).toBe('{"s":"Stuttgart Hauptstr. 7"}');
  });

  it('treats undefined as null', () => {
    expect(canonicalize({ a: undefined })).toBe(canonicalize({ a: null }));
  });

  it('normalizes negative zero', () => {
    expect(canonicalize({ n: -0 })).toBe('{"n":0}');
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalize({ n: Number.POSITIVE_INFINITY })).toThrow();
  });

  it('keeps array order (order is meaningful)', () => {
    expect(canonicalize({ a: [2, 1] })).toBe('{"a":[2,1]}');
  });
});

describe('fingerprintOf', () => {
  it('is stable across key order and whitespace differences', () => {
    const a = fingerprintOf({ x: ' a  b ', y: 1 });
    const b = fingerprintOf({ y: 1, x: 'a b' });
    expect(a).toBe(b);
  });

  it('changes when values change', () => {
    expect(fingerprintOf({ x: 1 })).not.toBe(fingerprintOf({ x: 2 }));
  });

  it('is a 64-char hex sha256', () => {
    expect(fingerprintOf({ x: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('short form is 12 chars', () => {
    expect(shortFingerprint(fingerprintOf({ x: 1 }))).toHaveLength(12);
  });
});

describe('fingerprintOfSpec', () => {
  const fields = {
    equipment_category: 'scissor_lift',
    working_height_m: 12,
    delivery_window: { earliest: null, latest: '07:00' },
  };

  it('same job content, same fingerprint, regardless of field order', () => {
    const reordered = {
      delivery_window: { latest: '07:00', earliest: null },
      working_height_m: 12,
      equipment_category: 'scissor_lift',
    };
    expect(fingerprintOfSpec('equipment-rental-stuttgart', fields)).toBe(
      fingerprintOfSpec('equipment-rental-stuttgart', reordered),
    );
  });

  it('different vertical means different fingerprint', () => {
    expect(fingerprintOfSpec('equipment-rental-stuttgart', fields)).not.toBe(
      fingerprintOfSpec('moving-us', fields),
    );
  });

  it('job content change means new fingerprint', () => {
    expect(fingerprintOfSpec('equipment-rental-stuttgart', fields)).not.toBe(
      fingerprintOfSpec('equipment-rental-stuttgart', { ...fields, working_height_m: 10 }),
    );
  });
});
