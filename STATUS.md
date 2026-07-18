# STATUS.md — ProcureCall

> Last updated: 2026-07-19 · Gate 1 (closed loop) verified in production

## Gate 1 — CLOSED LOOP: DONE, verified live

- Production URL: https://procurecall.vercel.app
- Verified end to end in production: text intake → validated draft JobSpec →
  confirmation froze spec `5f60310c0bfb` → one dynamic text-tier negotiation against a
  simulated supplier (12 turns, AI disclosure, itemized fee extraction, read-back
  confirmation) → structured outcome `quote`, status `confirmed`, 89500 cents net →
  visible on the board and decision pages.

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

- Next.js 16 scaffold builds clean (strict TS, Tailwind 4, Vitest, Playwright configured).
- Supabase: schema migrated (14 tables), RLS deny-all verified empirically (publishable
  key gets `[]` / 42501), seed idempotent: 1 vertical + 3 simulated suppliers with
  private policies (transparent premium, low headline, hard dispatcher).
- Design system + shell: tokens, Archivo Expanded / Instrument Sans / JetBrains Mono.
  Screenshot critique vs AGENTS.md §4 done: no banned look present — cool ground (not
  cream), no serif display, no terracotta, no dark+acid scheme, no broadsheet density,
  numbers in mono. Watch item: keep rules/borders minimal, keep hi-vis scarce.

- Intake: text and document paths produce identical validated JobSpec drafts
  (document upload → OpenAI file input, fenced against prompt injection). Voice
  intake UI + signed-URL flow + budget gate built (live voice session not yet
  exercised — reserved for the voice verification pass).
- Confirmation: freezes spec, computes canonical form + SHA-256 fingerprint; edits
  after confirmation create version 2 with parent link (verified). Calls are blocked
  server-side until confirmed (verified).
- Negotiation core: buyer brain (pinned gpt-5.5 snapshot) with tool-gated truth layer
  (`request_verified_leverage` picks and verifies the competing quote server-side),
  lever tools absent unless authorized, dynamic supplier policy engine (pinned
  gpt-5.4-mini) with floor/ladder enforcement in code.
- Full call loop in production: quote lines logged with transcript refs, read-back
  confirmation, structured outcome, quote + lines persisted.
- Live board (polling) and functional decision room deployed.

## Gate 2 — challenge compliance: core demonstrated in production

- Three distinct supplier behaviors ran live (text tier) on one fingerprinted spec:
  A transparent premium (opened 895 net), B low headline (79 EUR/day headline became
  821.25 net once fees were extracted), C hard dispatcher (demanded details, range
  first, 820 net).
- **Verified negotiated improvement:** supplier A moved 895.00 → 805.00 EUR net
  (−10.1%) during the call after the buyer cited a truth-layer-verified competing
  quote (Neckar, 820 net, matching fingerprint). Recorded as `fee_waived`
  negotiation event (9000 → 0 cents pickup) with transcript refs. The concession came
  from the supplier's private ladder condition being met — not from a script.
- Buyer arithmetic checks work (caught a supplier's wrong day count and a wrong total
  in earlier runs; both corrected in-call).
- Every call ended in a structured outcome; every quote line carries a transcript ref.

## What does not work yet

- Price engine exists (`src/core/price-engine.ts`) but is not yet wired into quotes
  (no breakdown persisted, no red-flag display). Ranking is a plain sort, clearly
  labeled as not a recommendation.
- No voice-tier negotiation call yet; no recordings; no evidence-audio scrubbing.
- Post-call validator, evidence ledger UI, verified replay, public /demo, adversarial
  suite, eval lab, moving vertical: not built yet.
- Voice usage: 0 minutes consumed so far.

## Deployment

- Production URL: none yet.

## Voice budget

- 250 ElevenLabs agent minutes total. Used so far: 0 (no voice calls made).
- Policy: text tier for all iteration; voice only for loop verification (<90s),
  golden-run recording, final demo. Hard duration caps + silence auto-hangup in code.

## Blocked

- Nothing blocked. (Twilio real-phone mode skipped by design, not blocked.)
