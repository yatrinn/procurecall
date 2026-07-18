import { z } from 'zod';
import type { VerticalConfig, SpecField } from '@/config/vertical-schema';
import { canonicalize, fingerprintOf, type CanonicalValue } from './canonical';

/**
 * JobSpec: one structured job specification, produced identically by voice
 * interview and document intake, confirmed by the user, reused verbatim
 * across every call.
 *
 * Field sets are vertical configuration, not code: schemas are built from
 * the vertical's `specFields` at runtime.
 */

export const TimeWindowSchema = z.object({
  earliest: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  latest: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
});
export type TimeWindow = z.infer<typeof TimeWindowSchema>;

export const AuthorizedLeversSchema = z.object({
  may_reveal_budget: z.boolean(),
  may_adjust_delivery_window: z.boolean(),
  may_extend_rental_period: z.boolean(),
  may_accept_equivalent_equipment: z.boolean(),
  may_offer_repeat_business: z.boolean(),
  may_accept_pickup_instead_of_delivery: z.boolean(),
  may_commit_immediately: z.boolean(),
  /** Net amount in whole EUR/USD the agent may commit to, if commitment is allowed. */
  maximum_commitment_net: z.number().int().positive().nullable(),
});
export type AuthorizedLevers = z.infer<typeof AuthorizedLeversSchema>;

export const NO_LEVERS: AuthorizedLevers = {
  may_reveal_budget: false,
  may_adjust_delivery_window: false,
  may_extend_rental_period: false,
  may_accept_equivalent_equipment: false,
  may_offer_repeat_business: false,
  may_accept_pickup_instead_of_delivery: false,
  may_commit_immediately: false,
  maximum_commitment_net: null,
};

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function fieldValueSchema(field: SpecField): z.ZodType {
  switch (field.type) {
    case 'text':
      return z.string().trim().min(1);
    case 'number':
      return z.number().finite();
    case 'boolean':
      return z.boolean();
    case 'date':
      return z.string().regex(DATE_RE, 'Expected YYYY-MM-DD');
    case 'time_window':
      return TimeWindowSchema;
    case 'select':
      return z.enum(field.options as [string, ...string[]]);
    case 'multiselect':
      return z.array(z.enum(field.options as [string, ...string[]]));
  }
}

/**
 * Schema for a DRAFT spec's fields: every field present but nullable, so
 * partial extractions validate and the confirm screen shows what is missing.
 */
export function buildDraftFieldsSchema(vertical: VerticalConfig) {
  const shape: Record<string, z.ZodType> = {};
  for (const f of vertical.specFields) {
    shape[f.id] = fieldValueSchema(f).nullable();
  }
  return z.object(shape).strict();
}

/**
 * Schema for a CONFIRMABLE spec: required fields must hold real values;
 * optional fields stay nullable.
 */
export function buildConfirmFieldsSchema(vertical: VerticalConfig) {
  const shape: Record<string, z.ZodType> = {};
  for (const f of vertical.specFields) {
    shape[f.id] = f.required ? fieldValueSchema(f) : fieldValueSchema(f).nullable();
  }
  return z.object(shape).strict();
}

export type SpecFields = Record<string, unknown>;

export interface JobSpecDraft {
  vertical_slug: string;
  fields: SpecFields;
  authorized_levers: AuthorizedLevers;
}

/** Canonical form and fingerprint cover vertical + job fields (what the supplier hears). */
export function canonicalOfSpec(verticalSlug: string, fields: SpecFields): string {
  return canonicalize({ vertical_slug: verticalSlug, fields: fields as CanonicalValue });
}

export function fingerprintOfSpec(verticalSlug: string, fields: SpecFields): string {
  return fingerprintOf({ vertical_slug: verticalSlug, fields: fields as CanonicalValue });
}

/** Human-readable brief used identically in every call and in both intake paths. */
export function specBriefLines(vertical: VerticalConfig, fields: SpecFields): string[] {
  const lines: string[] = [];
  for (const f of vertical.specFields) {
    const v = fields[f.id];
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) continue;
    let rendered: string;
    if (f.type === 'time_window') {
      const w = v as TimeWindow;
      if (w.earliest && w.latest) rendered = `between ${w.earliest} and ${w.latest}`;
      else if (w.latest) rendered = `before ${w.latest}`;
      else if (w.earliest) rendered = `after ${w.earliest}`;
      else continue;
    } else if (Array.isArray(v)) {
      rendered = v.join(', ');
    } else if (typeof v === 'boolean') {
      rendered = v ? 'yes' : 'no';
    } else {
      rendered = String(v);
    }
    lines.push(`${f.label}: ${rendered}${f.unit ? ` ${f.unit}` : ''}`);
  }
  return lines;
}
