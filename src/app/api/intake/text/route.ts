import { NextResponse } from 'next/server';
import { z } from 'zod';
import { extractFromText } from '@/core/intake';
import { createDraftSpec } from '@/core/specs-repo';
import { DEFAULT_VERTICAL_SLUG, getVertical } from '@/config/verticals';

export const maxDuration = 60;

const BodySchema = z.object({
  text: z.string().trim().min(10, 'Describe the job in at least a sentence.').max(20_000),
  vertical: z.string().default(DEFAULT_VERTICAL_SLUG),
  source: z.enum(['voice', 'manual']).default('manual'),
});

export async function POST(request: Request) {
  try {
    const body = BodySchema.parse(await request.json());
    const vertical = getVertical(body.vertical);
    const extraction = await extractFromText(vertical, body.text);
    const spec = await createDraftSpec({
      verticalSlug: vertical.slug,
      fields: extraction.fields,
      intakeSource: body.source,
    });
    return NextResponse.json({
      spec_id: spec.id,
      extraction_notes: extraction.extraction_notes,
      injection_notes: extraction.injection_notes,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Text intake failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
