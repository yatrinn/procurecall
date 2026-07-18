import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/integrations/supabase-server';

/**
 * Live board state for a spec: sessions with transcripts, tool pins, quotes.
 * Supplier private state is explicitly excluded — it never leaves the server.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = supabaseAdmin();

  const [{ data: sessions }, { data: quotes }, { data: events }, { data: suppliers }] =
    await Promise.all([
      supabase
        .from('call_sessions')
        .select(
          'id, supplier_id, transport_mode, tier, status, started_at, ended_at, transcript, tool_calls, friction_events, disclosure_event, outcome, outcome_type, failure_state, spec_fingerprint, recording_url',
        )
        .eq('job_spec_id', id)
        .order('created_at', { ascending: true }),
      supabase
        .from('quotes')
        .select(
          'id, call_id, supplier_id, status, availability_status, validity_until, total_before_negotiation_cents, total_after_negotiation_cents, currency, tax_basis, price_breakdown, is_benchmark_outlier, missing_information',
        )
        .eq('job_spec_id', id),
      supabase
        .from('negotiation_events')
        .select(
          'id, call_id, event_type, lever_used, verified_source_quote_id, concession_type, amount_before_cents, amount_after_cents, delta_abs_cents, delta_pct, transcript_ref, created_at',
        )
        .order('created_at', { ascending: true }),
      supabase.from('suppliers').select('id, name, location, is_simulated, distance_km'),
    ]);

  const sessionIds = new Set((sessions ?? []).map((s) => s.id));
  return NextResponse.json({
    sessions: sessions ?? [],
    quotes: quotes ?? [],
    events: (events ?? []).filter((e) => sessionIds.has(e.call_id)),
    suppliers: suppliers ?? [],
  });
}
