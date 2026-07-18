import { NextResponse } from 'next/server';
import { z } from 'zod';
import { startCall, runTextCall } from '@/negotiation/orchestrator';

export const maxDuration = 300;

const BodySchema = z.object({
  spec_id: z.string().uuid(),
  supplier_id: z.string().uuid(),
});

/**
 * Starts ONE text-tier call and runs it to completion. The live board fires
 * one request per supplier in parallel and polls board state separately.
 */
export async function POST(request: Request) {
  try {
    const body = BodySchema.parse(await request.json());
    const { callId } = await startCall({ specId: body.spec_id, supplierId: body.supplier_id });
    await runTextCall(callId);
    return NextResponse.json({ call_id: callId, done: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Call failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
