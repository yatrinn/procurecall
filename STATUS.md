# STATUS.md — ProcureCall

> Last updated: 2026-07-18 · after environment inspection and planning docs

## What works

- Environment verified: Node 24.10.0, pnpm 10.33.2, git, gh (yatrinn, repo+workflow),
  supabase CLI 2.109.1 via npx (authenticated, project ref matches `.env.local`),
  vercel CLI 56.3.2 via npx (authenticated as yatrinn).
- `.env.local` present. All required keys set. `TWILIO_PHONE_NUMBER` empty — real phone
  mode is intentionally out of scope and hidden in the UI.
- Service access verified without printing values: Supabase REST (publishable + secret
  key), ElevenLabs (tier creator, active), OpenAI, Tavily. Note: the service role key
  in `.env.local` was initially wrong (contained the project ref); replaced with the
  real `sb_secret_...` key via the Supabase CLI. See docs/INTEGRATION_NOTES.md.
- GitHub repo `yatrinn/procurecall` exists, public, empty — ready for first push.
- Planning docs written: PLAN, ARCHITECTURE, DATA_MODEL, DESIGN_SYSTEM, TASKS.

## What does not work yet

- Everything else. No code scaffolded, no schema, no deploy.

## Deployment

- Production URL: none yet.

## Voice budget

- 250 ElevenLabs agent minutes total. Used so far: 0 (no voice calls made).
- Policy: text tier for all iteration; voice only for loop verification (<90s),
  golden-run recording, final demo. Hard duration caps + silence auto-hangup in code.

## Blocked

- Nothing blocked. (Twilio real-phone mode skipped by design, not blocked.)
