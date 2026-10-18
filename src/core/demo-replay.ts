import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from '@/integrations/supabase-server';
import { getAppSetting } from '@/integrations/elevenlabs-server';
import { DEFAULT_VERTICAL_SLUG } from '@/config/verticals';
import { derivePins, type PinSourceEvent, type PinSourceSession } from '@/components/derive-pins';
import type { TapeTurn } from '@/components/call-tape';
import type { ReplaySession } from '@/app/demo/replay-types';

const BEHAVIOR_LABELS: Record<string, string> = {
  transparent_premium: 'transparent premium',
  low_headline: 'low headline, fees on request',
  hard_dispatcher: 'hard dispatcher',
};

export type DemoReplayPayload = {
  specId: string | null;
  fingerprint: string | null;
  decisionHref: string | null;
  sessions: ReplaySession[];
};

async function loadDemoReplayUncached(): Promise<DemoReplayPayload> {
  const [specId, callIdsJson] = await Promise.all([
    getAppSetting('demo_spec_id'),
    getAppSetting('demo_call_ids'),
  ]);

  if (!specId || !callIdsJson) {
    return { specId: null, fingerprint: null, decisionHref: null, sessions: [] };
  }

  const callIds = JSON.parse(callIdsJson) as string[];
  const supabase = supabaseAdmin();

  const [{ data: spec }, { data: sessions }, { data: quotes }, { data: events }, { data: suppliers }, { data: policies }] =
    await Promise.all([
      supabase.from('job_specs').select('spec_fingerprint').eq('id', specId).single(),
      supabase
        .from('call_sessions')
        .select(
          'id, supplier_id, transcript, tool_calls, friction_events, disclosure_event, outcome, outcome_type, recording_url',
        )
        .in('id', callIds),
      supabase
        .from('quotes')
        .select('call_id, total_before_negotiation_cents, total_after_negotiation_cents, currency')
        .in('call_id', callIds),
      supabase
        .from('negotiation_events')
        .select(
          'id, call_id, event_type, concession_type, amount_before_cents, amount_after_cents, transcript_ref',
        )
        .in('call_id', callIds),
      supabase.from('suppliers').select('id, name, location').eq('vertical_slug', DEFAULT_VERTICAL_SLUG),
      supabase.from('supplier_policies').select('supplier_id, behavior_profile'),
    ]);

  const fingerprint = spec?.spec_fingerprint ?? null;
  const decisionHref = `/decision/${specId}`;

  // Sign all recordings in parallel (was the main click-to-paint delay).
  const signedByPath = new Map<string, string>();
  const paths = (sessions ?? [])
    .map((s) => s.recording_url)
    .filter((u): u is string => !!u && !u.startsWith('http'));
  await Promise.all(
    [...new Set(paths)].map(async (path) => {
      const { data: signed } = await supabase.storage.from('call-audio').createSignedUrl(path, 3600);
      if (signed?.signedUrl) signedByPath.set(path, signed.signedUrl);
    }),
  );

  const replaySessions = callIds
    .map((callId) => {
      const session = sessions?.find((s) => s.id === callId);
      if (!session) return null;
      const supplier = suppliers?.find((s) => s.id === session.supplier_id);
      const behavior =
        policies?.find((p) => p.supplier_id === session.supplier_id)?.behavior_profile ?? '';
      const quote = quotes?.find((q) => q.call_id === callId);
      const transcript = session.transcript as TapeTurn[];
      const lastTurn = transcript[transcript.length - 1];
      const outcome = session.outcome as { summary?: string } | null;

      let audioUrl: string | null = null;
      if (session.recording_url) {
        audioUrl = session.recording_url.startsWith('http')
          ? session.recording_url
          : (signedByPath.get(session.recording_url) ?? null);
      }

      return {
        id: session.id,
        supplier_name: supplier?.name ?? 'Supplier',
        supplier_location: supplier?.location ?? null,
        behavior_label: BEHAVIOR_LABELS[behavior] ?? behavior,
        turns: transcript,
        pins: derivePins(session as unknown as PinSourceSession, (events ?? []) as PinSourceEvent[]),
        duration_ms: (lastTurn?.at_ms ?? 0) + 4000,
        outcome_line: outcome?.summary ?? '',
        quote_before_cents: quote?.total_before_negotiation_cents ?? null,
        quote_after_cents: quote?.total_after_negotiation_cents ?? null,
        audio_url: audioUrl,
        currency: quote?.currency ?? 'EUR',
      } satisfies ReplaySession;
    })
    .filter((x): x is ReplaySession => x !== null);

  return { specId, fingerprint, decisionHref, sessions: replaySessions };
}

/** Cached ~2 min — golden demo changes rarely; signed URLs last 1 h. */
export const getDemoReplay = unstable_cache(loadDemoReplayUncached, ['demo-replay-v2'], {
  revalidate: 120,
});
