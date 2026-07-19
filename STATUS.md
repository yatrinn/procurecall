# STATUS.md — ProcureCall

> Last updated: 2026-07-19 12:10 CEST · gates 1–3 and 5–7 verified in production ·
> **Gate 4 OPEN** — blocked on the founder's golden voice run and the three videos

**Production:** https://procurecall.vercel.app · repo: https://github.com/yatrinn/procurecall · CI: green

## Gate status

| Gate | State |
|---|---|
| 1 Closed loop | DONE — verified live (intake → confirm → call → quote → decision) |
| 2 Challenge compliance | DONE — 3 dynamic styles, itemized quotes, verified in-call improvement: 895 → 760 EUR net across the call (−135), of which 850 → 760 (−90) landed at the verified-leverage moment; structured outcomes, transcript refs on every line |
| 3 Demo resilience | DONE — labeled verified replay, rate-limited live runs, scoped reset, no login |
| 4 Submission-ready | **NOT DONE.** The package (scripts, manifest, checklist, svg) exists and production is verified — but no video is recorded, the golden VOICE run is not recorded, and submission-checklist.md is unchecked. Nothing is submission-ready until the founder records the voice run + three videos and personally checks the checklist in incognito. |
| 5 Structural truth | DONE — tool-gated leverage (6 checks), lever tools absent unless authorized, post-call validator, adversarial suite with real results |
| 6 Technical depth | DONE — evidence ledger (tape pins → transcript/audio), deterministic price engine + ranking (unit-tested), evaluation lab live |
| 7 Platform proof | DONE — moving-us vertical runs end to end from configuration; live swap on /request |

## What works (verified)

- **Intake:** typed, document (PDF/image, injection-fenced), and ElevenLabs voice
  interview (live-verified, ~2 s budget spent) → identical validated JobSpec.
- **Confirmation:** freeze + SHA-256 fingerprint; post-confirmation edits create new
  versions; server blocks calls until confirmed (adversarially tested).
- **Negotiation:** one buyer brain (pinned gpt-5.5) for text and voice tiers; three
  seeded supplier characters + 8 held-out profiles + adversarial personas — all
  policy-driven (floor/ladder enforced in code), never scripted.
- **Truth layer:** `getVerifiedLeverage` is the only path to competing figures; all
  six failure modes return typed errors (adversarially tested); leverage events carry
  tool evidence by DB constraint.
- **Price engine:** engine-authoritative totals (caught real model arithmetic slips);
  deposits separated from cost; unknown categories surfaced; 70% benchmark red flag.
- **Ranking:** deterministic rank-1.0 with reason codes; outliers never auto-preferred;
  model writes the explanation only.
- **Evidence:** every fee pinned to its moment; decision-room figures deep-link to the
  tape; audio scrubbing wired for voice recordings.
- **Voice negotiation:** ElevenLabs buyer agent on our custom-LLM endpoint (same brain
  and tools), human-roleplay transport from the board, 8-minute cap + 45 s silence
  hangup with a visible countdown,
  recording capture to private storage. Endpoint smoke-tested in production.
- **Demo:** /demo public, golden replay labeled, live runs rate-limited (per-IP +
  global + hourly call cap), reset removes visitor data only.
- **Evaluation (real numbers):** adversarial suite 55/55 latest-per-scenario passing
  (attempt history preserved — three scenarios needed a policy/prompt fix before
  passing; one is model-nondeterministic and passed on retry); held-out profiles:
  8/8 structured outcomes, 8/8 violation-free, 4 itemized quotes, floors respected.
- **Engineering:** lint, strict typecheck, 36 unit tests, 6 Playwright e2e (local and
  against production), production build, CI green, RLS deny-all verified, no secrets
  in repo.

## Voice status (updated 2026-07-19 morning)

- **Voice negotiation verified END TO END on production** (scripts/voice-e2e.ts, no
  microphone needed): real ElevenLabs buyer audio out (36 chunks / 3.2 MiB), scripted
  dispatcher audio in via TTS → STT → custom-LLM brain executed tools live
  (13 fee pins), 10 turns persisted with audio alignment, recording stored and
  playable via signed URL (HTTP 206 audio/mpeg). Fix that made it work: the SSE
  stream now sends its first byte immediately with heartbeats — before that,
  ElevenLabs cascaded to a backup LLM and the agent stayed silent.
- Click path for the golden run: /demo → "Voice call — you play the dispatcher" →
  pick supplier → "Start voice call" (repeat per supplier on the same board).
- Voice budget used: 652 seconds (~11 minutes) booked in voice_usage across all
  verification runs and the founder's first live attempt — ~239 minutes remain.
  Subscription API exposes character_count (4,653 of 131,000) but no separate
  agent-minute or concurrency field; one session ran at a time without conflict.
- Evidence anchors seek audio: clicking any figure in the decision room or a replay
  pin jumps the recording to that second.

## Known limitations (also in README)

- Demo market is simulated (allowed by the challenge); real phone mode (Twilio) is
  intentionally out of scope and hidden.
- Text-tier timestamps are generation-time, not speech-time; audio alignment exists
  for voice calls only.
- Held-out results measure generalization against simulated profiles, not real-world
  savings — labeled accordingly everywhere.
- The moving vertical is a configuration proof: intake/confirm/negotiation run, but it
  has two seeded suppliers and no golden replay.

## Videos

- **Tech video: rendered and ready** — `~/Downloads/procurecall-tech.mp4`
  (57.5 s, 1080p H.264/AAC MP4, under the 60 s limit). Built end-to-end by
  `scripts/make-tech-video.ts`: Playwright records the scripted browser journey
  (truth-layer code → lever gating → supplier policy JSON → live voice board with
  playable recording → decision room → /lab 55/55 + attack console → vertical swap);
  narration is OpenAI TTS "onyx" (the ElevenLabs key has zero direct-TTS quota —
  only agent sessions draw from the workspace pool). A silent cut
  (`procurecall-tech-silent.mp4`) and a scene-timing sheet sit next to it so the
  founder can lay his own voice over the same picture if preferred.
- **Demo video: not rendered** — needs the founder's golden voice run first (real
  call audio for seconds 14–34 and founder narration per the demo script).
- **Team video: founder-recorded**, pending.

## What the founder still does by hand

1. One golden VOICE negotiation run for the demo video (board → "Voice call", play
   the dispatcher; up to 8 minutes per call, ~90 seconds per call suffices).
2. Record demo + team videos (scripts + shot list in /submission; each ≤ 60 s).
   The tech video is already rendered (see above) — review it, then upload.
3. Submit: production URL, repo, zip, videos, dataset manifest.
