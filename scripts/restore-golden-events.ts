/**
 * Restores negotiation_events for the golden demo run from the tool_calls
 * persisted on each call session (log_concession + request_verified_leverage),
 * then recomputes quote totals so before/after deltas reappear.
 * Idempotent: skips calls that already have events.
 * Run: pnpm tsx scripts/restore-golden-events.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { createClient } from '@supabase/supabase-js';
import { computeQuoteTotals } from '../src/core/quote-pricing';
import { getVertical } from '../src/config/verticals';
import type { QuoteLineArgs, ToolCallRecord } from '../src/negotiation/types';

const GOLDEN_SPEC_ID = 'e323df1f-1d71-4617-9e2a-bef7e36c614f';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

interface ConcessionArgs {
  event_type: string;
  concession_type: string;
  amount_before_cents: number | null;
  amount_after_cents: number | null;
}

async function main() {
  const { data: spec } = await supabase
    .from('job_specs')
    .select('id, vertical_slug, spec')
    .eq('id', GOLDEN_SPEC_ID)
    .single();
  if (!spec) throw new Error('golden spec not found');

  const { data: sessions } = await supabase
    .from('call_sessions')
    .select('id, tool_calls, outcome')
    .eq('job_spec_id', GOLDEN_SPEC_ID);

  for (const session of sessions ?? []) {
    const { count } = await supabase
      .from('negotiation_events')
      .select('*', { count: 'exact', head: true })
      .eq('call_id', session.id);
    if ((count ?? 0) > 0) {
      console.log(`call ${session.id.slice(0, 8)}: ${count} events already present, skipping`);
      continue;
    }

    const toolCalls = (session.tool_calls as ToolCallRecord[]) ?? [];
    let restored = 0;
    for (const tc of toolCalls) {
      if (tc.tool === 'log_concession') {
        const args = tc.arguments as unknown as ConcessionArgs | undefined;
        if (!args?.event_type) continue;
        const delta =
          args.amount_before_cents !== null && args.amount_after_cents !== null
            ? args.amount_before_cents - args.amount_after_cents
            : null;
        const { error } = await supabase.from('negotiation_events').insert({
          call_id: session.id,
          event_type: args.event_type,
          concession_type: args.concession_type,
          amount_before_cents: args.amount_before_cents,
          amount_after_cents: args.amount_after_cents,
          delta_abs_cents: delta,
          delta_pct:
            delta !== null && args.amount_before_cents
              ? Math.round((delta / args.amount_before_cents) * 10_000) / 100
              : null,
          transcript_ref: { call_id: session.id, turn_index: tc.turn_index },
        });
        if (error) throw new Error(`concession restore failed: ${error.message}`);
        restored++;
      }
      if (tc.tool === 'request_verified_leverage') {
        const result = tc.result as { ok?: boolean; quote_id?: string } | undefined;
        if (!result?.ok || !result.quote_id) continue;
        const { error } = await supabase.from('negotiation_events').insert({
          call_id: session.id,
          event_type: 'leverage_used',
          lever_used: 'verified_competing_quote',
          verified_source_quote_id: result.quote_id,
          tool_returned_evidence: result,
          transcript_ref: { call_id: session.id, turn_index: tc.turn_index },
        });
        if (error) throw new Error(`leverage restore failed: ${error.message}`);
        restored++;
      }
    }
    if (restored > 0) console.log(`call ${session.id.slice(0, 8)}: restored ${restored} events`);
  }

  // Recompute totals now that concessions exist again.
  const { data: quotes } = await supabase
    .from('quotes')
    .select('id, call_id, status')
    .eq('job_spec_id', GOLDEN_SPEC_ID);
  for (const quote of quotes ?? []) {
    const [{ data: lines }, { data: events }, { data: session }] = await Promise.all([
      supabase
        .from('quote_lines')
        .select('label, amount_cents, unit, is_mandatory, is_conditional, condition_trigger, category, transcript_ref')
        .eq('quote_id', quote.id),
      supabase
        .from('negotiation_events')
        .select('event_type, concession_type, amount_before_cents, amount_after_cents')
        .eq('call_id', quote.call_id)
        .in('event_type', ['concession', 'fee_waived', 'fee_reduced', 'rate_reduced']),
      supabase.from('call_sessions').select('outcome').eq('id', quote.call_id).single(),
    ]);
    if (!lines || lines.length === 0) continue;
    const outcome = session?.outcome as { total_net_cents?: number | null } | null;
    const quoteLines: Array<QuoteLineArgs & { turn_index: number }> = lines.map((l) => ({
      label: l.label,
      category: l.category as QuoteLineArgs['category'],
      amount_cents: l.amount_cents ?? 0,
      unit: (l.unit ?? 'flat') as QuoteLineArgs['unit'],
      is_mandatory: l.is_mandatory,
      is_conditional: l.is_conditional,
      condition_trigger: l.condition_trigger,
      turn_index: (l.transcript_ref as { turn_index?: number })?.turn_index ?? 0,
    }));
    const totals = computeQuoteTotals({
      vertical: getVertical(spec.vertical_slug),
      fields: (spec.spec as { fields: Record<string, unknown> }).fields,
      lines: quoteLines,
      concessions: (events ?? []).map((e) => ({
        category_hint: e.concession_type,
        amount_before_cents: e.amount_before_cents,
        amount_after_cents: e.amount_after_cents,
      })),
      modelClaimedTotalCents: outcome?.total_net_cents ?? null,
    });
    await supabase
      .from('quotes')
      .update({
        total_before_negotiation_cents: totals.totalBeforeCents,
        total_after_negotiation_cents: totals.totalAfterCents,
        price_breakdown: totals.breakdown,
        is_benchmark_outlier: totals.breakdown.is_benchmark_outlier,
        missing_information: totals.breakdown.unknown_categories,
      })
      .eq('id', quote.id);
    console.log(
      `quote ${quote.id.slice(0, 8)} (${quote.status}): before ${totals.totalBeforeCents} after ${totals.totalAfterCents}`,
    );
  }

  await supabase.from('recommendations').delete().eq('job_spec_id', GOLDEN_SPEC_ID);
  console.log('recommendation cache cleared');
}

void main();
