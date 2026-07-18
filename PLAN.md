# PLAN.md — ProcureCall build plan

Product: **ProcureCall** — buyer-side AI procurement agent.
Challenge: Hack-Nation 6th Global AI Hackathon, Challenge 01 — The Negotiator (ElevenLabs).
Promise: *One brief. Every supplier. The best verified deal.*

This plan operationalizes `AGENTS.md`. Frozen decisions live there; this file adds
environment facts, budget policy, and the concrete order of work.

## Environment (verified 2026-07-18)

- Node 24.10.0, pnpm 10.33.2, git 2.46.1, macOS arm64
- `gh` 2.67.0 authenticated as `yatrinn` (repo, workflow scopes)
- `supabase` CLI 2.109.1 via `npx supabase ...` — authenticated; project `Hack_Nation_6`
  (ref matches `SUPABASE_PROJECT_REF` in `.env.local`, region eu-west-1, Postgres 17)
- `vercel` CLI 56.3.2 via `npx vercel ...` — authenticated as `yatrinn`
- GitHub repo `yatrinn/procurecall` exists, public, empty — add as origin, push to `main`
- `.env.local` present: Supabase (new `sb_publishable_` / `sb_secret_` key format),
  ElevenLabs, OpenAI, Tavily set. Twilio phone number absent.
- **Real phone mode is out of scope for this build.** Twilio is not configured; the
  `real_phone` transport is skipped entirely and hidden in the UI.

## Voice budget policy (hard rules)

ElevenLabs agent minutes are the scarcest resource: **250 minutes total**, and
agent-to-agent conversations bill BOTH agents (a 5-minute negotiation costs 10 minutes).

1. All iteration happens on the **text tier** (same tools, same policies, no audio).
2. Voice is used only to (a) verify the loop works, (b) record the golden run for
   verified replay, (c) the final demo.
3. Voice test conversations stay **under 90 seconds**.
4. Code enforces a **maximum call duration** and **auto-hangup on silence** for every
   voice session. No unbounded calls exist anywhere.
5. The supplier side never runs as a second ElevenLabs agent when a cheaper honest path
   exists: supplier policies run as dynamic stateful text models; their replies are
   synthesized to audio only when a voice demo requires it.

## Tiers (scope discipline)

**Tier 1 is the entire job until it is verified live on the public URL.**

- Tier 1: intake (voice + document) → identical validated JobSpec → confirm + fingerprint
  → three dynamic supplier agents → structured outcomes → hidden fees exposed →
  truth-layer-gated leverage → one measurable in-call improvement → deterministic price
  engine + ranking → evidence ledger → public `/demo` (no login, seeded, resettable) →
  verified replay.
- Tier 2: adversarial suite (50+ real attacks, real pass/fail), text-tier evaluation on
  held-out profiles, second vertical (US moving) as configuration, clean repo + CI.
- Tier 3: only after Tier 1 and Tier 2 are verified in production.

Never build: payments, mobile, ERP, CRM, enterprise permissions, seller-side products,
post-delivery tracking, third-party analytics.

## Gates (dependency order)

1. **Closed loop** — public URL, one confirmed spec, one live conversation, one
   structured quote, one result page.
2. **Challenge compliance** — three dynamic styles, itemized comparable quotes, one
   verified negotiated improvement, structured outcomes, transcript evidence.
3. **Demo resilience** — verified replay, reset, no-login demo, graceful failure states.
4. **Submission-ready** — `/submission` complete, production URL works in incognito.
   *Submit here; keep improving afterward.*
5. **Structural truth** — tool-gated leverage, unsupported-claim validator, adversarial results.
6. **Technical depth** — evidence ledger, price engine, evaluation lab, held-out profiles.
7. **Platform proof** — live configuration swap to the moving vertical.

After each gate: lint, typecheck, unit tests, Playwright, production build, deploy,
update `STATUS.md`, commit, push.

## Execution sequence (from AGENTS.md §14)

1. ✅ Inspect folder and environment.
2. Planning docs (this file + ARCHITECTURE, DATA_MODEL, DESIGN_SYSTEM, TASKS, STATUS).
3. Git init, push to `yatrinn/procurecall`, MIT LICENSE.
4. Scaffold Next.js (TypeScript strict, Tailwind, Zod, Vitest, Playwright, ESLint, Prettier).
5. `.env.example` + `pnpm setup:check` (presence only, never values).
6. Link Supabase; migrations + RLS; seed.
7. Design system + app shell; screenshot critique against AGENTS.md §4 before continuing.
8. JobSpec schema, both intake paths, confirmation, fingerprint.
9. Supplier policies; one live voice path; **close the single-supplier loop and deploy**.
10. Three supplier behaviors, quote extraction, structured outcomes.
11. Deterministic price engine.
12. Truth layer + post-call validator.
13. Negotiation events, evidence ledger, audio scrubbing.
14. Deterministic recommendation.
15. Verified replay + public demo.
16. **Gate 4: submission package.**
17. Adversarial suite + text-tier evaluation; record real numbers.
18. Second vertical configuration + live swap.
19. Full test pass; deploy; verify incognito.
20. Zip from final commit; update `STATUS.md`.

## Operating rules

- Commit and push after every working increment.
- Read current official docs before coding each integration; record findings in
  `docs/INTEGRATION_NOTES.md`.
- Missing credential or irreversible action → write the exact human command to
  `BLOCKED.md`, continue with independent work.
- `STATUS.md` states exactly what works and what does not, at all times.
- Never fabricate metrics, market figures, savings, or supplier names. Label every data
  source: public, simulated, live negotiation, or replay.
