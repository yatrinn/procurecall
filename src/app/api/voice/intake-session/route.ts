import { NextResponse } from 'next/server';
import { getAppSetting, getSignedUrlForAgent } from '@/integrations/elevenlabs-server';
import { assertVoiceBudget } from '@/core/voice-budget';
import { getVertical, DEFAULT_VERTICAL_SLUG } from '@/config/verticals';

/**
 * Mints a signed URL for a voice intake session. Enforces the voice budget
 * before any session starts and hands the client the per-vertical dynamic
 * variables for the interview.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { vertical?: string };
    const vertical = getVertical(body.vertical ?? DEFAULT_VERTICAL_SLUG);

    await assertVoiceBudget();

    const agentId = await getAppSetting('intake_agent_id');
    if (!agentId) {
      return NextResponse.json(
        { error: 'Voice intake is not configured yet. Use document upload or typed intake.' },
        { status: 503 },
      );
    }
    const signedUrl = await getSignedUrlForAgent(agentId);
    return NextResponse.json({
      signed_url: signedUrl,
      dynamic_variables: {
        vertical_label: vertical.label,
        interview_outline: vertical.interviewOutline.map((q, i) => `${i + 1}. ${q}`).join('\n'),
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not start a voice session';
    return NextResponse.json({ error: message }, { status: 429 });
  }
}
