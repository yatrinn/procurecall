# AGENTS.md — ProcureCall Autonomous Build Specification

> Place this file at the repository root. Point the Cursor agent at it with:
> *"Read AGENTS.md. Execute it end to end autonomously. Do not ask for approval on reversible decisions. Stop only if an external credential is missing, and if so write BLOCKED.md and continue with everything independent."*

---

## 0. Frozen decisions

Do not revisit these.

| | |
|---|---|
| Product | **ProcureCall** |
| Challenge | Hack-Nation 6th Global AI Hackathon, Challenge 01 — The Negotiator (ElevenLabs) |
| Type | Buyer-side AI procurement agent |
| Primary vertical | Construction equipment rental, Stuttgart region |
| Demo request | One 12-meter electric scissor lift, five business days, delivered before 07:00 Monday |
| Second vertical | US residential moving — configuration proof only |
| Promise | *One brief. Every supplier. The best verified deal.* |
| Language | **US English everywhere.** Code, comments, UI copy, docs, filenames, commit messages, data labels. No German in the product. |
| Hosting | Next.js on Vercel |
| Data | Supabase (Postgres, Storage, Realtime) |
| Voice | ElevenLabs Agents |
| Reasoning | OpenAI API, pinned model version, strict structured outputs |
| Research | Tavily |
| Optional | Twilio (real phone mode only) |
| Excluded | Lovable, Tower.dev, crypto, Lightning, Stripe, Google Places, ERP integrations, any seller-side product |

**License:** the hackathon operates under an MIT open license per the organizers. Ship `LICENSE` = MIT in this repository. Continuation of the venture happens in a separate private repository after submission — do not add "all rights reserved" to this one.

---

## 1. Scope discipline — read before writing any code

Two thousand people are competing. Judges will not remember the project with the most features. They remember one clear story and one irrefutable moment.

**Breadth is a liability here.** More surface means more ways to break on stage, a muddier narrative, and the impression of an inflated hackathon demo. Build in three tiers and do not start a tier until the one above is verified working in production.

### Tier 1 — must be flawless

Nothing else matters until every one of these works end to end on the public URL.

1. Voice intake (ElevenLabs Agent) and document intake (PDF or image) both produce the identical validated `JobSpec`.
2. User reviews, edits, authorizes negotiation levers, and confirms. Confirmation freezes the spec and computes a fingerprint.
3. Three dynamic supplier agents with distinct commercial behavior. No scripts.
4. Every call ends in a structured outcome: itemized quote, callback commitment, or documented decline.
5. Hidden and missing fees are exposed. The cheap headline price visibly becomes the expensive real total.
6. **Truth layer:** the buyer agent can only cite a competing figure returned by a server-side tool from a confirmed quote with a matching fingerprint.
7. At least one price or term measurably improves during a live call because of verified leverage.
8. Deterministic price engine separating guaranteed net cost, conditional cost, refundable deposit, tax, and cash required.
9. Deterministic ranking. The model explains; it never chooses.
10. Evidence ledger: clicking any number opens the exact transcript turn and seeks the audio to that second.
11. Public `/demo` with no login, seeded, resettable, robust error states.
12. Verified replay of a genuinely dynamic prior run, clearly labeled as a replay.

### Tier 2 — technical depth

13. Adversarial suite, at least 50 real attacks, real pass/fail displayed.
14. Text-tier evaluation against held-out supplier profiles.
15. Second vertical operational, swapped live from configuration.
16. Clean repository, architecture docs, CI green.

### Tier 3 — only if Tier 1 and Tier 2 are verified in production

Additional verticals, supplier market explorer, magic-link auth, request templates, procurement history, Quote Pack PDF export.

### Never build

Payments, mobile app, ERP integration, enterprise permissions, CRM, supplier-side answering product, post-delivery tracking, third-party analytics or error services.

---

## 2. Credentials

Read from `.env.local`. Never print values. `pnpm setup:check` reports only presence or absence.

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_PROJECT_REF=
SUPABASE_DB_PASSWORD=

# ElevenLabs
ELEVENLABS_API_KEY=

# OpenAI
OPENAI_API_KEY=

# Tavily
TAVILY_API_KEY=

