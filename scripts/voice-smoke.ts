/**
 * Voice smoke test — verifies the intake agent end to end over WebSocket
 * WITHOUT a microphone: signed URL auth, conversation initiation with dynamic
 * variables, first agent message, then a clean close.
 *
 * Budget: this consumes a few seconds of agent time. It is the loop
 * verification the plan allows; do not run it repeatedly.
 * Run: pnpm tsx scripts/voice-smoke.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function main() {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'intake_agent_id')
    .single();
  const agentId = data?.value;
  if (!agentId) throw new Error('intake_agent_id not set');

  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
    { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY! } },
  );
  if (!res.ok) throw new Error(`signed url failed: ${res.status}`);
  const { signed_url } = (await res.json()) as { signed_url: string };
  console.log('signed url ok');

  const ws = new WebSocket(signed_url);
  let conversationId: string | null = null;
  let gotAgentText = false;
  let gotAudio = false;
  const startedAt = Date.now();

  const done = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('timeout waiting for agent response'));
    }, 30_000);

    ws.on('open', () => {
      console.log('ws open, sending initiation with dynamic variables');
      ws.send(
        JSON.stringify({
          type: 'conversation_initiation_client_data',
          dynamic_variables: {
            vertical_label: 'Equipment rental — Stuttgart region',
            interview_outline: '1. What equipment do you need?',
          },
        }),
      );
    });

    ws.on('message', (raw) => {
      const event = JSON.parse(raw.toString()) as {
        type: string;
        conversation_initiation_metadata_event?: { conversation_id: string };
        agent_response_event?: { agent_response: string };
        ping_event?: { event_id: number };
      };
      if (event.type === 'conversation_initiation_metadata') {
        conversationId = event.conversation_initiation_metadata_event?.conversation_id ?? null;
        console.log('conversation started:', conversationId);
      }
      if (event.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', event_id: event.ping_event?.event_id }));
      }
      if (event.type === 'audio') {
        if (!gotAudio) console.log('audio chunk received (TTS works)');
        gotAudio = true;
      }
      if (event.type === 'agent_response') {
        gotAgentText = true;
        console.log('agent said:', event.agent_response_event?.agent_response?.slice(0, 120));
        // We heard the first message — that proves the loop. Hang up.
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    });

    ws.on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
  });

  await done;
  const seconds = Math.ceil((Date.now() - startedAt) / 1000);
  if (conversationId) {
    await supabase.from('voice_usage').upsert(
      { conversation_id: conversationId, kind: 'verification', seconds },
      { onConflict: 'conversation_id' },
    );
  }
  console.log(
    `smoke ok: agent_text=${gotAgentText} audio=${gotAudio} approx_seconds=${seconds} (recorded in voice_usage)`,
  );
}

void main();
