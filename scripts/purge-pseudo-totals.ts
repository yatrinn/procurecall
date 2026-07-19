/**
 * Data repair: early calls (before the "never log grand totals" instruction)
 * logged bundled all-in totals as `other`/mandatory lines. They are not fees;
 * summing them explodes the engine total. Delete them, then recompute via
 * repair-quotes.ts.
 * Run: pnpm tsx scripts/purge-pseudo-totals.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const PSEUDO_TOTAL_PATTERN =
  /(all[- ]in|firm quote|net hire total|hire period|before deposit|bundled|full[- ]job|confirmed .*total|five-day rental with delivery)/i;

async function main() {
  const { data: lines } = await supabase
    .from('quote_lines')
    .select('id, quote_id, label, category, amount_cents');
  const pseudo = (lines ?? []).filter(
    (l) =>
      (l.category === 'other' && (l.amount_cents ?? 0) >= 50000 && PSEUDO_TOTAL_PATTERN.test(l.label)) ||
      (l.category === 'other' && /quote validity/i.test(l.label)),
  );
  for (const l of pseudo) {
    console.log('deleting pseudo-total line:', l.quote_id.slice(0, 8), '|', l.amount_cents, '|', l.label.slice(0, 60));
    await supabase.from('quote_lines').delete().eq('id', l.id);
  }
  console.log(`deleted ${pseudo.length} pseudo-total lines`);
}

void main();
