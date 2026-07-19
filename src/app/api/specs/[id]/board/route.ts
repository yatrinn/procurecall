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

  // Public hygiene: smoke-test sessions and calls that never actually started
  // (failed with fewer than two turns) do not belong on any public surface.
  const publicSessions = (sessions ?? []).filter((s) => {
    if (s.failure_state === 'smoke_test_session') return false;
    const turns = (s.transcript as unknown[]) ?? [];
    if (s.status === 'failed' && turns.length < 2) return false;
    return true;
  });
  const sessionIds = new Set(publicSessions.map((s) => s.id));

  // recording_url stores a private storage path; hand the client signed URLs.
  const withAudio = await Promise.all(
    publicSessions.map(async (s) => {
      if (!s.recording_url || s.recording_url.startsWith('http')) return s;
      const { data } = await supabase.storage
        .from('call-audio')
        .createSignedUrl(s.recording_url, 3600);
      return { ...s, recording_url: data?.signedUrl ?? null };
    }),
  );

  return NextResponse.json({
    sessions: withAudio,
    quotes: quotes ?? [],
    events: (events ?? []).filter((e) => sessionIds.has(e.call_id)),
    suppliers: suppliers ?? [],
  });
}
