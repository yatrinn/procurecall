# TASKS.md — ProcureCall

Working checklist. Order = AGENTS.md §14. A task is done only when its acceptance test
passes. Gates from AGENTS.md §11 in bold.

## Setup
- [x] 1. Environment verified (Node 24, pnpm 10, gh/supabase/vercel authenticated)
- [x] 2. Planning docs: PLAN, ARCHITECTURE, DATA_MODEL, DESIGN_SYSTEM, TASKS, STATUS
- [ ] 3. Git init · origin `yatrinn/procurecall` · push `main` · MIT LICENSE
- [ ] 4. Scaffold Next.js: TS strict, Tailwind, Zod, Vitest, Playwright, ESLint, Prettier
- [ ] 5. `.env.example` + `pnpm setup:check` (presence only) · verify service access
- [ ] 6. Supabase link · migrations + RLS deny-all · seed script
- [ ] 7. Design system + app shell · screenshot critique vs DESIGN_SYSTEM.md · record result

## Tier 1 — the entire job until verified live
- [ ] 8a. JobSpec Zod schema + canonicalization + fingerprint (unit-tested)
- [ ] 8b. Document intake: PDF/image → same JobSpec (untrusted-input fencing)
- [ ] 8c. Voice intake: ElevenLabs agent interview → same JobSpec
- [ ] 8d. Confirm screen: edit, levers, confirm ⇒ freeze + fingerprint; calls blocked
        until confirmed; post-confirmation edit ⇒ new version
- [ ] 9a. docs/INTEGRATION_NOTES.md: ElevenLabs Agents (WS/WebRTC, tools, webhooks)
- [ ] 9b. Supplier policy engine (private policy, no scripts, no fixed final price)
- [ ] 9c. Text-tier negotiation loop (buyer policy ↔ supplier policy, full tool surface)
- [ ] 9d. Voice path: buyer ElevenLabs agent + synthesized supplier turns · call caps
        + silence auto-hangup · **closed loop deployed (Gate 1)**
- [ ] 10. Three supplier behaviors (A transparent premium, B low headline, C hard
        dispatcher) · quote extraction · structured outcome for every call
- [ ] 11. Price engine: guaranteed/conditional/deposit/tax/cash + best/expected/worst ·
        normalization to exact duration · `unknown` categories · 70% red flag ·
        unit tests
- [ ] 12. Truth layer `getVerifiedLeverage` (six conditions, typed errors) · levers as
        tool-surface gating · post-call validator · **(Gate 5 material)**
- [ ] 13. Negotiation events · evidence ledger · click any figure → audio seeks to the
        second, transcript turn highlights
- [ ] 14. Deterministic ranking + reason codes · model explains only ·
        **(Gate 2: one verified in-call improvement demonstrated)**
- [ ] 15. Verified replay (labeled) · public `/demo`: no login, seeded, reset,
        robust error states · **(Gate 3)**

## Gate 4 — submission
- [ ] 16. `/submission`: project-summary (150–300 words) · demo/tech/team video scripts
        (≤60s each) · shot list · dataset-manifest · checklist · architecture.svg ·
        README per spec · `/data` published · **production URL works in incognito**

## Tier 2
- [ ] 17. Adversarial suite ≥50 real attacks · run · display real pass/fail ·
        text-tier eval on held-out profiles ("Negotiation performance on held-out
        market scenarios")
- [ ] 18. Second vertical `moving-us` as pure configuration · live swap
- [ ] 19. Full test pass (lint, typecheck, unit, Playwright, build) · deploy · incognito
- [ ] 20. Zip from final commit · STATUS.md final

## Standing rules
- Commit + push after every working increment.
- Docs before code for every integration → docs/INTEGRATION_NOTES.md.
- Voice budget: text tier for iteration; voice ≤90s tests; hard caps in code.
- STATUS.md always current. BLOCKED.md for anything requiring the human.
