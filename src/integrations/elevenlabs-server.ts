import 'server-only';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { supabaseAdmin } from '@/integrations/supabase-server';

let cached: ElevenLabsClient | null = null;

export function elevenlabs(): ElevenLabsClient {
  if (cached) return cached;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY missing');
  cached = new ElevenLabsClient({ apiKey });
  return cached;
}

export async function getAppSetting(key: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw new Error(`app_settings read failed: ${error.message}`);
  return data?.value ?? null;
}

/** Signed URL for a private agent session. The API key never reaches the browser. */
export async function getSignedUrlForAgent(agentId: string): Promise<string> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
    { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY! } },
  );
  if (!res.ok) throw new Error(`get-signed-url failed: HTTP ${res.status}`);
  const body = (await res.json()) as { signed_url: string };
  return body.signed_url;
}

/** Authoritative call duration, if the conversation is already analyzed. */
export async function getConversationDurationSeconds(
  conversationId: string,
): Promise<number | null> {
  try {
    const conv = await elevenlabs().conversationalAi.conversations.get(conversationId);
    const meta = conv as unknown as { metadata?: { callDurationSecs?: number } };
    return meta.metadata?.callDurationSecs ?? null;
  } catch {
    return null;
  }
}