# Optional — real phone mode
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
```

`gh`, `supabase`, and `vercel` CLIs are authenticated on the machine. Use them directly. If a CLI is unauthenticated, write the exact one-line command the human must run into `BLOCKED.md` and continue with everything else.

Never commit `.env*`. Never expose the service role key or any provider key to the browser.

---

## 3. The product

### Story

A site manager needs a 12-meter scissor lift on Monday at 07:00. To find a fair price he would call six rental yards, describe the same job six times, and compare quotes that are deliberately not comparable — one gives a day rate without delivery, another a weekly price including liability reduction, a third refuses to name the deposit. He calls two, takes the first workable offer, and overpays.

These prices are not hidden. They are simply never written down. They exist only while someone is speaking them.

### Challenge compliance checklist

Every item must be demonstrably true in the shipped product:

- Voice intake built on ElevenLabs Agents ✓
- At least one document intake type ✓
- Both paths produce the same structured job spec, confirmed by the user, reused verbatim across every call ✓
- Live calls against at least three distinct negotiation styles ✓
- Every quote captured in structured, comparable form with fees itemized ✓
- At least one negotiation where price or terms measurably change because of leverage the agent gathered, not because a script said so ✓
- AI disclosure; graceful handling of interruptions, refusals, and "are you a robot?" ✓
- Never invents inventory, a competing bid, availability, budget, deadline, customer flexibility, or purchasing authority ✓
- Every call ends in a structured outcome ✓
- Final report ranks all quotes, cites recordings and transcripts, explains the recommendation in plain language ✓
- Vertical parameters are configuration, not code ✓

---

## 4. Design system

The client has explicitly rejected anything that looks AI-generated. Treat that as a hard requirement.

### What to avoid, and why

Current AI-generated design clusters around three looks. All three are disqualifying here:

1. **Warm cream ground (~#F4F1EA) + high-contrast serif display + terracotta accent (~#D97757).** This is the single most recognizable tell.
2. **Near-black ground + one bright acid-green or vermilion accent.**
3. **Broadsheet layout: hairline rules, zero radius, dense newspaper columns.**

Also banned: purple or violet as a brand color, glassmorphism, neon gradients, floating blobs, oversized pill buttons, robot imagery, chat-bubble-dominant layouts, generic dashboard card grids.

### Grounding

The subject's world is dispatch offices, machine spec plates, hi-vis site clothing, delivery notes, and time-stamped call logs. The product's own artifact is **a recorded phone call with evidence pinned to it.** Every design decision comes from there.

### The signature — the Call Tape

**This is the one memorable element. Spend the boldness here and keep everything else quiet.**

Calls are not rendered as cards in a grid. Each supplier gets a horizontal **tape**: the audio waveform is the literal spine of the interface. Every extracted fee, disclosure, concession, and outcome is pinned to the tape at the second it was spoken.

- The comparison table's numbers are not standalone values. Each one owns a position on a tape.
- Clicking any figure anywhere in the app scrubs that supplier's audio to the exact second and highlights the transcript turn.
- In the decision view, a thin vertical **evidence rail** connects the recommended total down through its component fees to the tape moments that produced them.
- A verified leverage event renders as a link drawn between two tapes — the quote it came from and the call it was used in. That single visual is the Truth Layer, explained without words.

A viewer with the sound off must understand what is happening. This is what makes the 60-second video work.

### Tokens

```
--ground     #EDEFEA   cool paper. deliberately not cream
--ink        #14181A   primary text
--steel      #5A6570   secondary text, rules, inactive tape
--hivis      #C4D600   accent. site safety yellow-green. used sparingly
--verified   #0E5F55   deep petrol. ONLY on tool-verified evidence
--flag       #A8412F   muted brick. ONLY on red flags and failures
```

The accent is drawn from German construction safety clothing, not from a palette generator. `--verified` appearing on screen means one thing and only one thing: this number came from a verified tool call. Never use it decoratively — its scarcity is what gives it meaning.

### Type

- **Display: Archivo Expanded, 700.** Wide industrial grotesque, reads like signage and machine plates. Use for very few, very large statements only.
- **UI and body: Instrument Sans.**
- **All numbers, currency, timestamps, fingerprints, transcript references: JetBrains Mono.**

Setting every figure in mono is a systematic decision, not decoration: this product is about numbers you can trace back to a source. Monospaced numerals read as record, not as marketing.

Load via `next/font`. Restrained scale. Sentence case throughout.

### Geometry and motion

4px radius. Generous whitespace around dense data. Alignment carries the structure — do not reach for borders to create separation.

Motion only explains state change: a fee pin landing on the tape when extracted, a figure transitioning to `--verified` when a tool call confirms it, a negotiation delta counting from the old value to the new. Fast, small, purposeful. Respect `prefers-reduced-motion`. No ambient animation.

### Copy

Write from the user's side of the screen. Specific and operational, never salesy.

- Good: `Three suppliers have not quoted delivery yet.`
- Bad: `Our intelligent AI seamlessly analyzes supplier quotes.`

Banned words: revolutionize, unlock, seamless, cutting-edge, game-changing, leverage AI, intelligent solution, next-generation, powered by innovation. Errors state what happened and what to do. Empty states invite an action. Buttons name the thing that happens, and the confirmation uses the same word.

### The three screens that must be exceptional

Everything else can be plain. These carry the product:

1. **Confirm request** — the spec, editable, with the lever authorizations, resolving into a fingerprint.
2. **Live negotiation board** — three tapes running in parallel, fees pinning in real time.
3. **Decision room** — the ranked comparison with the evidence rail.

---

## 5. Data contracts

Validate every model output with Zod before persisting. Nothing unvalidated reaches the database.

**JobSpec** — vertical, equipment category, working height, power type, indoor/outdoor, ground conditions, site access, delivery address, delivery date and window, pickup date and window, duration, accessories, operator requirement, charging or fuel, insurance preference, deposit tolerance, budget (only if supplied), company, contact, `authorized_levers`, `confirmed_by_user`, `confirmed_at`, canonical serialization, `spec_fingerprint`.

Server logic blocks all calls until `confirmed_by_user` is true. Any edit after confirmation creates a new version with a new fingerprint.

**AuthorizedLevers** — `may_reveal_budget`, `may_adjust_delivery_window`, `may_extend_rental_period`, `may_accept_equivalent_equipment`, `may_offer_repeat_business`, `may_accept_pickup_instead_of_delivery`, `may_commit_immediately`, `maximum_commitment_net`.

The agent may never claim flexibility or authority it was not granted. This is enforced the same way as the truth layer: unauthorized levers are absent from the agent's tool surface, not merely discouraged in the prompt.

**Supplier** — identity, source (`tavily` | `simulated` | `manual`), classification flag `is_simulated`, location, contact, distance, supported categories, operating hours, reliability history.

**CallSession** — job_spec_id, supplier_id, transport mode, timestamps, conversation id, recording url, timestamped transcript, disclosure event, friction events, tool calls, structured outcome, failure state, `spec_fingerprint`.

**QuoteLine** — call_id, label, amount, unit, `is_mandatory`, `is_conditional`, `transcript_ref` (required — a line without evidence cannot be persisted).

**Quote / QuoteVersion** — supplier, fingerprint, technical match, availability status and evidence, all line items, cancellation terms, validity, `missing_information[]`, confidence, before/after negotiation totals, confirmed status.

**NegotiationEvent** — call_id, lever used, verified source quote id, tool-returned evidence, concession type, amount before, amount after, absolute delta, percent delta, transcript_ref, timestamp.

**Recommendation** — hard constraint results, normalized costs, risk assessment, evidence coverage, rank, deterministic reason codes, plain-language explanation.

---

## 6. Truth layer

The principal differentiator. Build it exactly as written.

```ts
// server-only
getVerifiedLeverage({ currentSpecFingerprint, quoteId })
```

Returns a value only when all of the following hold:

- quote status is `confirmed`
- quote total is not null
- quote fingerprint equals the current spec fingerprint
- at least one `transcript_ref` exists
- the quote has not expired
- currency and tax basis are compatible

On success it returns supplier name, quote id, call id, verified normalized total, currency, tax basis, evidence transcript turn, and verification timestamp. On failure it returns a typed error and the agent must negotiate without leverage.

**The buyer agent has no other path to a competing figure.** It is not in the system prompt, not in the conversation context, not in the knowledge base. The model cannot produce a number it was never given.

Add a **post-call validator** that scans every transcript for commercial claims unsupported by a tool call: prices, deadlines, budgets, availability, authority, customer flexibility. Surface violations in the evaluation lab.

The line for the technical video: *the agent cannot invent competing bids — not because the prompt asks it not to, but because the architecture never hands the model an unverified number.*

---

## 7. Price engine

Deterministic. No model involvement in arithmetic.

```
guaranteed_net_cost  = rental normalized to exact duration
                     + delivery + pickup
                     + mandatory liability reduction
                     + mandatory accessories
                     + unavoidable surcharges
                     − confirmed discounts

