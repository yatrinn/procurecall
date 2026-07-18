import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/integrations/supabase-server';
import { getAppSetting } from '@/integrations/elevenlabs-server';
import { createDraftSpec, confirmSpec } from '@/core/specs-repo';
import { DEFAULT_VERTICAL_SLUG } from '@/config/verticals';

export const maxDuration = 60;

/**
 * Creates a fresh, confirmed copy of the golden demo request for a visitor
 * run — no model calls, fully deterministic. Rate-limited: 1 run per IP per
 * 10 minutes, 6 runs per hour globally.
 */
export async function POST(request: Request) {
  try {
    const supabase = supabaseAdmin();
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const ipHash = createHash('sha256').update(ip).digest('hex').slice(0, 24);

    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const [{ count: ipRecent }, { count: globalRecent }] = await Promise.all([
      supabase
        .from('demo_actions')
        .select('*', { count: 'exact', head: true })
        .eq('action', 'run')
        .eq('ip_hash', ipHash)
        .gte('created_at', tenMinAgo),
      supabase
        .from('demo_actions')
        .select('*', { count: 'exact', head: true })
        .eq('action', 'run')
        .gte('created_at', hourAgo),
    ]);
    if ((ipRecent ?? 0) >= 1) {
      return NextResponse.json(
        { error: 'You already started a live run in the last 10 minutes. Watch it finish, or come back shortly.' },
        { status: 429 },
      );
    }
    if ((globalRecent ?? 0) >= 6) {
      return NextResponse.json(
        { error: 'The live demo is at its hourly capacity. The verified replay above shows a complete recorded run.' },
        { status: 429 },
      );
    }

    const fieldsJson = await getAppSetting('demo_spec_fields');
    if (!fieldsJson) {
      return NextResponse.json({ error: 'The demo is not seeded yet.' }, { status: 503 });
    }

    const draft = await createDraftSpec({
      verticalSlug: DEFAULT_VERTICAL_SLUG,
      fields: JSON.parse(fieldsJson) as Record<string, unknown>,
      intakeSource: 'manual',
    });
    await supabase.from('job_specs').update({ is_demo_run: true }).eq('id', draft.id);
    const confirmed = await confirmSpec(draft.id);

    await supabase.from('demo_actions').insert({ action: 'run', ip_hash: ipHash });

    return NextResponse.json({ spec_id: confirmed.id });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Demo run failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
