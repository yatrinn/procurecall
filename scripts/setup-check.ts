/**
 * Reports presence or absence of required credentials and CLI access.
 * NEVER prints a credential value. Safe to run anywhere.
 */
import { config } from 'dotenv';
import { execSync } from 'node:child_process';

config({ path: '.env.local', quiet: true });

const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_DB_PASSWORD',
  'ELEVENLABS_API_KEY',
  'OPENAI_API_KEY',
  'TAVILY_API_KEY',
] as const;

const OPTIONAL = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'] as const;

let failures = 0;

console.log('Environment variables (.env.local):');
for (const key of REQUIRED) {
  const present = !!process.env[key]?.trim();
  if (!present) failures++;
  console.log(`  ${present ? 'ok     ' : 'MISSING'}  ${key}`);
}
for (const key of OPTIONAL) {
  const present = !!process.env[key]?.trim();
  console.log(`  ${present ? 'ok     ' : 'absent '}  ${key} (optional — real phone mode)`);
}

function cliVersion(label: string, cmd: string): void {
  try {
    const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 })
      .toString()
      .trim()
      .split('\n')
      .pop();
    console.log(`  ok       ${label} (${out})`);
  } catch {
    failures++;
    console.log(`  MISSING  ${label} — install or authenticate it`);
  }
}

console.log('CLI access:');
cliVersion('git', 'git --version');
cliVersion('gh', 'gh --version | head -1');
cliVersion('supabase (npx)', 'npx -y supabase --version');
cliVersion('vercel (npx)', 'npx -y vercel --version');

if (failures > 0) {
  console.log(`\n${failures} problem(s) found. See BLOCKED.md conventions in AGENTS.md.`);
  process.exit(1);
}
console.log('\nAll required credentials present. No values were printed.');
