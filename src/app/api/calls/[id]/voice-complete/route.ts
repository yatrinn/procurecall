import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/integrations/supabase-server';
import { elevenlabs } from '@/integrations/elevenlabs-server';
import { recordVoiceUsage } from '@/core/voice-budget';
import { getSpec, type SpecRow } from '@/core/specs-repo';
import { getVertical } from '@/config/verticals';
import { persistQuote } from '@/negotiation/orchestrator';
import { OutcomeSchema, type Outcome, type QuoteLineArgs, type ToolCallRecord, type TranscriptTurn } from '@/negotiation/types';

export const maxDuration = 120;

const BodySchema = z.object({ conversation_id: z.string().min(1) });

/**
 * Finalizes a voice call: pulls the authoritative transcript + recording from
 * ElevenLabs, stores the audio in Supabase Storage, aligns turns to audio
 * seconds, persists the structured outcome/quote from the tool calls the
 * brain executed during the call, books voice usage, runs the validator.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: callId } = await params;
    const { conversation_id } = BodySchema.parse(await request.json());
    const supabase = supabaseAdmin();

    const { data: session } = await supabase
      .from('call_sessions')
      .select('id, job_spec_id, supplier_id, tool_calls, started_at, spec_fingerprint')
      .eq('id', callId)
      .single();
    if (!session) return NextResponse.json({ error: 'call not found' }, { status: 404 });

    // Authoritative conversation data (retry while analysis finishes).
    interface ConversationShape {
      status?: string;
      transcript?: Array<{
        role: string;
        message: string | null;
        timeInCallSecs?: number;
      }>;
      metadata?: { callDurationSecs?: number };
    }
    let conversation: ConversationShape | null = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      conversation = (await elevenlabs().conversationalAi.conversations.get(
        conversation_id,
      )) as unknown as ConversationShape;
      if (conversation?.status === 'done' || conversation?.status === 'processing') break;
      await new Promise((r) => setTimeout(r, 2000));
    }

    const turns: TranscriptTurn[] = (conversation?.transcript ?? [])
      .filter((t) => (t.message ?? '').trim().length > 0)
      .map((t, i) => ({
        turn_index: i,
        role: t.role === 'agent' ? 'buyer' : 'supplier',
        message: t.message ?? '',
        at_ms: Math.round((t.timeInCallSecs ?? 0) * 1000),
        audio_start_s: t.timeInCallSecs ?? null,
      }));

    // Recording → private bucket; the board resolves signed URLs on read.
    let recordingPath: string | null = null;
    try {
      const audio = await elevenlabs().conversationalAi.conversations.audio.get(conversation_id);
      const chunks: Uint8Array[] = [];
      const reader = (audio as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      const buffer = Buffer.concat(chunks);
      if (buffer.byteLength > 0) {
        const path = `${callId}.mp3`;
        const { error: upErr } = await supabase.storage
          .from('call-audio')
          .upload(path, buffer, { contentType: 'audio/mpeg', upsert: true });
        if (!upErr) recordingPath = path;
      }
    } catch {
      // Audio may not be ready; the call result stands without it.
    }

    const durationSecs =
      conversation?.metadata?.callDurationSecs ??
      (session.started_at
        ? Math.round((Date.now() - new Date(session.started_at).getTime()) / 1000)
        : null);
    await recordVoiceUsage({
      conversationId: conversation_id,
      kind: 'negotiation',
      seconds: durationSecs,
    });

    // Structured outcome from the tools the brain called during the session.
    const toolCalls = (session.tool_calls as ToolCallRecord[]) ?? [];
    const loggedLines: Array<QuoteLineArgs & { turn_index: number }> = [];
    let outcome: Outcome | null = null;
    for (const tc of toolCalls) {
      const result = tc.result as { logged?: boolean; line?: QuoteLineArgs; ended?: boolean; outcome?: unknown };
      if (tc.tool === 'log_quote_line' && result.logged && result.line) {
        loggedLines.push({ ...result.line, turn_index: tc.turn_index });
      }
      if (tc.tool === 'record_outcome' && result.ended && result.outcome) {
        outcome = OutcomeSchema.parse(result.outcome);
      }
    }
    if (!outcome) {
      outcome = {
        type: 'documented_decline',
        summary: 'Voice call ended without a recorded structured outcome.',
        supplier_confirmed_total: null,
        total_net_cents: null,
        availability_confirmed: null,
        validity_days: null,
        callback_when: null,
        decline_reason: 'no_outcome_recorded',
      };
    }

    await supabase
      .from('call_sessions')
      .update({
        status: 'completed',
        transcript: turns,
        conversation_id,
        recording_url: recordingPath,
        outcome,
        outcome_type: outcome.type,
        ended_at: new Date().toISOString(),
      })
      .eq('id', callId);

    const spec = (await getSpec(session.job_spec_id)) as SpecRow;
    await persistQuote({
      callId,
      spec,
      supplierId: session.supplier_id,
      vertical: getVertical(spec.vertical_slug),
      outcome,
      loggedLines,
    });

    try {
      const { runPostCallValidator } = await import('@/core/validator');
      await runPostCallValidator(callId);
    } catch (e) {
      console.error('validator failed after voice call:', e);
    }

    return NextResponse.json({ ok: true, turns: turns.length, recording: !!recordingPath });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'voice completion failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
