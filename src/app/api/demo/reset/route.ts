import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/integrations/supabase-server';

export const maxDuration = 60;

/**
 * Resets the public demo: removes all visitor-run data (specs marked
 * is_demo_run and everything hanging off them). The golden replay data is
 * never touched. Rate-limited to one reset per IP per minute.
 */
export async function POST(request: Request) {
  try {
    const supabase = supabaseAdmin();
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const ipHash = createHash('sha256').update(ip).digest('hex').slice(0, 24);
    const minuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { count } = await supabase
      .from('demo_actions')
      .select('*', { count: 'exact', head: true })
      .eq('action', 'reset')
      .eq('ip_hash', ipHash)
      .gte('created_at', minuteAgo);
    if ((count ?? 0) >= 1) {
      return NextResponse.json({ error: 'Reset already ran a moment ago.' }, { status: 429 });
    }

    const { data: demoSpecs } = await supabase
      .from('job_specs')
      .select('id')
      .eq('is_demo_run', true);
    const specIds = (demoSpecs ?? []).map((s) => s.id);

    let removedCalls = 0;
    if (specIds.length > 0) {
      const { data: sessions } = await supabase
        .from('call_sessions')
        .select('id')
        .in('job_spec_id', specIds);
      const callIds = (sessions ?? []).map((s) => s.id);
      removedCalls = callIds.length;

      if (callIds.length > 0) {
        await supabase.from('validator_findings').delete().in('call_id', callIds);
        await supabase.from('negotiation_events').delete().in('call_id', callIds);
        await supabase.from('quote_lines').delete().in('call_id', callIds);
        await supabase.from('quotes').delete().in('call_id', callIds);
      }
      await supabase.from('recommendations').delete().in('job_spec_id', specIds);
      if (callIds.length > 0) {
        await supabase.from('call_sessions').delete().in('id', callIds);
      }
      await supabase.from('job_specs').delete().in('id', specIds);
    }

    await supabase.from('demo_actions').insert({ action: 'reset', ip_hash: ipHash });
    return NextResponse.json({ ok: true, removed_specs: specIds.length, removed_calls: removedCalls });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Reset failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
