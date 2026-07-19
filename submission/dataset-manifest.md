# Dataset manifest — ProcureCall `/data`

Everything here is published in the repository under `/data`. Every item is labeled
by provenance: public (sourced), simulated (authored for the simulation), or
generated (produced by running this system).

## 1. Public rate-card references

- File: `data/rate-card-references.json`
- Provenance: **public**, sourced. Real German supplier rate cards for 12 m scissor
  lifts with URLs and retrieval timestamps (GERKEN, BIBERGER, klickrent). Used as
  market benchmarks and to ground simulated price sheets.
- Fields: source, url, item, daily_rate_net_eur, notes, retrieved_at; derived median
  and typical extra-fee structure.
- These figures prove the market spread exists. They prove nothing about this
  system's performance.

## 2. Supplier policy fixtures

- Files: `data/supplier-policies/equipment-rental-stuttgart.json` (three demo
  policies: transparent premium, low headline, hard dispatcher),
  `data/supplier-policies/moving-us.json` (two policies for the configuration-proof
  vertical).
- Provenance: **simulated**, authored. Private commercial policies (price sheet,
  floor, concession ladder, disclosure policy, behavioral profile). Supplier names
  are fictional and every record is labeled simulated.
- Held-out evaluation profiles (unseen during development) ship in
  `data/held-out-profiles/equipment-rental-stuttgart.json` (8 profiles) and are used
  only by the evaluation lab.

## 3. Adversarial suite

- Files: `data/adversarial/scenarios.json` (50+ attack scenarios with expected
  outcomes), results in the `adversarial_results` table and displayed at `/lab`.
- Provenance: scenarios **authored**; results **generated** by running each attack
  against the deployed system. Displayed pass/fail numbers are the real numbers from
  the latest run — never hard-coded.

## 4. Evaluation runs

- Location: `eval_runs` table, surfaced at `/lab`; exported snapshot in
  `data/eval-results/` at submission time.
- Provenance: **generated**. Labeled in the product as "Negotiation performance on
  held-out market scenarios" — it demonstrates the architecture is testable and the
  policy generalizes to unseen supplier behavior. It is NOT evidence of real-world
  savings or a data moat; the moat is a future property of a real quote graph.

## 5. Recorded golden run

- Location: production database (job spec, three call sessions, quotes with
  transcript-referenced lines, negotiation events); replayed at `/demo`.
- Provenance: **generated**, dynamic (not scripted); the replay is a faithful
  re-render and is labeled as a replay.
