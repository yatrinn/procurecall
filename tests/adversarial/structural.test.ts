import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createConfirmedSpec,
  createFixtureCall,
  createFixtureQuote,
  createFixtureSupplier,
  cleanupFixtures,
  recordResult,
  seedScenarios,
  DEMO_FIELDS,
} from './helpers';
import { getVerifiedLeverage } from '@/core/truth-layer';
import { startCall } from '@/negotiation/orchestrator';
import { createDraftSpec, confirmSpec, updateSpec, getSpec } from '@/core/specs-repo';
import { DEFAULT_VERTICAL_SLUG } from '@/config/verticals';
import { fingerprintOfSpec, NO_LEVERS } from '@/core/jobspec';
import { buildBuyerTools, type BuyerToolContext } from '@/negotiation/buyer-tools';
import { getVertical } from '@/config/verticals';
import { rankQuotes, type RankableQuote } from '@/core/ranking';
import { computePriceBreakdown, type PriceLine } from '@/core/price-engine';
import { computeQuoteTotals } from '@/core/quote-pricing';
import { enforceSupplierPolicy, INITIAL_SUPPLIER_STATE } from '@/negotiation/supplier-engine';
import { findSupport, runPostCallValidator, type ValidatorClaim } from '@/core/validator';
import { supabaseAdmin } from '@/integrations/supabase-server';
import type { SpecRow } from '@/core/specs-repo';
import type { ToolCallRecord } from '@/negotiation/types';

const RUN = process.env.RUN_ADVERSARIAL === '1';
const d = RUN ? describe : describe.skip;

let spec: SpecRow;
let otherSpec: SpecRow;
let supplierId: string;
let rivalSupplierId: string;

async function check(slug: string, fn: () => Promise<{ passed: boolean; details?: unknown }>) {
  let passed = false;
  let details: unknown = {};
  try {
    const r = await fn();
    passed = r.passed;
    details = r.details ?? {};
  } catch (e) {
    passed = false;
    details = { error: e instanceof Error ? e.message : String(e) };
  }
  await recordResult(slug, passed, details);
  expect(passed, `${slug} ${JSON.stringify(details)}`).toBe(true);
}

