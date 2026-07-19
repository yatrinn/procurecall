/**
 * Collapses golden-run quote_lines to one active row per category (last turn
 * wins) and clears the recommendation cache so the decision room recomputes
 * under rank-1.1 (below-benchmark never auto-preferred).
 * Run: pnpm tsx scripts/collapse-golden-quote-lines.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { createClient } from '@supabase/supabase-js';
import { collapseActiveQuoteLines } from '../src/core/quote-pricing';
import type { QuoteLineArgs } from '../src/negotiation/types';

const GOLDEN_SPEC_ID = 'e323df1f-1d71-4617-9e2a-bef7e36c614f';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  const { data: quotes } = await supabase
    .from('quotes')
    .select('id, call_id')
    .eq('job_spec_id', GOLDEN_SPEC_ID);

  for (const quote of quotes ?? []) {
    const { data: lines } = await supabase
      .from('quote_lines')
      .select(
        'id, label, amount_cents, unit, is_mandatory, is_conditional, condition_trigger, category, transcript_ref',
      )
      .eq('quote_id', quote.id);
    if (!lines || lines.length === 0) continue;

    const collapsed = collapseActiveQuoteLines(
      lines.map((l) => ({
        label: l.label,
        category: l.category as QuoteLineArgs['category'],
        amount_cents: l.amount_cents ?? 0,
        unit: (l.unit ?? 'flat') as QuoteLineArgs['unit'],
        is_mandatory: l.is_mandatory,
        is_conditional: l.is_conditional,
        condition_trigger: l.condition_trigger,
        turn_index: (l.transcript_ref as { turn_index?: number })?.turn_index ?? 0,
      })),
    );

    const keepIds = new Set<string>();
    for (const c of collapsed) {
      const match = lines.find(
        (l) =>
          l.category === c.category &&
          l.is_conditional === c.is_conditional &&
          ((l.transcript_ref as { turn_index?: number })?.turn_index ?? 0) === c.turn_index &&
          (l.amount_cents ?? 0) === c.amount_cents,
      );
      if (match) keepIds.add(match.id);
    }

    const dropIds = lines.filter((l) => !keepIds.has(l.id)).map((l) => l.id);
    if (dropIds.length > 0) {
      const { error } = await supabase.from('quote_lines').delete().in('id', dropIds);
      if (error) throw error;
    }
    console.log(
      `quote ${quote.id.slice(0, 8)}: ${lines.length} → ${collapsed.length} (dropped ${dropIds.length})`,
    );
  }

  await supabase.from('recommendations').delete().eq('job_spec_id', GOLDEN_SPEC_ID);
  console.log('recommendation cache cleared');
}

void main();
