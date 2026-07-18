import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { confirmSpec } from '@/core/specs-repo';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const confirmed = await confirmSpec(id);
    return NextResponse.json(confirmed);
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        {
          error: 'Required fields are missing or invalid.',
          issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        { status: 422 },
      );
    }
    const message = e instanceof Error ? e.message : 'Confirmation failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
