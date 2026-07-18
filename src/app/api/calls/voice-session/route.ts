import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/integrations/supabase-server';
import { getAppSetting, getSignedUrlForAgent } from '@/integrations/elevenlabs-server';
import { assertVoiceBudget } from '@/core/voice-budget';
import { getSpec } from '@/core/specs-repo';

export const maxDuration = 60;

const BodySchema = z.object({
  spec_id: z.string().uuid(),
  supplier_id: z.string().uuid(),
});

/**
 * Starts a VOICE negotiation session (human_roleplay transport): the buyer is
 * the live ElevenLabs voice agent driven by our custom-LLM brain; the person
 * on the microphone plays the supplier's dispatcher. Budget-gated.
 */
export async function POST(request: Request) {
  try {
    const body = BodySchema.parse(await request.json());
    await assertVoiceBudget();

    const spec = await getSpec(body.spec_id);
    if (!spec?.confirmed_by_user || !spec.spec_fingerprint) {
      return NextResponse.json(
        { error: 'This request is not confirmed. No calls before confirmation.' },
        { status: 409 },
      );
    }
    const agentId = await getAppSetting('buyer_voice_agent_id');
    if (!agentId) {
      return NextResponse.json({ error: 'Voice agent is not configured.' }, { status: 503 });
    }

    const supabase = supabaseAdmin();
    const { data: session, error } = await supabase
      .from('call_sessions')
      .insert({
        job_spec_id: spec.id,
        supplier_id: body.supplier_id,
        transport_mode: 'human_roleplay',
        tier: 'voice',
        status: 'pending',
        spec_fingerprint: spec.spec_fingerprint,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);

    const signedUrl = await getSignedUrlForAgent(agentId);
    return NextResponse.json({
      call_id: session.id,
      signed_url: signedUrl,
      dynamic_variables: { call_id: session.id },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Voice session failed';
    return NextResponse.json({ error: message }, { status: 429 });
  }
}