d('adversarial — structural', () => {
  beforeAll(async () => {
    await seedScenarios();
    spec = await createConfirmedSpec();
    otherSpec = await createConfirmedSpec({ working_height_m: 10 });
    supplierId = await createFixtureSupplier('Fixture Supply', {
      behavior_profile: 'fixture',
      price_sheet: { day_rate_cents: 10000 },
      floor: { min_total_net_cents_5d: 76000 },
      concession_ladder: [
        { step: 1, action: 'waive_pickup_fee', requires: 'competing_verified_quote' },
        { step: 2, action: 'rental_discount_cents', amount_cents: 2500, requires: 'commitment' },
      ],
      disclosure_policy: {},
    });
    rivalSupplierId = await createFixtureSupplier('Rival Supply', {
      behavior_profile: 'fixture',
      price_sheet: { day_rate_cents: 9000 },
      floor: { min_total_net_cents_5d: 70000 },
      concession_ladder: [],
      disclosure_policy: {},
    });
  }, 120_000);

  afterAll(async () => {
    await cleanupFixtures();
  }, 120_000);

  const leverageCtx = () => ({
    currency: 'EUR',
    taxBasis: 'net',
  });

  it('leverage-fingerprint-mismatch', async () => {
    await check('leverage-fingerprint-mismatch', async () => {
      const callId = await createFixtureCall(otherSpec.id, rivalSupplierId, otherSpec.spec_fingerprint!);
      const quoteId = await createFixtureQuote({
        callId,
        supplierId: rivalSupplierId,
        specId: otherSpec.id,
        fingerprint: otherSpec.spec_fingerprint!,
      });
      const result = await getVerifiedLeverage({
        currentSpecFingerprint: spec.spec_fingerprint!,
        quoteId,
        ...leverageCtx(),
      });
      return {
        passed: !result.ok && result.reason === 'fingerprint_mismatch',
        details: result,
      };
    });
  });

  it('leverage-draft-quote', async () => {
    await check('leverage-draft-quote', async () => {
      const callId = await createFixtureCall(spec.id, rivalSupplierId, spec.spec_fingerprint!);
      const quoteId = await createFixtureQuote({
        callId,
        supplierId: rivalSupplierId,
        specId: spec.id,
        fingerprint: spec.spec_fingerprint!,
        status: 'draft',
      });
      const result = await getVerifiedLeverage({
        currentSpecFingerprint: spec.spec_fingerprint!,
        quoteId,
        ...leverageCtx(),
      });
      return { passed: !result.ok && result.reason === 'quote_not_confirmed', details: result };
    });
  });

  it('leverage-expired-quote', async () => {
    await check('leverage-expired-quote', async () => {
      const callId = await createFixtureCall(spec.id, rivalSupplierId, spec.spec_fingerprint!);
      const quoteId = await createFixtureQuote({
        callId,
        supplierId: rivalSupplierId,
        specId: spec.id,
        fingerprint: spec.spec_fingerprint!,
        validityUntil: new Date(Date.now() - 86_400_000).toISOString(),
      });
      const result = await getVerifiedLeverage({
        currentSpecFingerprint: spec.spec_fingerprint!,
        quoteId,
        ...leverageCtx(),
      });
      return { passed: !result.ok && result.reason === 'quote_expired', details: result };
    });
  });

  it('leverage-no-transcript-evidence', async () => {
    await check('leverage-no-transcript-evidence', async () => {
      const callId = await createFixtureCall(spec.id, rivalSupplierId, spec.spec_fingerprint!);
      const quoteId = await createFixtureQuote({
        callId,
        supplierId: rivalSupplierId,
        specId: spec.id,
        fingerprint: spec.spec_fingerprint!,
        withLine: false,
      });
      const result = await getVerifiedLeverage({
        currentSpecFingerprint: spec.spec_fingerprint!,
        quoteId,
        ...leverageCtx(),
      });
      return { passed: !result.ok && result.reason === 'no_transcript_evidence', details: result };
    });
  });

  it('leverage-currency-mismatch', async () => {
    await check('leverage-currency-mismatch', async () => {
      const callId = await createFixtureCall(spec.id, rivalSupplierId, spec.spec_fingerprint!);
      const quoteId = await createFixtureQuote({
        callId,
        supplierId: rivalSupplierId,
        specId: spec.id,
        fingerprint: spec.spec_fingerprint!,
        currency: 'USD',
      });
      const result = await getVerifiedLeverage({
        currentSpecFingerprint: spec.spec_fingerprint!,
        quoteId,
        ...leverageCtx(),
      });
      return {
        passed: !result.ok && result.reason === 'currency_or_tax_incompatible',
        details: result,
      };
    });
  });

  it('leverage-tax-basis-switch', async () => {
    await check('leverage-tax-basis-switch', async () => {
      const callId = await createFixtureCall(spec.id, rivalSupplierId, spec.spec_fingerprint!);
      const quoteId = await createFixtureQuote({
        callId,
        supplierId: rivalSupplierId,
        specId: spec.id,
        fingerprint: spec.spec_fingerprint!,
        taxBasis: 'gross',
      });
      const result = await getVerifiedLeverage({
        currentSpecFingerprint: spec.spec_fingerprint!,
        quoteId,
        ...leverageCtx(),
      });
      return {
        passed: !result.ok && result.reason === 'currency_or_tax_incompatible',
        details: result,
      };
    });
  });

  it('leverage-total-missing', async () => {
    await check('leverage-total-missing', async () => {
      const callId = await createFixtureCall(spec.id, rivalSupplierId, spec.spec_fingerprint!);
      const quoteId = await createFixtureQuote({
        callId,
        supplierId: rivalSupplierId,
        specId: spec.id,
        fingerprint: spec.spec_fingerprint!,
        totalCents: null,
      });
      const result = await getVerifiedLeverage({
        currentSpecFingerprint: spec.spec_fingerprint!,
        quoteId,
        ...leverageCtx(),
      });
      return { passed: !result.ok && result.reason === 'quote_total_missing', details: result };
    });
  });

  it('leverage-unknown-quote', async () => {
    await check('leverage-unknown-quote', async () => {
      const result = await getVerifiedLeverage({
        currentSpecFingerprint: spec.spec_fingerprint!,
        quoteId: '00000000-0000-0000-0000-000000000000',
        ...leverageCtx(),
      });
      return { passed: !result.ok && result.reason === 'quote_not_found', details: result };
    });
  });

  it('call-before-confirmation', async () => {
    await check('call-before-confirmation', async () => {
      const draft = await createDraftSpec({
        verticalSlug: DEFAULT_VERTICAL_SLUG,
        fields: DEMO_FIELDS,
        intakeSource: 'manual',
      });
      const { createdSpecIds } = await import('./helpers');
      createdSpecIds.push(draft.id);
      try {
        await startCall({ specId: draft.id, supplierId });
        return { passed: false, details: 'call was allowed on unconfirmed spec' };
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        return { passed: /not confirmed/i.test(msg), details: msg };
      }
    });
  });

  it('edit-after-confirmation-versions', async () => {
    await check('edit-after-confirmation-versions', async () => {
      const s = await createConfirmedSpec();
      const updated = await updateSpec(s.id, {
        fields: { ...DEMO_FIELDS, working_height_m: 14 },
      });
      const { createdSpecIds } = await import('./helpers');
      createdSpecIds.push(updated.id);
      const original = await getSpec(s.id);
      return {
        passed:
          updated.id !== s.id &&
          updated.spec_version === s.spec_version + 1 &&
          !updated.confirmed_by_user &&
          original?.confirmed_by_user === true,
        details: { newVersion: updated.spec_version },
      };
    });
  });

  it('fingerprint-stability', async () => {
    await check('fingerprint-stability', async () => {
      const a = fingerprintOfSpec(DEFAULT_VERTICAL_SLUG, {
        ...DEMO_FIELDS,
        delivery_address: '  Königstraße   10,  70173 Stuttgart ',
      });
      const reordered = Object.fromEntries(Object.entries(DEMO_FIELDS).reverse());
      const b = fingerprintOfSpec(DEFAULT_VERTICAL_SLUG, reordered);
      return { passed: a === b, details: { a: a.slice(0, 12), b: b.slice(0, 12) } };
    });
  });

  it('fingerprint-content-change', async () => {
    await check('fingerprint-content-change', async () => {
      const a = fingerprintOfSpec(DEFAULT_VERTICAL_SLUG, DEMO_FIELDS);
      const b = fingerprintOfSpec(DEFAULT_VERTICAL_SLUG, { ...DEMO_FIELDS, working_height_m: 14 });
      return { passed: a !== b, details: {} };
    });
  });

  const toolCtx = (levers: Partial<typeof NO_LEVERS>, budgetNet: number | null = null): BuyerToolContext => ({
    callId: '00000000-0000-0000-0000-000000000001',
    specId: spec.id,
    specFingerprint: spec.spec_fingerprint!,
    supplierId,
    vertical: getVertical(DEFAULT_VERTICAL_SLUG),
    levers: { ...NO_LEVERS, ...levers },
    budgetNet,
    currentTurnIndex: () => 0,
    nowMs: () => 0,
  });

  it('commit-above-ceiling', async () => {
    await check('commit-above-ceiling', async () => {
      const tools = buildBuyerTools(
        toolCtx({ may_commit_immediately: true, maximum_commitment_net: 800 }),
      );
      const commit = tools.find((t) => t.name === 'commit_booking');
      if (!commit) return { passed: false, details: 'commit tool missing though authorized' };
      const result = (await commit.execute({ total_net_cents: 90000 })) as { ok: boolean; reason?: string };
      return {
        passed: result.ok === false && result.reason === 'above_commitment_ceiling',
        details: result,
      };
    });
  });

  it('unauthorized-lever-absent', async () => {
    await check('unauthorized-lever-absent', async () => {
      const tools = buildBuyerTools(toolCtx({}));
      const leverTools = tools.filter(
        (t) => t.name.startsWith('use_lever_') || t.name === 'reveal_budget' || t.name === 'commit_booking',
      );
      return { passed: leverTools.length === 0, details: tools.map((t) => t.name) };
    });
  });

  it('budget-tool-absent-without-budget', async () => {
    await check('budget-tool-absent-without-budget', async () => {
      const tools = buildBuyerTools(toolCtx({ may_reveal_budget: true }, null));
      return {
        passed: !tools.some((t) => t.name === 'reveal_budget'),
        details: tools.map((t) => t.name),
      };
    });
  });

  it('quote-line-without-evidence', async () => {
    await check('quote-line-without-evidence', async () => {
      const callId = await createFixtureCall(spec.id, rivalSupplierId, spec.spec_fingerprint!);
      const quoteId = await createFixtureQuote({
        callId,
        supplierId: rivalSupplierId,
        specId: spec.id,
        fingerprint: spec.spec_fingerprint!,
      });
      const { error } = await supabaseAdmin().from('quote_lines').insert({
        quote_id: quoteId,
        call_id: callId,
        label: 'evidence-free fee',
        amount_cents: 1000,
        unit: 'flat',
        is_mandatory: true,
        is_conditional: false,
        category: 'surcharge',
        transcript_ref: { note: 'no call_id, no turn_index' },
      });
      return { passed: !!error, details: error?.message ?? 'insert succeeded (BAD)' };
    });
  });

  it('leverage-event-without-source', async () => {
    await check('leverage-event-without-source', async () => {
      const callId = await createFixtureCall(spec.id, rivalSupplierId, spec.spec_fingerprint!);
      const { error } = await supabaseAdmin().from('negotiation_events').insert({
        call_id: callId,
        event_type: 'leverage_used',
        lever_used: 'verified_competing_quote',
        verified_source_quote_id: null,
        tool_returned_evidence: null,
      });
      return { passed: !!error, details: error?.message ?? 'insert succeeded (BAD)' };
    });
  });

  it('rls-anon-read-denied', async () => {
    await check('rls-anon-read-denied', async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const tables = ['job_specs', 'quotes', 'supplier_policies', 'call_sessions'];
      for (const t of tables) {
        const res = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, {
          headers: { apikey: anon },
        });
        const rows = (await res.json()) as unknown[];
        if (Array.isArray(rows) && rows.length > 0) {
          return { passed: false, details: `anon read rows from ${t}` };
        }
      }
      return { passed: true };
    });
  });

  it('rls-anon-write-denied', async () => {
    await check('rls-anon-write-denied', async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const res = await fetch(`${url}/rest/v1/suppliers`, {
        method: 'POST',
        headers: { apikey: anon, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'rls-attack',
          source: 'manual',
          vertical_slug: DEFAULT_VERTICAL_SLUG,
        }),
      });
      return { passed: res.status !== 201, details: `status ${res.status}` };
    });
  });

  it('supplier-floor-clamp', async () => {
    await check('supplier-floor-clamp', async () => {
      const violations = enforceSupplierPolicy(
        {
          message: 'I can do the whole job for 700 euros net.',
          internal: {
            concession_step_used: null,
            concession_reason: null,
            newly_disclosed_categories: [],
            all_in_total_for_full_job_net_cents: 70000,
            wants_to_hang_up: false,
          },
        },
        {
          behavior_profile: 'fixture',
          price_sheet: {},
          floor: { min_total_net_cents_5d: 76000 },
          concession_ladder: [],
          disclosure_policy: {},
        },
        INITIAL_SUPPLIER_STATE,
      );
      return { passed: violations.length > 0, details: violations };
    });
  });

  it('concession-ladder-order', async () => {
    await check('concession-ladder-order', async () => {
      const policy = {
        behavior_profile: 'fixture',
        price_sheet: {},
        floor: {},
        concession_ladder: [
          { step: 1, action: 'a', requires: 'x' },
          { step: 2, action: 'b', requires: 'y' },
        ],
        disclosure_policy: {},
      };
      const skip = enforceSupplierPolicy(
        {
          message: 'fine, discount.',
          internal: {
            concession_step_used: 2,
            concession_reason: 'skip',
            newly_disclosed_categories: [],
            all_in_total_for_full_job_net_cents: null,
            wants_to_hang_up: false,
          },
        },
        policy,
        INITIAL_SUPPLIER_STATE,
      );
      const reuse = enforceSupplierPolicy(
        {
          message: 'again.',
          internal: {
            concession_step_used: 1,
            concession_reason: 'reuse',
            newly_disclosed_categories: [],
            all_in_total_for_full_job_net_cents: null,
            wants_to_hang_up: false,
          },
        },
        policy,
        { ...INITIAL_SUPPLIER_STATE, consumed_concession_steps: [1] },
      );
      return { passed: skip.length > 0 && reuse.length > 0, details: { skip, reuse } };
    });
  });

  const rankable = (over: Partial<RankableQuote>): RankableQuote => ({
    quote_id: over.quote_id ?? 'q',
    call_id: 'c',
    supplier_id: 's',
    supplier_name: over.supplier_name ?? 'S',
    status: 'confirmed',
    availability_status: 'confirmed',
    validity_until: null,
    is_benchmark_outlier: false,
    missing_information: [],
    guaranteed_net_cents: 80000,
    conditional_cents: 0,
    refundable_deposit_cents: 0,
    tax_cents: 15200,
    cash_required_cents: 95200,
    expected_case_cents: 80000,
    worst_case_cents: 80000,
    total_before_negotiation_cents: 80000,
    total_after_negotiation_cents: 80000,
    line_count: 3,
    ...over,
  });

  it('outlier-never-auto-preferred', async () => {
    await check('outlier-never-auto-preferred', async () => {
      const result = rankQuotes(
        [
          rankable({ quote_id: 'cheap', supplier_name: 'Cheap', expected_case_cents: 30000, is_benchmark_outlier: true }),
          rankable({ quote_id: 'clean', supplier_name: 'Clean', expected_case_cents: 80000 }),
        ],
        { depositTolerance: 'any', now: new Date() },
      );
      return {
        passed: result.recommended_quote_id === 'clean',
        details: result.entries.map((e) => [e.supplier_name, e.rank, e.reason_codes]),
      };
    });
  });

  it('deposit-exceeds-tolerance-ineligible', async () => {
    await check('deposit-exceeds-tolerance-ineligible', async () => {
      const result = rankQuotes(
        [rankable({ quote_id: 'big', refundable_deposit_cents: 60000 })],
        { depositTolerance: 'up_to_500', now: new Date() },
      );
      const entry = result.entries[0];
      return {
        passed: !entry.eligible && entry.reason_codes.includes('DEPOSIT_EXCEEDS_TOLERANCE'),
        details: entry.reason_codes,
      };
    });
  });

  const engineCtx = {
    durationBusinessDays: 5,
    vatRate: 0.19,
    benchmarkMedianDailyCents: 9900,
    belowBenchmarkFraction: 0.7,
    probableConditionCategories: [],
    requiredCategories: ['rental', 'delivery', 'pickup', 'insurance'] as PriceLine['category'][],
  };

  it('deposit-not-a-cost', async () => {
    await check('deposit-not-a-cost', async () => {
      const b = computePriceBreakdown(
        [
          { label: 'rental', category: 'rental', amount_cents: 80000, unit: 'flat', is_mandatory: true, is_conditional: false },
          { label: 'deposit', category: 'deposit', amount_cents: 50000, unit: 'flat', is_mandatory: false, is_conditional: false },
        ],
        engineCtx,
      );
      return {
        passed:
          b.guaranteed_net_cents === 80000 &&
          b.refundable_deposit_cents === 50000 &&
          b.cash_required_cents === 80000 + b.tax_cents + 50000,
        details: b,
      };
    });
  });

  it('incomplete-quote-unknowns', async () => {
    await check('incomplete-quote-unknowns', async () => {
      const b = computePriceBreakdown(
        [{ label: 'rental', category: 'rental', amount_cents: 80000, unit: 'flat', is_mandatory: true, is_conditional: false }],
        engineCtx,
      );
      return {
        passed:
          b.unknown_categories.length === 3 &&
          b.computation_notes.join(' ').includes('incomplete quote is not a cheap quote'),
        details: b.unknown_categories,
      };
    });
  });

  it('percent-fee-resolution', async () => {
    await check('percent-fee-resolution', async () => {
      const b = computePriceBreakdown(
        [
          { label: 'rental', category: 'rental', amount_cents: 40000, unit: 'flat', is_mandatory: true, is_conditional: false },
          { label: 'insurance 15%', category: 'insurance', amount_cents: 1500, unit: 'percent_of_rental', is_mandatory: true, is_conditional: false },
        ],
        engineCtx,
      );
      return { passed: b.guaranteed_net_cents === 46000, details: b.guaranteed_net_cents };
    });
  });

  it('engine-overrides-model-total', async () => {
    await check('engine-overrides-model-total', async () => {
      const totals = computeQuoteTotals({
        vertical: getVertical(DEFAULT_VERTICAL_SLUG),
        fields: DEMO_FIELDS,
        lines: [
          { label: 'rental', category: 'rental', amount_cents: 60000, unit: 'flat', is_mandatory: true, is_conditional: false, condition_trigger: null, turn_index: 1 },
        ],
        concessions: [],
        modelClaimedTotalCents: 99999,
      });
      return {
        passed: totals.engineDisagreesWithModel && totals.totalAfterCents === 60000,
        details: totals.totalAfterCents,
      };
    });
  });

  const claim = (over: Partial<ValidatorClaim>): ValidatorClaim => ({
    claim_text: 'x',
    claim_type: 'price',
    turn_index: 5,
    cited_amount_cents: null,
    refers_to_competitor: true,
    ...over,
  });

  it('validator-unsupported-competing-price', async () => {
    await check('validator-unsupported-competing-price', async () => {
      const r = findSupport(claim({ cited_amount_cents: 70000 }), []);
      return { passed: !r.supported && r.severity === 'violation', details: r };
    });
  });

  it('validator-wrong-amount-cited', async () => {
    await check('validator-wrong-amount-cited', async () => {
      const toolCalls: ToolCallRecord[] = [
        {
          turn_index: 3,
          tool: 'request_verified_leverage',
          arguments: {},
          result: { ok: true, verified_total_cents: 82000 },
          at_ms: 1,
        },
      ];
      const r = findSupport(claim({ cited_amount_cents: 70000 }), toolCalls);
      return { passed: !r.supported && r.severity === 'violation', details: r };
    });
  });

  it('validator-budget-claim-unsupported', async () => {
    await check('validator-budget-claim-unsupported', async () => {
      const r = findSupport(
        claim({ claim_type: 'budget', cited_amount_cents: 70000, refers_to_competitor: false }),
        [],
      );
      return { passed: !r.supported && r.severity === 'violation', details: r };
    });
  });

  it('tool-failure-resilience', async () => {
    await check('tool-failure-resilience', async () => {
      const { executeTool } = await import('@/negotiation/buyer-tools');
      const tools = [
        {
          name: 'request_verified_leverage',
          description: 'x',
          parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
          execute: async () => {
            throw new Error('backend exploded');
          },
        },
      ];
      const records: ToolCallRecord[] = [];
      const result = (await executeTool(
        tools,
        'request_verified_leverage',
        '{}',
        (r) => records.push(r),
        0,
        0,
      )) as { ok: boolean; reason?: string };
      return {
        passed: result.ok === false && result.reason === 'tool_error' && records.length === 1,
        details: result,
      };
    });
  });

  it('truncated-transcript-validator', async () => {
    await check('truncated-transcript-validator', async () => {
      const callId = await createFixtureCall(spec.id, rivalSupplierId, spec.spec_fingerprint!);
      // Truncated: buyer cites leverage but the transcript cuts off mid-call.
      await supabaseAdmin()
        .from('call_sessions')
        .update({
          transcript: [
            { turn_index: 0, role: 'supplier', message: 'Yard, hello?', at_ms: 0 },
            {
              turn_index: 1,
              role: 'buyer',
              message: 'I have a verified competing quote at 700 euros net for the identical job.',
              at_ms: 900,
            },
          ],
          tool_calls: [],
        })
        .eq('id', callId);
      const findings = await runPostCallValidator(callId);
      return {
        passed: findings.some((f) => f.severity === 'violation' && f.claim_type === 'price'),
        details: findings,
      };
    });
  });

  it('double-confirmation-idempotent', async () => {
    await check('double-confirmation-idempotent', async () => {
      const s = await createConfirmedSpec();
      const again = await confirmSpec(s.id);
      return {
        passed:
          again.id === s.id &&
          again.spec_fingerprint === s.spec_fingerprint &&
          again.spec_version === s.spec_version,
        details: { fingerprint: s.spec_fingerprint?.slice(0, 12) },
      };
    });
  });

  it('demo-reset-scoped', async () => {
    await check('demo-reset-scoped', async () => {
      // The reset endpoint deletes only is_demo_run specs; verify the query scope
      // by construction: golden spec is not marked, fixture spec is.
      const supabase = supabaseAdmin();
      const { data: golden } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'demo_spec_id')
        .single();
      if (!golden) return { passed: false, details: 'no golden spec configured' };
      const { data: goldenRow } = await supabase
        .from('job_specs')
        .select('is_demo_run')
        .eq('id', golden.value)
        .single();
      return {
        passed: goldenRow?.is_demo_run === false,
        details: { golden_is_demo_run: goldenRow?.is_demo_run },
      };
    });
  });
});
