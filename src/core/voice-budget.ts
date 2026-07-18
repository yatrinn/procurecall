import 'server-only';
import { supabaseAdmin } from '@/integrations/supabase-server';

/**
 * Voice budget enforcement. The ElevenLabs plan includes 250 agent minutes;
 * agent-to-agent setups would bill both sides, which is why the supplier
 * side never runs as an ElevenLabs agent. We hard-stop new voice sessions
 * at a safety ceiling so the golden run and final demo always have quota.
 */
const BUDGET_CEILING_SECONDS = Number(process.env.VOICE_BUDGET_CEILING_SECONDS ?? 200 * 60);

export async function getUsedVoiceSeconds(): Promise<number> {
  const { data, error } = await supabaseAdmin().from('voice_usage').select('seconds');
  if (error) throw new Error(`voice_usage read failed: ${error.message}`);
  return (data ?? []).reduce((sum, row) => sum + (row.seconds ?? 0), 0);
}

export async function assertVoiceBudget(): Promise<{ usedSeconds: number; ceiling: number }> {
  const usedSeconds = await getUsedVoiceSeconds();
  if (usedSeconds >= BUDGET_CEILING_SECONDS) {
    throw new Error(
      `Voice budget ceiling reached (${Math.round(usedSeconds / 60)} of ${Math.round(
        BUDGET_CEILING_SECONDS / 60,
      )} minutes used). Voice sessions are disabled to protect the demo quota.`,
    );
  }
  return { usedSeconds, ceiling: BUDGET_CEILING_SECONDS };
}

export async function recordVoiceUsage(input: {
  conversationId: string | null;
  kind: 'intake' | 'negotiation' | 'verification';
  seconds: number | null;
}): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('voice_usage')
    .upsert(
      {
        conversation_id: input.conversationId,
        kind: input.kind,
        seconds: input.seconds,
      },
      { onConflict: 'conversation_id' },
    );
  if (error) throw new Error(`voice_usage write failed: ${error.message}`);
}
