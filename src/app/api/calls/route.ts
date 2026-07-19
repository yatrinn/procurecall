import { NextResponse } from 'next/server';
import { z } from 'zod';
import { startCall, runTextCall } from '@/negotiation/orchestrator';
import { supabaseAdmin } from '@/integrations/supabase-server';

export const maxDuration = 300;

const BodySchema = z.object({
  spec_id: z.string().uuid(),
  supplier_id: z.string().uuid(),
});

/** Global credit protection: at most this many calls started per hour. */
const HOURLY_CALL_CAP = 40;

/**
 * Starts ONE text-tier call and runs it to completion. The live board fires
 * one request per supplier in parallel and polls board state separately.
 */
export async function POST(request: Request) {
  try {
    const body = BodySchema.parse(await request.json());

    const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const { count } = await supabaseAdmin()
      .from('call_sessions')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', hourAgo);
    if ((count ?? 0) >= HOURLY_CALL_CAP) {
      return NextResponse.json(
        { error: 'Hourly call capacity reached. Try again later. The recorded replay on /demo always works.' },
        { status: 429 },
      );
    }

    const { callId } = await startCall({ specId: body.spec_id, supplierId: body.supplier_id });
    await runTextCall(callId);
    return NextResponse.json({ call_id: callId, done: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Call failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
