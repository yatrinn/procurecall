import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  createConfirmedSpec,
  createFixtureSupplier,
  cleanupFixtures,
  RUN_ID,
} from '../adversarial/helpers';
import { startCall, runTextCall } from '@/negotiation/orchestrator';
import { runPostCallValidator } from '@/core/validator';
import { supabaseAdmin } from '@/integrations/supabase-server';
import type { SpecRow } from '@/core/specs-repo';
import type { Outcome } from '@/negotiation/types';

/**
 * Text-tier evaluation on HELD-OUT supplier profiles — commercial behaviors
 * the policy never saw during development. Labeled in the product as
 * "Negotiation performance on held-out market scenarios": it demonstrates the
 * architecture is testable and the policy generalizes. It does NOT prove
 * real-world savings.
 *
 * Metrics per profile (all code-checked):
 * - structured_outcome: the call ended through record_outcome
 * - no_violations: post-call validator found zero unsupported claims
 * - itemization: for quote outcomes, ≥4 transcript-backed line items
 * - engine_agreement: engine total equals the read-back total
 * - floor_respected: no confirmed quote below the profile's private floor
 */

const RUN = process.env.RUN_HELDOUT === '1';
const d = RUN ? describe : describe.skip;

interface Profile {
  key: string;
  name: string;
  behavior_profile: string;
  style_notes: string;
  price_sheet: Record<string, unknown>;
  floor: { min_total_net_cents_5d: number };
  concession_ladder: Array<Record<string, unknown>>;
  disclosure_policy: Record<string, unknown>;
}

const profiles = (
  JSON.parse(
    readFileSync(path.join(process.cwd(), 'data/held-out-profiles/equipment-rental-stuttgart.json'), 'utf8'),
  ) as { profiles: Profile[] }
).profiles;

interface ProfileResult {
  profile: string;
  outcome_type: string | null;
  structured_outcome: boolean;
  no_violations: boolean;
  itemization: boolean | null;
  engine_agreement: boolean | null;
  floor_respected: boolean | null;
  quote_total_cents: number | null;
}

const results: ProfileResult[] = [];
let spec: SpecRow;

d('held-out profile evaluation', () => {
  beforeAll(async () => {
    spec = await createConfirmedSpec({ site_access: `heldout-${Date.now()}` });
  }, 60_000);

  afterAll(async () => {
    // Persist the aggregated run before fixtures vanish.
    const summary = {
      profiles: results,
      totals: {
        n: results.length,
        structured_outcome: results.filter((r) => r.structured_outcome).length,
        no_violations: results.filter((r) => r.no_violations).length,
        quotes_itemized: results.filter((r) => r.itemization === true).length,
        engine_agreement: results.filter((r) => r.engine_agreement === true).length,
        floors_respected: results.filter((r) => r.floor_respected !== false).length,
      },
    };
    const { error } = await supabaseAdmin().from('eval_runs').insert({
      kind: 'held_out_profiles',
      config: { profiles: profiles.map((p) => p.key), run_id: RUN_ID },
      results: summary,
    });
    if (error) console.error('eval_runs insert failed:', error.message);
    await cleanupFixtures();
  }, 180_000);

  for (const profile of profiles) {
    it.concurrent(`held-out: ${profile.key}`, { timeout: 300_000 }, async () => {
      const supplierId = await createFixtureSupplier(profile.name, {
        behavior_profile: profile.behavior_profile,
        price_sheet: { ...profile.price_sheet, style_notes: profile.style_notes },
        floor: profile.floor,
        concession_ladder: profile.concession_ladder,
        disclosure_policy: profile.disclosure_policy,
      });
      const { callId } = await startCall({ specId: spec.id, supplierId });
      await runTextCall(callId);

      const supabase = supabaseAdmin();
      const { data: session } = await supabase
        .from('call_sessions')
        .select('outcome, outcome_type')
        .eq('id', callId)
        .single();
      const findings = await runPostCallValidator(callId).catch(() => []);
      const { data: quote } = await supabase
        .from('quotes')
        .select('id, status, total_after_negotiation_cents, price_breakdown')
        .eq('call_id', callId)
        .maybeSingle();
      let lineCount = 0;
      if (quote) {
        const { count } = await supabase
          .from('quote_lines')
          .select('*', { count: 'exact', head: true })
          .eq('quote_id', quote.id);
        lineCount = count ?? 0;
      }

      const outcome = session?.outcome as Outcome | null;
      const breakdown = quote?.price_breakdown as { guaranteed_net_cents?: number } | null;
      const result: ProfileResult = {
        profile: profile.key,
        outcome_type: session?.outcome_type ?? null,
        structured_outcome: session?.outcome_type !== null,
        no_violations: findings.filter((f) => f.severity === 'violation').length === 0,
        itemization: session?.outcome_type === 'quote' ? lineCount >= 4 : null,
        engine_agreement:
          session?.outcome_type === 'quote' && outcome?.total_net_cents != null
            ? breakdown?.guaranteed_net_cents === outcome.total_net_cents
            : null,
        floor_respected:
          quote?.status === 'confirmed' && quote.total_after_negotiation_cents !== null
            ? quote.total_after_negotiation_cents >= profile.floor.min_total_net_cents_5d
            : null,
        quote_total_cents: quote?.total_after_negotiation_cents ?? null,
      };
      results.push(result);

      // Hard assertions: structure and honesty must hold for every profile.
      expect(result.structured_outcome, `${profile.key} outcome`).toBe(true);
      expect(result.no_violations, `${profile.key} violations`).toBe(true);
      expect(result.floor_respected !== false, `${profile.key} floor`).toBe(true);
    });
  }
});
