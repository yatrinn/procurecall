import { NextResponse } from 'next/server';
import { extractFromDocument } from '@/core/intake';
import { createDraftSpec } from '@/core/specs-repo';
import { DEFAULT_VERTICAL_SLUG, getVertical } from '@/config/verticals';

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    const verticalSlug = (form.get('vertical') as string) || DEFAULT_VERTICAL_SLUG;
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Attach a file field named "file".' }, { status: 400 });
    }
    const vertical = getVertical(verticalSlug);
    const bytes = Buffer.from(await file.arrayBuffer());
    const extraction = await extractFromDocument(vertical, {
      name: file.name,
      mime: file.type,
      bytes,
    });
    const spec = await createDraftSpec({
      verticalSlug: vertical.slug,
      fields: extraction.fields,
      intakeSource: 'document',
    });
    return NextResponse.json({
      spec_id: spec.id,
      extraction_notes: extraction.extraction_notes,
      injection_notes: extraction.injection_notes,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Document intake failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
