import { NextResponse } from 'next/server';
import { z } from 'zod';
import { recordVoiceUsage } from '@/core/voice-budget';
import { getConversationDurationSeconds } from '@/integrations/elevenlabs-server';

const BodySchema = z.object({
  conversation_id: z.string().min(1),
  approx_seconds: z.number().int().nonnegative().nullable(),
});

/** Records voice usage after an intake session ends (budget bookkeeping). */
export async function POST(request: Request) {
  try {
    const body = BodySchema.parse(await request.json());
    const authoritative = await getConversationDurationSeconds(body.conversation_id);
    await recordVoiceUsage({
      conversationId: body.conversation_id,
      kind: 'intake',
      seconds: authoritative ?? body.approx_seconds,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not record usage';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
