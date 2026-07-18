import { NextResponse } from 'next/server';
import { runPostCallValidator } from '@/core/validator';

export const maxDuration = 60;

/** Re-run the unsupported-claim validator for one call (idempotent). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const findings = await runPostCallValidator(id);
    return NextResponse.json({ findings });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Validation failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
