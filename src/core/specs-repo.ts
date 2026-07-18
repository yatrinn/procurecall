import 'server-only';
import { supabaseAdmin } from '@/integrations/supabase-server';
import { getVertical } from '@/config/verticals';
import {
  AuthorizedLeversSchema,
  buildConfirmFieldsSchema,
  buildDraftFieldsSchema,
  canonicalOfSpec,
  fingerprintOfSpec,
  NO_LEVERS,
  type AuthorizedLevers,
  type SpecFields,
} from '@/core/jobspec';

export interface SpecRow {
  id: string;
  vertical_slug: string;
  spec: { fields: SpecFields };
  spec_version: number;
  parent_spec_id: string | null;
  authorized_levers: AuthorizedLevers;
  confirmed_by_user: boolean;
  confirmed_at: string | null;
  canonical: string | null;
  spec_fingerprint: string | null;
  intake_source: 'voice' | 'document' | 'manual';
  created_at: string;
}

export async function createDraftSpec(input: {
  verticalSlug: string;
  fields: SpecFields;
  intakeSource: 'voice' | 'document' | 'manual';
}): Promise<SpecRow> {
  const vertical = getVertical(input.verticalSlug);
  const fields = buildDraftFieldsSchema(vertical).parse(input.fields) as SpecFields;
  const { data, error } = await supabaseAdmin()
    .from('job_specs')
    .insert({
      vertical_slug: vertical.slug,
      spec: { fields },
      authorized_levers: NO_LEVERS,
      intake_source: input.intakeSource,
    })
    .select('*')
    .single();
  if (error) throw new Error(`createDraftSpec failed: ${error.message}`);
  return data as SpecRow;
}

export async function getSpec(id: string): Promise<SpecRow | null> {
  const { data, error } = await supabaseAdmin()
    .from('job_specs')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getSpec failed: ${error.message}`);
  return (data as SpecRow) ?? null;
}

/**
 * Update a spec. Drafts are updated in place. A confirmed spec is immutable:
 * editing it creates a NEW VERSION row. Job-content edits get a new
 * fingerprint by construction; lever-only edits keep the job fingerprint
 * (levers are buyer-side authority, not job content) but still version.
 * The new version starts unconfirmed and must be confirmed again.
 */
export async function updateSpec(
  id: string,
  patch: { fields?: SpecFields; authorized_levers?: AuthorizedLevers },
): Promise<SpecRow> {
  const current = await getSpec(id);
  if (!current) throw new Error('Spec not found');
  const vertical = getVertical(current.vertical_slug);

  const nextFields = patch.fields
    ? (buildDraftFieldsSchema(vertical).parse(patch.fields) as SpecFields)
    : current.spec.fields;
  const nextLevers = patch.authorized_levers
    ? AuthorizedLeversSchema.parse(patch.authorized_levers)
    : current.authorized_levers;

  if (!current.confirmed_by_user) {
    const { data, error } = await supabaseAdmin()
      .from('job_specs')
      .update({ spec: { fields: nextFields }, authorized_levers: nextLevers })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new Error(`updateSpec failed: ${error.message}`);
    return data as SpecRow;
  }

  const { data, error } = await supabaseAdmin()
    .from('job_specs')
    .insert({
      vertical_slug: current.vertical_slug,
      spec: { fields: nextFields },
      spec_version: current.spec_version + 1,
      parent_spec_id: current.id,
      authorized_levers: nextLevers,
      intake_source: current.intake_source,
    })
    .select('*')
    .single();
  if (error) throw new Error(`updateSpec (new version) failed: ${error.message}`);
  return data as SpecRow;
}

/**
 * Confirmation freezes the spec: required fields validated, canonical form
 * computed, fingerprint stored. Server logic elsewhere blocks calls until
 * confirmed_by_user is true.
 */
export async function confirmSpec(id: string): Promise<SpecRow> {
  const current = await getSpec(id);
  if (!current) throw new Error('Spec not found');
  if (current.confirmed_by_user) return current;

  const vertical = getVertical(current.vertical_slug);
  const fields = buildConfirmFieldsSchema(vertical).parse(current.spec.fields) as SpecFields;
  const canonical = canonicalOfSpec(vertical.slug, fields);
  const fingerprint = fingerprintOfSpec(vertical.slug, fields);

  const { data, error } = await supabaseAdmin()
    .from('job_specs')
    .update({
      spec: { fields },
      confirmed_by_user: true,
      confirmed_at: new Date().toISOString(),
      canonical,
      spec_fingerprint: fingerprint,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(`confirmSpec failed: ${error.message}`);
  return data as SpecRow;
}
