import { createHash } from 'node:crypto';

/**
 * Canonical serialization for spec fingerprinting.
 *
 * Rules:
 * - object keys sorted lexicographically at every depth
 * - strings trimmed; internal whitespace runs collapsed to single spaces
 * - numbers normalized (-0 becomes 0; must be finite)
 * - undefined is treated as null so absent optionals serialize identically
 * - arrays keep their order (order is meaningful, e.g. accessories as chosen)
 *
 * The fingerprint covers WHAT THE SUPPLIER HEARS: vertical + job fields.
 * Authorized levers are buyer-side authority, not job content — they are
 * versioned alongside the spec but excluded from the fingerprint, so a
 * lever change never silently invalidates verified leverage on an
 * unchanged job. Volatile fields (ids, confirmed_at) are never included.
 */
export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function normalize(value: CanonicalValue): CanonicalValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ');
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite number in canonical input');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(normalize);
  const out: { [key: string]: CanonicalValue } = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = normalize(value[key]);
  }
  return out;
}

export function canonicalize(value: CanonicalValue): string {
  const normalized = normalize(value);
  return JSON.stringify(normalized, (_k, v: CanonicalValue) => (v === undefined ? null : v));
}

export function fingerprintOf(value: CanonicalValue): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}

/** First 12 hex chars for display; full value is stored and compared. */
export function shortFingerprint(fp: string): string {
  return fp.slice(0, 12);
}
