/**
 * Marks the golden demo run: the spec and the three calls shown as the
 * verified replay on /demo. Values are stored in app_settings.
 * Run: pnpm tsx scripts/set-demo-golden.ts <spec_id> <call_id_b> <call_id_c> <call_id_a>
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function main() {
  const [specId, ...callIds] = process.argv.slice(2);
  if (!specId || callIds.length === 0) {
    console.error('usage: set-demo-golden.ts <spec_id> <call_id...>');
    process.exit(1);
  }
  const { data: spec, error } = await supabase
    .from('job_specs')
    .select('id, spec, confirmed_by_user')
    .eq('id', specId)
    .single();
  if (error || !spec) throw new Error('spec not found');
  if (!spec.confirmed_by_user) throw new Error('golden spec must be confirmed');

  const upserts = [
    { key: 'demo_spec_id', value: specId },
    { key: 'demo_call_ids', value: JSON.stringify(callIds) },
    { key: 'demo_spec_fields', value: JSON.stringify((spec.spec as { fields: unknown }).fields) },
  ];
  for (const row of upserts) {
    const { error: upErr } = await supabase
      .from('app_settings')
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (upErr) throw upErr;
  }
  console.log('golden demo set:', specId, callIds);
}

void main();
