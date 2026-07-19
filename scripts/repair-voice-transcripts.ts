/**
 * One-off repair for the three golden voice calls.
 *
 * Root cause found: src/app/api/llm/v1/chat/completions/route.ts rebuilds the
 * `transcript` column on every turn from the OpenAI message history, but
 * writes `at_ms: 0` for every turn except the one just generated (line ~187).
 * Since this update runs on every turn, only the LAST turn ever ends up with
 * a real timestamp — exactly what we see in the DB. Separately, for one call
 * (Neckar), the live-persisted array is missing its final two turns (10, 11)
 * relative to ElevenLabs' fully-processed transcript, even though tool_calls
 * already reference turn_index 11 — a race in the live-persist write path.
 *
 * ElevenLabs' now-`done` conversation transcripts are complete and correctly
 * timed. This script replaces `call_sessions.transcript` with that version,
 * but ONLY after verifying the first N turns are the same content as what's
 * stored (so any existing quote_lines.transcript_ref, which points at these
 * early indices, keeps pointing at the same dialogue). It never shortens a
 * transcript and never touches tool_calls or quotes.
 *
 * Run: pnpm tsx scripts/repair-voice-transcripts.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { createClient } from '@supabase/supabase-js';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY! });

const CALL_IDS = [
  'dab61976-052a-4b63-b42a-214227aa9619', // BW Lift
  'c9711cf0-63a8-4557-9afc-ccb10612d985', // Neckar
  '3c10bc69-e8db-4344-b479-1d37d0022439', // Hebetec
];

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function main() {
  for (const callId of CALL_IDS) {
    const { data: call, error } = await supabase
      .from('call_sessions')
      .select('id, conversation_id, transcript, tool_calls')
      .eq('id', callId)
      .single();
    if (error || !call) {
      console.log(`${callId}: not found (${error?.message})`);
      continue;
    }
    const stored = call.transcript as Array<{ turn_index: number; role: string; message: string }>;
    const conv = (await elevenlabs.conversationalAi.conversations.get(
      call.conversation_id as string,
    )) as unknown as {
      status?: string;
      transcript?: Array<{ role: string; message: string | null; timeInCallSecs?: number }>;
    };
    if (conv.status !== 'done') {
      console.log(`${callId}: EL status is "${conv.status}", not done yet — skipping`);
      continue;
    }
    const elTurns = (conv.transcript ?? [])
      .filter((t) => (t.message ?? '').trim().length > 0)
      .map((t, i) => ({
        turn_index: i,
        role: t.role === 'agent' ? 'buyer' : 'supplier',
        message: t.message ?? '',
        at_ms: Math.round((t.timeInCallSecs ?? 0) * 1000),
        audio_start_s: t.timeInCallSecs ?? null,
      }));

    if (elTurns.length < stored.length) {
      console.log(
        `${callId}: EL has fewer turns (${elTurns.length}) than stored (${stored.length}) — skipping, would lose data`,
      );
      continue;
    }
    let prefixOk = true;
    for (let i = 0; i < stored.length; i++) {
      if (
        stored[i].role !== elTurns[i].role ||
        normalize(stored[i].message) !== normalize(elTurns[i].message)
      ) {
        prefixOk = false;
        console.log(`${callId}: mismatch at turn ${i}`);
        console.log(`  stored: ${stored[i].role} ${JSON.stringify(stored[i].message.slice(0, 60))}`);
        console.log(`  el:     ${elTurns[i].role} ${JSON.stringify(elTurns[i].message.slice(0, 60))}`);
        break;
      }
    }
    if (!prefixOk) {
      console.log(`${callId}: prefix mismatch — NOT overwriting, needs manual review`);
      continue;
    }

    const maxToolTurn = Math.max(...(call.tool_calls as Array<{ turn_index: number }>).map((t) => t.turn_index), -1);
    await supabase.from('call_sessions').update({ transcript: elTurns }).eq('id', callId);
    console.log(
      `${callId}: OK — replaced ${stored.length} -> ${elTurns.length} turns (max tool_call turn_index referenced: ${maxToolTurn}), all real timestamps now`,
    );
  }
}

void main();
