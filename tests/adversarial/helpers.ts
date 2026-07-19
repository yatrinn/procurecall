import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/integrations/supabase-server';
import { createDraftSpec, confirmSpec, type SpecRow } from '@/core/specs-repo';
import { DEFAULT_VERTICAL_SLUG } from '@/config/verticals';
import type { TranscriptTurn } from '@/negotiation/types';

/**
 * Fixture kit for the adversarial suite. Everything it creates carries the
 * ADV_MARK prefix and is deleted in cleanup — golden/demo data is untouched.
 */

export const ADV_MARK = 'ADVERSARIAL-FIXTURE';
export const RUN_ID = randomUUID();

export const DEMO_FIELDS = {
  equipment_category: 'scissor_lift',
  working_height_m: 12,
  power_type: 'electric',
  indoor_outdoor: 'both',
  ground_conditions: 'paved',
  site_access: null,
  delivery_address: 'Königstraße 10, 70173 Stuttgart',
  delivery_date: '2026-07-27',
  delivery_window: { earliest: null, latest: '07:00' },
  pickup_date: '2026-07-31',
  pickup_window: null,
  duration_business_days: 5,
  accessories: null,
  operator_required: false,
  charging_or_fuel: '230v_available',
  insurance_preference: 'supplier_liability_reduction',
  deposit_tolerance: 'up_to_500',
  budget_net: null,
  company: 'Bau Süd GmbH',
  contact: 'Markus Weber',
};

export interface Fixtures {
  spec: SpecRow;
  supplierId: string;
  cleanup: () => Promise<void>;
}

export async function createConfirmedSpec(
  overrides: Record<string, unknown> = {},
): Promise<SpecRow> {
  const draft = await createDraftSpec({
    verticalSlug: DEFAULT_VERTICAL_SLUG,
    fields: { ...DEMO_FIELDS, ...overrides },
    intakeSource: 'manual',
  });
  // Fixture marking: reuse is_demo_run=false but tag via company? Keep spec rows;
  // cleanup deletes by id list collected below.
  createdSpecIds.push(draft.id);
  return confirmSpec(draft.id);
}

export const createdSpecIds: string[] = [];
export const createdSupplierIds: string[] = [];
export const createdCallIds: string[] = [];

export async function createFixtureSupplier(
  name: string,
  policy: {
    behavior_profile: string;
    price_sheet: Record<string, unknown>;
    floor: Record<string, unknown>;
    concession_ladder: Array<Record<string, unknown>>;
    disclosure_policy: Record<string, unknown>;
  },
): Promise<string> {
  const supabase = supabaseAdmin();
  const { data: supplier, error } = await supabase
    .from('suppliers')
    .insert({
      name: `${ADV_MARK} ${name}`,
      source: 'simulated',
      is_simulated: true,
      location: 'Test bench',
      contact: { kind: 'adversarial_fixture' },
      supported_categories: ['scissor_lift'],
      vertical_slug: DEFAULT_VERTICAL_SLUG,
    })
    .select('id')
    .single();
  if (error) throw error;
  createdSupplierIds.push(supplier.id);
  const { error: polErr } = await supabase.from('supplier_policies').insert({
    supplier_id: supplier.id,
    ...policy,
    is_held_out: false,
  });
  if (polErr) throw polErr;
  return supplier.id;
}

/** A completed fixture call with minimal transcript, for quotes to hang on. */
export async function createFixtureCall(specId: string, supplierId: string, fingerprint: string) {
  const supabase = supabaseAdmin();
  const transcript: TranscriptTurn[] = [
    { turn_index: 0, role: 'supplier', message: 'Fixture, hello?', at_ms: 0 },
    { turn_index: 1, role: 'buyer', message: 'Fixture quote read-back.', at_ms: 1000 },
  ];
  const { data, error } = await supabase
    .from('call_sessions')
    .insert({
      job_spec_id: specId,
      supplier_id: supplierId,
      transport_mode: 'counter_agent',
      tier: 'text',
      status: 'completed',
      spec_fingerprint: fingerprint,
      transcript,
      outcome_type: 'quote',
      outcome: { type: 'quote', summary: 'fixture' },
    })
    .select('id')
    .single();
  if (error) throw error;
  createdCallIds.push(data.id);
  return data.id as string;
}

