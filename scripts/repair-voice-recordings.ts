/**
 * One-off repair: voice-complete's audio fetch has no retry and can race
 * ElevenLabs' post-processing, silently leaving recording_url null even
 * though the audio becomes available moments later. This re-fetches and
 * uploads recordings for calls that finished without one.
 * Run: pnpm tsx scripts/repair-voice-recordings.ts
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

async function main() {
  const { data: calls, error } = await supabase
    .from('call_sessions')
    .select('id, conversation_id, supplier_id')
    .eq('tier', 'voice')
    .is('recording_url', null)
    .not('conversation_id', 'is', null);
  if (error) throw error;
  console.log(`found ${calls?.length ?? 0} voice calls without a recording`);

  for (const call of calls ?? []) {
    try {
      const audio = await elevenlabs.conversationalAi.conversations.audio.get(
        call.conversation_id as string,
      );
      const chunks: Uint8Array[] = [];
      const reader = (audio as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      const buffer = Buffer.concat(chunks);
      if (buffer.byteLength === 0) {
        console.log(`  ${call.id}: empty audio, skipping`);
        continue;
      }
      const path = `${call.id}.mp3`;
      const { error: upErr } = await supabase.storage
        .from('call-audio')
        .upload(path, buffer, { contentType: 'audio/mpeg', upsert: true });
      if (upErr) {
        console.log(`  ${call.id}: upload failed — ${upErr.message}`);
        continue;
      }
      await supabase.from('call_sessions').update({ recording_url: path }).eq('id', call.id);
      console.log(`  ${call.id}: uploaded ${(buffer.byteLength / 1024).toFixed(0)} KiB -> ${path}`);
    } catch (e) {
      console.log(`  ${call.id}: fetch failed — ${e instanceof Error ? e.message : e}`);
    }
  }
}

void main();
