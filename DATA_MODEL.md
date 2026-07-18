# DATA_MODEL.md — ProcureCall

Every model output is validated with Zod before persisting. Nothing unvalidated reaches
the database. All tables have RLS enabled with deny-all policies; access is exclusively
through server routes using the service-role key.

## Conventions

- IDs: `uuid` default `gen_random_uuid()`.
- Timestamps: `timestamptz`, `created_at` default `now()`.
- Money: integer **cents** + `currency` (ISO 4217). No floats in money paths.
- Enums as Postgres enums or checked text; mirrored in Zod.
- `transcript_ref`: `{ call_id, turn_index, start_ms, end_ms }` — points at the exact
  transcript turn and audio second.

## Tables

### verticals
Configuration snapshot per vertical (id, slug, label, `config jsonb`, `is_active`).
Source of truth is code (`src/config/verticals`); table stores the deployed snapshot so
the UI and evals reference a stable version.

### job_specs
- id, vertical_slug, `spec jsonb` (validated JobSpec), `spec_version int`
- JobSpec fields: equipment category, working height, power type, indoor/outdoor,
  ground conditions, site access, delivery address, delivery date + window, pickup date
  + window, duration, accessories, operator requirement, charging/fuel, insurance
  preference, deposit tolerance, budget (nullable — only if supplied), company, contact
- `authorized_levers jsonb` (see below)
- `confirmed_by_user boolean`, `confirmed_at timestamptz`
- `canonical text` (canonical serialization), `spec_fingerprint text` (SHA-256 hex)
- Any edit after confirmation ⇒ new row, `spec_version + 1`, new fingerprint
- **Server logic blocks all calls until `confirmed_by_user = true`.**

### AuthorizedLevers (jsonb shape)
`may_reveal_budget`, `may_adjust_delivery_window`, `may_extend_rental_period`,
`may_accept_equivalent_equipment`, `may_offer_repeat_business`,
`may_accept_pickup_instead_of_delivery`, `may_commit_immediately`,
`maximum_commitment_net` (cents, nullable).
Unauthorized levers are **absent from the agent's tool surface** for that session.

### suppliers
- id, name, source (`tavily` | `simulated` | `manual`), `is_simulated boolean`
- location, contact, distance_km, supported_categories text[], operating_hours,
  reliability_history jsonb
- Simulated demo suppliers are always labeled as simulated in the UI.

### supplier_policies (server-only, never exposed to buyer agent or client)
- id, supplier_id, behavioral profile, `price_sheet jsonb`, `floor jsonb`,
  `concession_ladder jsonb`, `disclosure_policy jsonb`
- Demo set: A transparent premium · B low headline / hidden fees · C hard dispatcher.
- Held-out eval set: capacity constrained, substitute seller, callback only,
  relationship driven, inflexible, upseller, incomplete quoter, expired availability.

### call_sessions
- id, job_spec_id, supplier_id, transport_mode (`counter_agent` | `human_roleplay` |
  `real_phone` | `verified_replay`), tier (`text` | `voice`)
- started_at, ended_at, conversation_id (ElevenLabs), recording_url (Supabase Storage)
- `transcript jsonb` (timestamped turns), `disclosure_event jsonb`,
  `friction_events jsonb[]`, `tool_calls jsonb[]`
- `outcome jsonb` — structured: `quote` | `callback_commitment` | `documented_decline`
- `failure_state text` (nullable), `spec_fingerprint text`
- **Every call ends in a structured outcome or an explicit failure state.**

### quotes / quote versions
- id, call_id, supplier_id, job_spec_id, `spec_fingerprint`
- technical_match jsonb, availability_status + availability_evidence (transcript_ref)
- cancellation_terms, validity_until, `missing_information text[]`, confidence
- totals: `total_before_negotiation_cents`, `total_after_negotiation_cents`
- status: `draft` | `confirmed` | `expired` | `declined`
- `is_benchmark_outlier boolean` (red flag: normalized total < 70% of benchmark median)
- Versioned: re-quote after negotiation creates a new version, prior kept.

### quote_lines
- id, quote_id, call_id, label, amount_cents, unit, `is_mandatory`, `is_conditional`
- `transcript_ref jsonb NOT NULL` — **a line without evidence cannot be persisted**
  (enforced by Zod and a DB constraint).

### negotiation_events
- id, call_id, lever_used, `verified_source_quote_id` (FK, required for leverage
  events), tool_returned_evidence jsonb, concession_type
- amount_before_cents, amount_after_cents, delta_abs_cents, delta_pct
- transcript_ref, created_at

### recommendations
- id, job_spec_id, computed_at
- `hard_constraint_results jsonb`, `normalized_costs jsonb`, `risk jsonb`,
  `evidence_coverage jsonb`, `ranking jsonb` (ordered, with deterministic reason codes)
- `explanation text` — model-written FROM reason codes; the model never chooses.

### validator_findings
- id, call_id, claim_text, claim_type (price | deadline | budget | availability |
  authority | flexibility), transcript_ref, `supported_by_tool_call boolean`,
  severity — post-call validator output, displayed in the lab.

### adversarial_scenarios / adversarial_results
- scenarios: id, slug, category, description, setup jsonb, `expected_outcome jsonb`
- results: id, scenario_id, run_at, passed boolean, details jsonb, call_id nullable
- **Real results only. Never hard-code totals.**

### eval_runs
- id, kind (`held_out_profiles`), config jsonb, results jsonb, run_at — labeled in UI as
  "Negotiation performance on held-out market scenarios".

### replays
- id, source_call_id, label, audio_url, `events jsonb` (full timeline), created_at —
  verified replay is a faithful re-render of a genuinely dynamic prior run.

## Price engine outputs (computed, stored on quotes)

```
guaranteed_net_cost = normalized rental + delivery + pickup
                    + mandatory liability reduction + mandatory accessories
                    + unavoidable surcharges − confirmed discounts
conditional_cost    = cleaning/fuel/late/damage/overtime if triggered
refundable_deposit  = held, returned  (tied-up capital, NOT a cost)
tax                 = VAT on net cost
cash_required       = guaranteed_net_cost + tax + refundable_deposit
best_case           = guaranteed_net_cost
expected_case       = guaranteed_net_cost + probable conditional items
worst_case          = guaranteed_net_cost + all conditional items
```

Unpriced categories are `unknown` — an incomplete quote is not a cheap quote, and the
interface says so in those words.

## Truth layer contract

```ts
getVerifiedLeverage({ currentSpecFingerprint, quoteId })
// success ⇔ quote.status === 'confirmed'
//         ∧ quote.total !== null
//         ∧ quote.spec_fingerprint === currentSpecFingerprint
//         ∧ quote has ≥ 1 transcript_ref
//         ∧ quote not expired
//         ∧ currency and tax basis compatible
// success → { supplier_name, quote_id, call_id, verified_total_cents, currency,
//             tax_basis, evidence_transcript_ref, verified_at }
// failure → typed error; the agent negotiates without leverage
```

## Fingerprint

Canonical serialization: stable key order, trimmed strings, normalized dates (ISO 8601,
UTC), normalized numbers, `null` for absent optionals, excluded volatile fields
(`confirmed_at`, ids). `spec_fingerprint = sha256(canonical)`. Displayed as first 12 hex
chars in the UI, full value stored.
