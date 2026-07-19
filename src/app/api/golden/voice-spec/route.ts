import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/integrations/supabase-server';
import { getAppSetting } from '@/integrations/elevenlabs-server';
import { createDraftSpec, confirmSpec } from '@/core/specs-repo';
import { DEFAULT_VERTICAL_SLUG } from '@/config/verticals';

export const maxDuration = 60;

/**
 * Creates a fresh, confirmed copy of the golden brief for a VOICE run.
 * Unlike /api/demo/run this spec is NOT marked as a visitor demo run, so the
 * demo reset never deletes a recorded voice negotiation. Rate limited via the
 * same demo_actions ledger.
 */
export async function POST(request: Request) {
  try {
    const supabase = supabaseAdmin();
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const ipHash = createHash('sha256').update(ip).digest('hex').slice(0, 24);

    const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const { count } = await supabase
      .from('demo_actions')
      .select('*', { count: 'exact', head: true })
      .eq('action', 'run')
      .gte('created_at', hourAgo);
    if ((count ?? 0) >= 10) {
      return NextResponse.json(
        { error: 'Voice-run capacity for this hour is used up. Try again later.' },
        { status: 429 },
      );
    }

    const fieldsJson = await getAppSetting('demo_spec_fields');
    if (!fieldsJson) {
      return NextResponse.json({ error: 'The golden brief is not seeded yet.' }, { status: 503 });
    }

    const draft = await createDraftSpec({
      verticalSlug: DEFAULT_VERTICAL_SLUG,
      fields: JSON.parse(fieldsJson) as Record<string, unknown>,
      intakeSource: 'manual',
    });
    const confirmed = await confirmSpec(draft.id);
    await supabase.from('demo_actions').insert({ action: 'run', ip_hash: ipHash });

    return NextResponse.json({ spec_id: confirmed.id });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not prepare the voice run';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