export async function createFixtureQuote(input: {
  callId: string;
  supplierId: string;
  specId: string;
  fingerprint: string;
  status?: 'draft' | 'confirmed' | 'expired' | 'declined';
  totalCents?: number | null;
  currency?: string;
  taxBasis?: string;
  validityUntil?: string | null;
  withLine?: boolean;
}): Promise<string> {
  const supabase = supabaseAdmin();
  const { data: quote, error } = await supabase
    .from('quotes')
    .insert({
      call_id: input.callId,
      supplier_id: input.supplierId,
      job_spec_id: input.specId,
      spec_fingerprint: input.fingerprint,
      availability_status: 'confirmed',
      validity_until: input.validityUntil ?? null,
      total_after_negotiation_cents: input.totalCents === undefined ? 80000 : input.totalCents,
      status: input.status ?? 'confirmed',
      currency: input.currency ?? 'EUR',
      tax_basis: input.taxBasis ?? 'net',
    })
    .select('id')
    .single();
  if (error) throw error;
  if (input.withLine !== false) {
    const { error: lineErr } = await supabase.from('quote_lines').insert({
      quote_id: quote.id,
      call_id: input.callId,
      label: 'fixture rental',
      amount_cents: input.totalCents ?? 80000,
      unit: 'flat',
      is_mandatory: true,
      is_conditional: false,
      category: 'rental',
      transcript_ref: { call_id: input.callId, turn_index: 1 },
    });
    if (lineErr) throw lineErr;
  }
  return quote.id;
}

export async function cleanupFixtures(): Promise<void> {
  if (process.env.KEEP_FIXTURES === '1') return;
  const supabase = supabaseAdmin();
  if (createdCallIds.length > 0) {
    await supabase.from('validator_findings').delete().in('call_id', createdCallIds);
    await supabase.from('negotiation_events').delete().in('call_id', createdCallIds);
    await supabase.from('quote_lines').delete().in('call_id', createdCallIds);
    await supabase.from('quotes').delete().in('call_id', createdCallIds);
  }
  if (createdSpecIds.length > 0) {
    // calls started by conversational scenarios reference these specs
    const { data: extraCalls } = await supabase
      .from('call_sessions')
      .select('id')
      .in('job_spec_id', createdSpecIds);
    const extraIds = (extraCalls ?? []).map((c) => c.id);
    if (extraIds.length > 0) {
      await supabase.from('validator_findings').delete().in('call_id', extraIds);
      await supabase.from('negotiation_events').delete().in('call_id', extraIds);
      await supabase.from('quote_lines').delete().in('call_id', extraIds);
      await supabase.from('quotes').delete().in('call_id', extraIds);
      await supabase.from('call_sessions').delete().in('id', extraIds);
    }
    await supabase.from('recommendations').delete().in('job_spec_id', createdSpecIds);
  }
  if (createdCallIds.length > 0) {
    await supabase.from('call_sessions').delete().in('id', createdCallIds);
  }
  if (createdSpecIds.length > 0) {
    await supabase.from('job_specs').delete().in('id', createdSpecIds);
  }
  if (createdSupplierIds.length > 0) {
    await supabase.from('supplier_policies').delete().in('supplier_id', createdSupplierIds);
    await supabase.from('suppliers').delete().in('id', createdSupplierIds);
  }
}

export async function recordResult(slug: string, passed: boolean, details: unknown) {
  const supabase = supabaseAdmin();
  const { data: scenario } = await supabase
    .from('adversarial_scenarios')
    .select('id')
    .eq('slug', slug)
    .single();
  if (!scenario) throw new Error(`scenario ${slug} not seeded`);
  const { error } = await supabase.from('adversarial_results').insert({
    scenario_id: scenario.id,
    run_id: RUN_ID,
    passed,
    details: details ?? {},
  });
  if (error) throw error;
}

export async function seedScenarios(): Promise<void> {
  const supabase = supabaseAdmin();
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const file = JSON.parse(
    readFileSync(path.join(process.cwd(), 'data/adversarial/scenarios.json'), 'utf8'),
  ) as { scenarios: Array<{ slug: string; kind: string; category: string; description: string; expected: string }> };
  for (const s of file.scenarios) {
    const { error } = await supabase.from('adversarial_scenarios').upsert(
      {
        slug: s.slug,
        category: s.category,
        description: s.description,
        setup: { kind: s.kind },
        expected_outcome: { expected: s.expected },
      },
      { onConflict: 'slug' },
    );
    if (error) throw error;
  }
}
