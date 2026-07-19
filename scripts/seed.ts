/**
 * Idempotent seed: vertical config snapshots, simulated suppliers, private
 * supplier policies. Safe to run repeatedly (upserts by natural keys).
 * Run: pnpm tsx scripts/seed.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { verticals } from '../src/config/verticals';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

interface PolicyFixture {
  vertical_slug: string;
  suppliers: Array<{
    key: string;
    name: string;
    source: 'simulated';
    is_simulated: boolean;
    location: string;
    distance_km: number;
    supported_categories: string[];
    operating_hours: string;
    contact: Record<string, unknown>;
    policy: {
      behavior_profile: string;
      style_notes: string;
      price_sheet: Record<string, unknown>;
      floor: Record<string, unknown>;
      concession_ladder: unknown[];
      disclosure_policy: Record<string, unknown>;
    };
  }>;
}

async function main() {
  // 1. Vertical config snapshots
  for (const v of verticals) {
    const { error } = await supabase
      .from('verticals')
      .upsert(
        { slug: v.slug, label: v.label, config: v, is_active: true },
        { onConflict: 'slug' },
      );
    if (error) throw new Error(`verticals upsert failed: ${error.message}`);
    console.log(`vertical ok: ${v.slug}`);
  }

  // 2. Simulated suppliers + private policies (one fixture file per vertical)
  const fixtureFiles = [
    'data/supplier-policies/equipment-rental-stuttgart.json',
    'data/supplier-policies/moving-us.json',
  ];
  for (const fixtureFile of fixtureFiles) {
    const fixture = JSON.parse(
      readFileSync(path.join(process.cwd(), fixtureFile), 'utf8'),
    ) as PolicyFixture;
    await seedSuppliers(fixture);
  }

  console.log('Seed complete.');
}

async function seedSuppliers(fixture: PolicyFixture) {
  for (const s of fixture.suppliers) {
    const { data: existing, error: selErr } = await supabase
      .from('suppliers')
      .select('id')
      .eq('name', s.name)
      .eq('vertical_slug', fixture.vertical_slug)
      .maybeSingle();
    if (selErr) throw new Error(`supplier select failed: ${selErr.message}`);

    let supplierId: string;
    if (existing) {
      supplierId = existing.id;
      const { error } = await supabase
        .from('suppliers')
        .update({
          source: s.source,
          is_simulated: s.is_simulated,
          location: s.location,
          distance_km: s.distance_km,
          supported_categories: s.supported_categories,
          operating_hours: s.operating_hours,
          contact: s.contact,
        })
        .eq('id', supplierId);
      if (error) throw new Error(`supplier update failed: ${error.message}`);
    } else {
      const { data, error } = await supabase
        .from('suppliers')
        .insert({
          name: s.name,
          source: s.source,
          is_simulated: s.is_simulated,
          location: s.location,
          distance_km: s.distance_km,
          supported_categories: s.supported_categories,
          operating_hours: s.operating_hours,
          contact: s.contact,
          vertical_slug: fixture.vertical_slug,
        })
        .select('id')
        .single();
      if (error) throw new Error(`supplier insert failed: ${error.message}`);
      supplierId = data.id;
    }

    const { error: polErr } = await supabase.from('supplier_policies').upsert(
      {
        supplier_id: supplierId,
        behavior_profile: s.policy.behavior_profile,
        price_sheet: { ...s.policy.price_sheet, style_notes: s.policy.style_notes },
        floor: s.policy.floor,
        concession_ladder: s.policy.concession_ladder,
        disclosure_policy: s.policy.disclosure_policy,
        is_held_out: false,
      },
      { onConflict: 'supplier_id' },
    );
    if (polErr) throw new Error(`policy upsert failed: ${polErr.message}`);
    console.log(`supplier + policy ok: ${s.name} (${s.policy.behavior_profile})`);
  }
}

void main();
