# TASKS.md — ProcureCall

Execution complete: all 20 steps of AGENTS.md §14 done; gates 1–7 reached.
See STATUS.md for verified detail and the founder's remaining manual items.

## Setup
- [x] 1. Environment verified (Node 24, pnpm 10, gh/supabase/vercel authenticated)
- [x] 2. Planning docs: PLAN, ARCHITECTURE, DATA_MODEL, DESIGN_SYSTEM, TASKS, STATUS
- [x] 3. Git init · origin `yatrinn/procurecall` · push `main` · MIT LICENSE
- [x] 4. Scaffold Next.js: TS strict, Tailwind, Zod, Vitest, Playwright, ESLint, Prettier
- [x] 5. `.env.example` + `pnpm setup:check` (presence only) · service access verified
- [x] 6. Supabase link · migrations + RLS deny-all (verified) · idempotent seed
- [x] 7. Design system + app shell · screenshot critique vs DESIGN_SYSTEM.md passed

## Tier 1
- [x] 8a. JobSpec Zod schema + canonicalization + fingerprint (unit-tested)
- [x] 8b. Document intake (PDF/image, untrusted-input fencing, injection-tested)
- [x] 8c. Voice intake: ElevenLabs agent interview (live-verified) → same JobSpec
- [x] 8d. Confirm screen: edit, levers, freeze + fingerprint; versioning; call gate
- [x] 9. Supplier policy engine · text-tier loop · **closed loop deployed (Gate 1)**
- [x] 10. Three supplier behaviors · quote extraction · structured outcomes
- [x] 11. Price engine (engine-authoritative, unit-tested, red flag, deposits separated)
- [x] 12. Truth layer (six conditions, typed errors, adversarially tested) · lever
       tool-surface gating · post-call validator
- [x] 13. Call Tape · negotiation events · evidence anchors · audio scrubbing
- [x] 14. Deterministic ranking + reason codes · decision room with evidence rail ·
       **verified in-call improvement 895 → 805 EUR (Gate 2)**
- [x] 15. Verified replay (labeled) · public /demo with reset + rate limits (Gate 3)

## Gate 4
- [x] 16. /submission complete (summary, 3 video scripts ≤60 s, shot list, dataset
       manifest, checklist, architecture.svg) · README per spec · CI green ·
       production verified in fresh browser contexts

## Tier 2
- [x] 17. Adversarial suite: 55 scenarios, REAL results (55/55 latest, attempt history
       kept) · held-out eval: 8 profiles, real metrics, /lab shows both
- [x] 18. moving-us vertical as pure configuration · live swap on /request ·
       end-to-end call verified in USD
- [x] 19. Full test pass (lint, typecheck, 36 unit, 6 e2e local + vs production,
       build) · deploy · fresh-context verification
- [x] 20. Zip from final commit (`procurecall-submission.zip`) · STATUS.md final

## Remaining — founder, by hand
- [ ] Record demo/tech/team videos (scripts in /submission, ≤60 s each)
- [ ] One golden VOICE negotiation run for the demo video (~4 min budget)
- [ ] Submit: URL, repo, zip, videos, dataset