conditional_cost     = cleaning if triggered, fuel or charging if triggered,
                       late return, damage, overtime

refundable_deposit   = held, returned

tax                  = VAT on the net cost

cash_required        = guaranteed_net_cost + tax + refundable_deposit

best_case            = guaranteed_net_cost
expected_case        = guaranteed_net_cost + probable conditional items
worst_case           = guaranteed_net_cost + all conditional items
```

**A refundable deposit is tied-up capital, not a cost.** Counting it as cost produces a wrong ranking. Display it separately as cash impact.

**A conditional fee is not a guaranteed cost.** Display separately.

Normalize daily, weekly, monthly and minimum-duration tiers to the exact request. If a supplier refuses to price a category, mark it `unknown` — **an incomplete quote is not a cheap quote, and the interface must say so in those words.**

**Red flag:** normalized total below 70% of the benchmark median is flagged for review, never auto-preferred. Explain it plainly: in this market a price far below the field usually means something is missing.

---

## 8. Suppliers

Three polished agents for the demo. Each receives a **private commercial policy** — a price sheet, a floor, a concession order and step size, a disclosure policy, and a behavioral profile. **Never a script and never a predetermined final price.** The buyer agent never sees private state.

- **A — Transparent premium.** Complete quote, higher total, volunteers fees, can waive pickup or cleaning, little base-rate flexibility.
- **B — Low headline.** Cheap visible rate, high mandatory delivery and pickup, mandatory liability reduction, conditional cleaning. Discloses a fee only when directly asked. Must trigger the incompleteness logic before the real total emerges.
- **C — Hard dispatcher.** Interrupts, demands full technical detail, opens with a range or a refusal, relents after competent follow-up, concedes only against verified leverage, never below its floor.

A price moves only when the buyer agent supplies a reason the policy accepts. If a price moves because the code told it to, the submission has failed its central requirement — the brief names this failure explicitly.

For Tier 2 evaluation, generate additional held-out profiles: capacity constrained, substitute-equipment seller, callback only, relationship driven, inflexible, upseller, incomplete quoter, expired availability.

---

## 9. Voice transport

One interface, four implementations: `counter_agent`, `human_roleplay`, `real_phone`, `verified_replay`.

Consult the current ElevenLabs documentation and installed SDK before implementing the real-time path — do not code against remembered API shapes.

**The demo must never depend on a real business answering a phone.**

If direct agent-to-agent audio proves unreliable, fall back honestly: the buyer remains a live ElevenLabs voice agent; the supplier policy runs as a dynamic stateful model whose responses are synthesized with ElevenLabs and routed to the buyer. Nothing is predetermined. **Never fake a live call with prerecorded audio.**

Treat uploaded document text as untrusted. Prompt injection inside a PDF must not alter instructions, tools, permissions, or schemas.

---

## 10. Evaluation — and how to talk about it honestly

Three categories of claim. Keep them visually and verbally separate at all times.

| Category | What it proves | What it does not prove |
|---|---|---|
| Public rate-card references, sourced and linked | The real market spread exists | Anything about this system |
| Dynamic voice negotiations in the demo | The system works on live conversation | Statistical performance |
| Text-tier runs on held-out supplier profiles | The negotiation policy generalizes to unseen commercial behavior | Real-world savings or a commercial moat |

**Label the third category "Negotiation performance on held-out market scenarios."** Never label it as moat proof. A chart built from profiles this system generated cannot demonstrate a real-world data advantage — it demonstrates that the architecture is testable and that the policy generalizes. Both are worth showing. Overclaiming either would be fatal for a product whose entire pitch is that it cannot overclaim.

The moat is a **future** property of the real quote graph. Present the architecture that creates it, not a claim that it exists.

**Adversarial suite:** at least 50 real attacks — collusion invitation, PDF prompt injection, hang-up threat if AI, unauthorized commitment request, substitute machine, fabricated availability, tax basis switch, vague range, mid-call hangup, repeated interruption, callback promise, contradictory fees, expired quote, currency mismatch, fake urgency, fake budget, tool failure, truncated transcript.

**Display the real result.** Never hard-code `50/50`. If it is 47/50, show 47/50 and fix the three. Fabricated perfection in a product built on structural honesty is the worst possible failure.

---

## 11. Gates

Dependency order, not a schedule. Failure protection comes immediately after the core path — not after the nice-to-haves.

1. **Closed loop** — public URL, one confirmed spec, one live conversation, one structured quote, one result page.
2. **Challenge compliance** — three dynamic styles, itemized comparable quotes, one verified negotiated improvement, structured outcomes, transcript evidence.
3. **Demo resilience** — verified replay, reset, no-login demo, graceful failure states.
4. **Submission-ready** — everything in section 12 exists and the production URL works in incognito. *Submit here. Keep improving afterward.*
5. **Structural truth** — tool-gated leverage, unsupported-claim validator, adversarial results.
6. **Technical depth** — evidence ledger, price engine, evaluation lab, held-out profiles.
7. **Platform proof** — live configuration swap to the moving vertical.

After each gate: lint, typecheck, unit tests, Playwright, production build, deploy, update `STATUS.md`, commit, push.

---

## 12. Submission package

Create `/submission`:

`project-summary.md` (150–300 words), `demo-video-script.md`, `tech-video-script.md`, `team-video-script.md`, `video-shot-list.md`, `dataset-manifest.md`, `submission-checklist.md`, `architecture.svg`.

**All three videos are hard-capped at 60 seconds. Target 55.**

**Demo video** — screen only, founder narrating. One request → fingerprint on three calls → hidden fee exposed, real total rises → verified leverage tool call → price moves live → evidence-backed decision. Nothing else. The configuration swap goes in the tech video.

**Tech video** — screen only. Lead with the truth layer, not the stack. Truth layer → private supplier policies rather than scripts → evidence ledger → deterministic price engine → real adversarial results → configuration swap. Five seconds maximum on the stack.

**Team video** — founder on camera, full frame. The organizers asked specifically for: who you are, where you are joining from, what you are studying, and what you want to build beyond the hackathon. Cover all four. Lead with the operations and manufacturing background before the academic credentials — it is the reason this founder is credible on this problem. Claim nothing that cannot be personally defended.

**Dataset field:** not "N/A". Publish `/data` — supplier policy fixtures, the 50 adversarial scenarios with expected outcomes, evaluation results, and the sourced public rate-card references with URLs and retrieval timestamps.

**README order:** screenshot or GIF, one-sentence value proposition, live demo link, demo video, problem, product flow, truth layer, architecture, real evaluation results, local setup, environment variables, data sources, responsible use, known limitations.

---

## 13. Autonomous working behavior

Operate without check-ins. Do not stop after producing a plan. Do not pause between files.

When blocked by a missing external credential or an irreversible action: write the exact required human action to `BLOCKED.md`, complete every independent task, and resume immediately once available.

Read current official documentation for every service integration before coding against it. Pin dependency versions.

Never claim a feature is complete before it passes an acceptance test. Never create a button that does nothing. Never fabricate a metric, a market figure, a customer saving, or a supplier name. Always label which data is public, which is simulated, which is a live negotiation, and which is a replay.

`STATUS.md` must at all times state exactly what works and what does not.

---

## 14. Execution sequence

1. Inspect the folder and environment. Verify Node 20+, pnpm, and the `gh`, `supabase`, `vercel` CLIs.
2. Write `PLAN.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `DESIGN_SYSTEM.md`, `TASKS.md`, `STATUS.md`.
3. Initialize git. Create the public GitHub repository. Push. Add MIT `LICENSE`.
4. Scaffold Next.js with TypeScript strict, Tailwind, Zod, Vitest, Playwright, ESLint, Prettier.
5. Write `.env.example` and `setup:check`. Verify service access without printing secrets.
6. Link Supabase. Write migrations and row level security. Seed.
7. Build the design system and application shell. **Take a screenshot and critique it against section 4 before continuing.** If it resembles any of the three banned looks, revise and record what changed.
8. Implement `JobSpec`, both intake paths, confirmation, fingerprint.
9. Implement supplier policies. Implement one live voice path. **Close the single-supplier loop and deploy.**
10. Implement three supplier behaviors, quote extraction, structured outcomes.
11. Implement the price engine.
12. Implement the truth layer and the post-call validator.
13. Implement negotiation events, evidence ledger, audio scrubbing.
14. Implement deterministic recommendation.
15. Implement verified replay and the public demo.
16. **Gate 4 reached. Generate the submission package.**
17. Implement the adversarial suite and text-tier evaluation. Run them. Record real numbers.
18. Implement the second vertical configuration and the live swap.
19. Full test pass. Deploy. Verify in an incognito window.
20. Create the zip from the final commit. Update `STATUS.md`.

---

## 15. Acceptance criteria

**Product:** voice intake works · document intake works · identical schema from both · confirmation gates calls · fingerprint immutable and visible on every call · three dynamic styles · every call has a structured outcome · itemized quotes persist with transcript refs · hidden fees exposed · technical mismatch detected · availability verified · one price or term changes from verified leverage · unverified leverage is impossible · deposit excluded from cost · recommendation deterministic · evidence drawer seeks audio · public demo resets · verified replay labeled.

**Engineering:** no secret committed · row level security active · strict mode passes · lint passes · unit, integration and browser tests pass · production build passes · Vercel production deploy works in incognito.

**Submission:** summary 150–300 words · three videos each under 60 seconds · public repository · zip · dataset manifest · production URL · **every claim in every video and document matches functionality that actually exists.**

The finished product should feel like a procurement company already in private beta — not an AI hackathon dashboard.
