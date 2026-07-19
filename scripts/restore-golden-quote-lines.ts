/**
 * Restores quote_lines for the golden demo run from the tool_calls persisted
 * on each call session, then recomputes quote totals and clears the cached
 * recommendation. Also unmarks the golden spec as is_demo_run so the public
 * demo reset can never wipe it again.
 * Run: pnpm tsx scripts/restore-golden-quote-lines.ts
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

async function main() {
  const { data: spec } = await supabase
    .from('job_specs')
    .select('id, vertical_slug, spec, is_demo_run')
    .eq('id', GOLDEN_SPEC_ID)
    .single();
  if (!spec) throw new Error('golden spec not found');

  if (spec.is_demo_run) {
    const { error } = await supabase
      .from('job_specs')
      .update({ is_demo_run: false })
      .eq('id', GOLDEN_SPEC_ID);
    if (error) throw error;
    console.log('golden spec unmarked as demo run (reset can no longer wipe it)');
  }

  const { data: quotes } = await supabase
    .from('quotes')
    .select('id, call_id, status')
    .eq('job_spec_id', GOLDEN_SPEC_ID);

  for (const quote of quotes ?? []) {
    const { count } = await supabase
      .from('quote_lines')
      .select('*', { count: 'exact', head: true })
      .eq('quote_id', quote.id);
    if ((count ?? 0) > 0) {
      console.log(`quote ${quote.id.slice(0, 8)}: ${count} lines already present, skipping`);
      continue;
    }

    const { data: session } = await supabase
      .from('call_sessions')
      .select('id, tool_calls, transcript, outcome')
      .eq('id', quote.call_id)
      .single();
    if (!session) continue;

    const turnCount = ((session.transcript as unknown[]) ?? []).length;
    const toolCalls = (session.tool_calls as ToolCallRecord[]) ?? [];
    const lines: Array<QuoteLineArgs & { turn_index: number }> = [];
    for (const tc of toolCalls) {
      const result = tc.result as { logged?: boolean; line?: QuoteLineArgs };
      if (tc.tool === 'log_quote_line' && result?.logged && result.line) {
        lines.push({
          ...result.line,
          turn_index: Math.min(tc.turn_index, Math.max(0, turnCount - 1)),
        });
      }
    }
    if (lines.length === 0 || turnCount === 0) {
      console.log(`quote ${quote.id.slice(0, 8)}: nothing restorable (lines ${lines.length}, turns ${turnCount})`);
      continue;
    }

    const rows = lines.map((line) => ({
      quote_id: quote.id,
      call_id: quote.call_id,
      label: line.label,
      amount_cents: line.amount_cents,
      unit: line.unit,
      is_mandatory: line.is_mandatory,
      is_conditional: line.is_conditional,
      condition_trigger: line.condition_trigger,
      category: line.category,
      transcript_ref: { call_id: quote.call_id, turn_index: line.turn_index },
    }));
    const { error: insErr } = await supabase.from('quote_lines').insert(rows);
    if (insErr) throw new Error(`insert failed for quote ${quote.id}: ${insErr.message}`);
    console.log(`quote ${quote.id.slice(0, 8)} (${quote.status}): restored ${rows.length} lines`);

    // Recompute deterministic totals from the restored lines.
    const { data: events } = await supabase
      .from('negotiation_events')
      .select('event_type, concession_type, amount_before_cents, amount_after_cents')
      .eq('call_id', quote.call_id)
      .in('event_type', ['concession', 'fee_waived', 'fee_reduced', 'rate_reduced']);
    const outcome = session.outcome as { total_net_cents?: number | null } | null;
    const totals = computeQuoteTotals({
      vertical: getVertical(spec.vertical_slug),
      fields: (spec.spec as { fields: Record<string, unknown> }).fields,
      lines,
      concessions: (events ?? []).map((e) => ({
        category_hint: e.concession_type,
        amount_before_cents: e.amount_before_cents,
        amount_after_cents: e.amount_after_cents,
      })),
      modelClaimedTotalCents: outcome?.total_net_cents ?? null,
    });
    const { error: updErr } = await supabase
      .from('quotes')
      .update({
        total_before_negotiation_cents: totals.totalBeforeCents,
        total_after_negotiation_cents: totals.totalAfterCents,
        price_breakdown: totals.breakdown,
        is_benchmark_outlier: totals.breakdown.is_benchmark_outlier,
        missing_information: totals.breakdown.unknown_categories,
      })
      .eq('id', quote.id);
    if (updErr) throw updErr;
    console.log(
      `  totals: before ${totals.totalBeforeCents} after ${totals.totalAfterCents} (outlier ${totals.breakdown.is_benchmark_outlier})`,
    );
  }

  const { error: recErr } = await supabase
    .from('recommendations')
    .delete()
    .eq('job_spec_id', GOLDEN_SPEC_ID);
  if (recErr) throw recErr;
  console.log('cached recommendation cleared; decision room recomputes on next load');
}

void main();
