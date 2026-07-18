/**
 * One-shot service access probe. Prints ONLY status codes, never values.
 * Not part of the app. Run: pnpm tsx scripts/probe-services.ts
 */
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

async function probe(label: string, fn: () => Promise<{ ok: boolean; detail: string }>) {
  try {
    const { ok, detail } = await fn();
    console.log(`  ${ok ? 'ok     ' : 'FAILED '}  ${label} — ${detail}`);
    return ok;
  } catch (e) {
    console.log(`  FAILED   ${label} — ${e instanceof Error ? e.message : 'error'}`);
    return false;
  }
}

async function main() {
  const results: boolean[] = [];

  // New sb_publishable_/sb_secret_ keys: send ONLY the apikey header (a Bearer copy
  // of the key is rejected — documented limitation). Root spec endpoint requires a
  // secret key, so the publishable key is probed against a table path instead; a
  // PostgREST "table not found" error still proves the key authenticated.
  results.push(
    await probe('Supabase REST (publishable key)', async () => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/setup_probe?select=*`,
        { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! } },
      );
      const authenticated = res.status !== 401 && res.status !== 403;
      return { ok: authenticated, detail: `HTTP ${res.status} (authenticated)` };
    }),
  );

  results.push(
    await probe('Supabase REST (secret key)', async () => {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`, {
        headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY! },
      });
      return { ok: res.ok, detail: `HTTP ${res.status}` };
    }),
  );

  results.push(
    await probe('ElevenLabs API', async () => {
      const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY! },
      });
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      const body = (await res.json()) as { tier?: string; status?: string };
      return {
        ok: true,
        detail: `HTTP 200, tier=${body.tier ?? '?'}, status=${body.status ?? '?'}`,
      };
    }),
  );

  results.push(
    await probe('OpenAI API', async () => {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY!}` },
      });
      return { ok: res.ok, detail: `HTTP ${res.status}` };
    }),
  );

  results.push(
    await probe('Tavily API', async () => {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.TAVILY_API_KEY!}`,
        },
        body: JSON.stringify({ query: 'test', max_results: 1 }),
      });
      return { ok: res.ok, detail: `HTTP ${res.status}` };
    }),
  );

  console.log(results.every(Boolean) ? '\nAll services reachable.' : '\nSome services failed.');
  process.exit(results.every(Boolean) ? 0 : 1);
}

void main();
