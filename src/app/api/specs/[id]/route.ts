import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSpec, updateSpec } from '@/core/specs-repo';
import { AuthorizedLeversSchema } from '@/core/jobspec';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const spec = await getSpec(id);
  if (!spec) return NextResponse.json({ error: 'Spec not found' }, { status: 404 });
  return NextResponse.json(spec);
}

const PatchSchema = z.object({
  fields: z.record(z.string(), z.unknown()).optional(),
  authorized_levers: AuthorizedLeversSchema.optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const patch = PatchSchema.parse(await request.json());
    const updated = await updateSpec(id, patch);
    return NextResponse.json(updated);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Update failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
