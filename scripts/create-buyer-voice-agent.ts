/**
 * Creates/updates the buyer VOICE agent whose LLM is our custom-LLM endpoint,
 * so the voice tier runs the identical brain and tool gating as the text tier.
 *
 * - generates a bearer token (app_settings.voice_llm_token) our endpoint checks
 * - stores it as an ElevenLabs workspace secret for the custom LLM auth
 * - first_message speaks immediately on connect (no 5–10s wait for the brain)
 * - end_call built-in so the agent can hang up after a mutual goodbye
 *
 * Run: pnpm tsx scripts/create-buyer-voice-agent.ts <base_url>
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { randomBytes } from 'node:crypto';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { createClient } from '@supabase/supabase-js';

const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY! });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function getSetting(key: string): Promise<string | null> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}
async function setSetting(key: string, value: string) {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

async function main() {
  const baseUrl = process.argv[2] ?? 'https://procurecall.vercel.app';

  let token = await getSetting('voice_llm_token');
  if (!token) {
    token = randomBytes(24).toString('hex');
    await setSetting('voice_llm_token', token);
    console.log('voice_llm_token generated');
  }

  let secretId = await getSetting('voice_llm_secret_id');
  if (!secretId) {
    const res = await fetch('https://api.elevenlabs.io/v1/convai/secrets', {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'new', name: `procurecall-voice-llm-${Date.now()}`, value: token }),
    });
    if (!res.ok) throw new Error(`secret create failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { secret_id: string };
    secretId = body.secret_id;
    await setSetting('voice_llm_secret_id', secretId);
    console.log('workspace secret created');
  }

  // Spoken immediately on connect by ElevenLabs TTS — does NOT wait for our
  // custom LLM. That is what kills the 5–10s dead air at call start.
  const firstMessage =
    "Hi, this is ProcureCall — I'm an AI procurement assistant calling about a scissor lift rental. Do you have a minute?";

  const conversationConfig = {
    agent: {
      firstMessage,
      language: 'en',
      prompt: {
        prompt:
          'You are a procurement caller speaking US English only. Never switch languages. Follow the custom LLM outputs exactly — keep turns short. After both sides have said goodbye, call end_call. Never say bye more than once.',
        llm: 'custom-llm' as never,
        cascadeTimeoutSeconds: 15,
        // Hang up when the brain returns the end_call system tool.
        builtInTools: {
          end_call: {
            name: 'end_call',
            description:
              'End the phone call immediately after a mutual goodbye or once the quote outcome is recorded and you have said goodbye once. Never call this mid-negotiation.',
            params: { systemToolType: 'end_call' },
          },
        } as never,
        customLlm: {
          url: `${baseUrl}/api/llm/v1`,
          modelId: 'procurecall-buyer',
          apiKey: { secretId },
          requestHeaders: {
            'x-call-id': { variableName: 'call_id' } as never,
          },
          apiType: 'chat_completions' as never,
        },
      },
      dynamicVariables: {
        dynamicVariablePlaceholders: { call_id: 'missing' },
      },
    },
    conversation: {
      maxDurationSeconds: 480,
    },
    turn: {
      turnTimeout: 8,
      silenceEndCallTimeout: 25,
    },
  };
  const platformSettings = { auth: { enableAuth: true } };

  const existing = await getSetting('buyer_voice_agent_id');
  if (existing) {
    try {
      await elevenlabs.conversationalAi.agents.update(existing, {
        conversationConfig,
        platformSettings,
      });
      console.log(`buyer voice agent updated: ${existing} → ${baseUrl}`);
      return;
    } catch (e) {
      console.log(`update failed (${e instanceof Error ? e.message : 'error'}); creating new`);
    }
  }
  const agent = await elevenlabs.conversationalAi.agents.create({
    name: 'ProcureCall Buyer (voice)',
    tags: ['procurecall', 'buyer'],
    conversationConfig,
    platformSettings,
  });
  await setSetting('buyer_voice_agent_id', agent.agentId);
  console.log(`buyer voice agent created: ${agent.agentId} → ${baseUrl}`);
}

void main();
