/**
 * Creates or updates the ElevenLabs agents used by ProcureCall and stores
 * their ids in the app_settings table. Idempotent: safe to run repeatedly.
 *
 * Agents:
 * - intake: voice interview agent (hosted LLM, dynamic variables per vertical)
 *
 * Budget guards baked into the agent config: hard max duration, silence
 * auto-hangup. Voice is never the iteration tier.
 *
 * Run: pnpm tsx scripts/create-agents.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { createClient } from '@supabase/supabase-js';

const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY! });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const INTAKE_PROMPT = `You are the intake assistant for ProcureCall, a buyer-side procurement service. You conduct a short, professional interview to capture a complete equipment request for: {{vertical_label}}.

You are an AI assistant and you say so openly if asked. You speak US English, plainly and efficiently, like a competent dispatcher. No sales language.

Your goal: cover the following interview points, one or two questions at a time, in natural order, adapting to what the caller already told you:
{{interview_outline}}

Rules:
- Ask only for information you do not have yet. Never re-ask.
- Confirm numbers and dates by repeating them back once.
- If the caller does not know something, accept that and move on — the review
  screen lets them complete it later.
- Budget: ask ONCE if they want to state one. Make clear it stays private and
  is only used if they explicitly authorize it on the review screen.
- Do not promise prices, availability, or outcomes. You only collect the brief.
- When the main points are covered, summarize the request in two or three
  sentences, tell the caller they can review and confirm everything on screen,
  say goodbye, and end the call.
- Keep the whole interview under two and a half minutes.`;

const FIRST_MESSAGE =
  'Hi, this is the ProcureCall intake assistant — I am an AI. I will take your equipment request in about two minutes. What do you need, and where?';

async function upsertSetting(key: string, value: string) {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(`app_settings upsert failed: ${error.message}`);
}

async function getSetting(key: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw new Error(`app_settings read failed: ${error.message}`);
  return data?.value ?? null;
}

async function main() {
  const conversationConfig = {
    agent: {
      firstMessage: FIRST_MESSAGE,
      language: 'en',
      prompt: {
        prompt: INTAKE_PROMPT,
      },
      dynamicVariables: {
        dynamicVariablePlaceholders: {
          vertical_label: 'Equipment rental — Stuttgart region',
          interview_outline: 'Ask what equipment is needed.',
        },
      },
    },
    conversation: {
      maxDurationSeconds: 180,
    },
    turn: {
      turnTimeout: 7,
      silenceEndCallTimeout: 20,
    },
  };

  const platformSettings = {
    auth: { enableAuth: true },
  };

  const existingId = await getSetting('intake_agent_id');
  if (existingId) {
    try {
      await elevenlabs.conversationalAi.agents.update(existingId, {
        conversationConfig,
        platformSettings,
      });
      console.log(`intake agent updated: ${existingId}`);
      return;
    } catch (e) {
      console.log(`update failed (${e instanceof Error ? e.message : 'error'}); creating new`);
    }
  }

  const agent = await elevenlabs.conversationalAi.agents.create({
    name: 'ProcureCall Intake',
    tags: ['procurecall', 'intake'],
    conversationConfig,
    platformSettings,
  });
  await upsertSetting('intake_agent_id', agent.agentId);
  console.log(`intake agent created: ${agent.agentId}`);
}

void main();
